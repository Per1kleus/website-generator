#!/usr/bin/env node
/**
 * The client Google connection link, end to end.
 *
 *   the developer makes a link -> the client opens it -> the client signs in to
 *   their own Google account -> they choose their own property, spreadsheet and
 *   photograph folder -> every choice is proved to work -> the developer sees
 *   that it works, and never sees a credential
 *
 * Two accounts exist in the mock Google, not one, because a single account
 * cannot demonstrate the property that matters most: that one client's
 * credentials can never read another client's material. The suite connects two
 * projects to two different Google accounts and then tries, deliberately, to
 * cross them.
 *
 * The secret checks read what actually came back over HTTP — the JSON, the
 * rendered HTML, the backup bytes — rather than the code that produced it. A
 * token that leaks will leak through a response, so that is where to look.
 *
 *   node --import tsx --conditions react-server scripts/connect-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { readZip } = await import("../src/server/backup-restore.ts");

const APP_PORT = 3324;
const GOOGLE_PORT = 11744;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const GOOGLE = `http://127.0.0.1:${GOOGLE_PORT}`;

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60000, interval = 400 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

const children = [];
function spawnChild(cmd, args, env) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  return child;
}
function stop(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/* ------------------------------------------------------------ http helpers */

/**
 * Two cookie jars, because there are two people in this story: the developer,
 * who is signed in, and the client, who is not and must never need to be.
 */
const jars = { creator: "", other: "" };

function makeApi(who) {
  return async function api(pathname, init = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...(jars[who] ? { Cookie: jars[who] } : {}) },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [name] = pair.split("=");
      const existing = jars[who].split("; ").filter((p) => p && !p.startsWith(`${name}=`));
      jars[who] = [...existing, pair].join("; ");
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html or a redirect body */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
}

const api = makeApi("creator");
const otherApi = makeApi("other");

/** The client has no session at all: no cookie is ever sent or kept. */
async function anon(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, { ...init, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text, location: res.headers.get("location") ?? "" };
}

async function connectPost(token, body) {
  return anon(`/api/connect/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Walk one client through Google and back.
 *
 * Exactly what a browser does: follow the start redirect to Google, follow
 * Google's redirect back to the callback, and stop where the client lands. No
 * cookie is carried at any point — the whole flow has to work for someone with
 * no session here, which is the feature.
 */
async function signInWithGoogle(token, { account = "a", refuse = "" } = {}) {
  const start = await anon(`/api/connect/${encodeURIComponent(token)}/start`);
  if (start.status !== 307 && start.status !== 302) {
    return { ok: false, reason: `start returned ${start.status}`, consent: "" };
  }
  const consent = new URL(start.location);
  if (account === "b") consent.searchParams.set("mock_account", "b");
  if (refuse) consent.searchParams.set("mock_refuse", refuse);

  const bounced = await fetch(consent.toString(), { redirect: "manual" });
  const callback = bounced.headers.get("location") ?? "";
  if (!callback) return { ok: false, reason: "google did not redirect back", consent: start.location };

  const landed = await fetch(callback, { redirect: "manual" });
  return {
    ok: true,
    consent: start.location,
    landedAt: landed.headers.get("location") ?? "",
    status: landed.status,
  };
}

/** Anything that looks like a credential, wherever it turns up. */
const SECRET_SHAPES = [
  "mock-access",
  "mock-refresh",
  "mock-secret",
  "access_token",
  "refresh_token",
  "client_secret",
  "ya29.",
];
function leaks(text) {
  return SECRET_SHAPES.filter((shape) => text.includes(shape));
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-connect-"));

try {
  const google = spawnChild("node", ["scripts/mock-google.mjs", String(GOOGLE_PORT)], {});
  await waitFor(async () => {
    try {
      return (await fetch(`${GOOGLE}/oauth2/v2/userinfo`)).status === 401;
    } catch {
      return false;
    }
  });

  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    WG_SECRET: "connect-qa-secret",
    GOOGLE_CLIENT_ID: "mock-client",
    GOOGLE_CLIENT_SECRET: "mock-secret",
    GOOGLE_OAUTH_BASE: GOOGLE,
    GOOGLE_TOKEN_URL: `${GOOGLE}/token`,
    GOOGLE_USERINFO_URL: `${GOOGLE}/oauth2/v2/userinfo`,
    GOOGLE_SHEETS_BASE: GOOGLE,
    GOOGLE_DRIVE_BASE: GOOGLE,
    GOOGLE_ANALYTICS_ADMIN_BASE: GOOGLE,
    GOOGLE_ANALYTICS_DATA_BASE: GOOGLE,
    GOOGLE_SEARCH_CONSOLE_BASE: GOOGLE,
    WG_OLLAMA_AUTOPULL: "0",
    OLLAMA_HOST: "http://127.0.0.1:1",
    WG_GITHUB_TOKEN: "",
    GITHUB_TOKEN: "",
  });
  let appLog = "";
  app.stdout.on("data", (d) => (appLog += String(d)));
  app.stderr.on("data", (d) => (appLog += String(d)));

  const up = await waitFor(
    async () => {
      try {
        return (await fetch(`${BASE}/login`)).ok;
      } catch {
        return false;
      }
    },
    { timeout: 90000 },
  );
  if (!up) throw new Error(`app did not start:\n${appLog.slice(-2000)}`);

  /* ==================================================================
     Two projects, two clients
     ================================================================== */

  console.log("\n=== Two projects belonging to one developer ===\n");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Connect QA",
      email: `connect+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  async function newProject(fields) {
    const created = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        style: "warm",
        defaultLocale: "en",
        locales: ["en"],
        ...fields,
      }),
    });
    return created.json?.project?.id ?? "";
  }

  const menuId = await newProject({
    businessName: "Ouzeri Mikro",
    businessType: "restaurant",
    location: "Athens",
    description: "A small family ouzeri in the old town serving meze and grilled fish.",
    siteKind: "menu",
  });
  const siteId = await newProject({
    businessName: "Nikos Plumbing",
    businessType: "plumber",
    location: "Patras",
    description: "A family plumbing business covering Patras and the surrounding villages.",
    siteKind: "business",
  });
  record("two projects are created", Boolean(menuId && siteId));

  await api(`/api/projects/${menuId}/generate`, { method: "POST" });
  const menuSite = await waitFor(
    async () => (await api(`/api/projects/${menuId}/site`)).json?.site,
    { timeout: 300000 },
  );
  await api(`/api/projects/${siteId}/generate`, { method: "POST" });
  const plainSite = await waitFor(
    async () => (await api(`/api/projects/${siteId}/site`)).json?.site,
    { timeout: 300000 },
  );
  record("both websites are generated", Boolean(menuSite && plainSite));

  /* ==================================================================
     The link
     ================================================================== */

  console.log("\n=== The link is the whole authorisation ===\n");

  async function createLink(projectId, extra = {}) {
    const res = await api(`/api/projects/${projectId}/connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-link", ...extra }),
    });
    return res;
  }

  const madeMenu = await createLink(menuId, { label: "Sent to Maria" });
  const madeSite = await createLink(siteId);
  const menuToken = madeMenu.json?.links?.[0]?.id ?? "";
  const siteToken = madeSite.json?.links?.[0]?.id ?? "";
  record("a link is created for each project", Boolean(menuToken && siteToken));

  record(
    "the token is 43 characters of base64url — 256 bits, not enumerable",
    /^[A-Za-z0-9_-]{43}$/.test(menuToken),
    menuToken ? `${menuToken.length} chars` : "no token",
  );

  record(
    "the token contains no project id, user id or email",
    ![menuId, siteId].some((id) => menuToken.includes(id)) && !menuToken.includes("@"),
  );

  const second = await createLink(menuId);
  const secondToken = second.json?.links?.find((l) => l.id !== menuToken)?.id ?? "";
  record(
    "two links for the same project share nothing",
    Boolean(secondToken) &&
      secondToken !== menuToken &&
      // Not a counter, not a timestamp: no common prefix worth speaking of.
      secondToken.slice(0, 8) !== menuToken.slice(0, 8),
  );

  record(
    "a plain website's link asks for analytics only",
    JSON.stringify(madeSite.json?.links?.[0]?.services ?? []) === JSON.stringify(["analytics"]),
    JSON.stringify(madeSite.json?.links?.[0]?.services ?? []),
  );
  record(
    "a digital menu's link asks for analytics, sheets and drive",
    JSON.stringify(madeMenu.json?.links?.[0]?.services ?? []) ===
      JSON.stringify(["analytics", "sheets", "drive"]),
    JSON.stringify(madeMenu.json?.links?.[0]?.services ?? []),
  );

  /* An unknown token, and a withdrawn one, are answered identically. */
  const unknown = await anon("/api/connect/ZZZZnotarealtokenZZZZnotarealtokenZZZZ123");
  const shortProbe = await anon("/api/connect/abc");
  record(
    "an unknown token is refused",
    unknown.status === 404 && shortProbe.status === 404,
    `${unknown.status}/${shortProbe.status}`,
  );

  const throwaway = (await createLink(siteId)).json?.links?.find((l) => l.id !== siteToken)?.id ?? "";
  await api(`/api/projects/${siteId}/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke-link", linkId: throwaway }),
  });
  const revoked = await anon(`/api/connect/${throwaway}`);
  record(
    "a withdrawn link is indistinguishable from one that never existed",
    revoked.status === unknown.status && revoked.json?.error === unknown.json?.error,
    `${revoked.status} · ${revoked.json?.error ?? ""}`,
  );

  /* An expired link. The expiry is set in the past by asking for a fraction of
     a day, which exercises the real branch rather than a test-only one. */
  await createLink(siteId, { expiryDays: 1e-9, label: "already expired" });
  const expiredToken =
    (await api(`/api/projects/${siteId}/connection`)).json?.links?.find(
      (l) => l.label === "already expired",
    )?.id ?? "";
  const expired = await anon(`/api/connect/${expiredToken}`);
  record(
    "an expired link is refused, with the same answer as an unknown one",
    expired.status === 404 && expired.json?.error === unknown.json?.error,
    `${expired.status}`,
  );

  /* ==================================================================
     Minimum scopes
     ================================================================== */

  console.log("\n=== The consent screen asks for the minimum ===\n");

  const startedSite = await anon(`/api/connect/${siteToken}/start`);
  const consentSite = new URL(startedSite.location || "http://x/");
  const siteScopes = (consentSite.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  record(
    "a plain website's consent screen asks only for analytics.readonly",
    siteScopes.length === 1 && siteScopes[0].endsWith("analytics.readonly"),
    siteScopes.join(" "),
  );
  record(
    "it asks for nothing that touches Sheets or Drive",
    !siteScopes.some((s) => s.includes("spreadsheets") || s.includes("drive")),
  );
  record(
    "incremental consent is off, so a permission granted elsewhere is not re-granted here",
    consentSite.searchParams.get("include_granted_scopes") === "false",
    consentSite.searchParams.get("include_granted_scopes") ?? "",
  );
  record(
    "a refresh token is actually requested, so the connection survives the hour",
    consentSite.searchParams.get("access_type") === "offline",
  );
  record(
    "the consent URL carries no credential of ours",
    leaks(consentSite.toString().replace("client_id=mock-client", "")).length === 0,
    leaks(consentSite.toString().replace("client_id=mock-client", "")).join(", "),
  );

  const startedMenu = await anon(`/api/connect/${menuToken}/start`);
  const menuScopes = (new URL(startedMenu.location || "http://x/").searchParams.get("scope") ?? "")
    .split(" ")
    .filter(Boolean);
  record(
    "a digital menu's consent screen asks for exactly three read-only scopes",
    menuScopes.length === 3 && menuScopes.every((s) => s.endsWith(".readonly")),
    menuScopes.join(" "),
  );

  /* ==================================================================
     A revoked link cannot be completed
     ================================================================== */

  console.log("\n=== Withdrawing a link stops a sign-in already under way ===\n");

  const raceLink = (await createLink(siteId, { label: "race" })).json?.links?.find(
    (l) => l.label === "race",
  )?.id ?? "";
  const raceStart = await anon(`/api/connect/${raceLink}/start`);
  await api(`/api/projects/${siteId}/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke-link", linkId: raceLink }),
  });
  const raceBounce = await fetch(raceStart.location, { redirect: "manual" });
  const raceLanded = await fetch(raceBounce.headers.get("location") ?? "", { redirect: "manual" });
  const raceDestination = raceLanded.headers.get("location") ?? "";
  record(
    "a consent completed after the link was withdrawn connects nothing",
    raceDestination.includes("google=link"),
    raceDestination,
  );

  /* ==================================================================
     The client signs in
     ================================================================== */

  console.log("\n=== The client signs in with their own Google account ===\n");

  const page = await anon(`/connect/${menuToken}`);
  record("the client's page loads without any session", page.status === 200);
  record(
    "it names the business and every permission being asked for",
    page.text.includes("Ouzeri Mikro") &&
      page.text.includes("Google Analytics") &&
      page.text.includes("menu spreadsheet") &&
      page.text.includes("photographs"),
  );
  record(
    "it says the client's Google password is never given to anybody here",
    page.text.includes("never be asked for") || page.text.includes("never see"),
  );
  record(
    "the page leaks no project id, user id or credential",
    !page.text.includes(menuId) && !page.text.includes(siteId) && leaks(page.text).length === 0,
    leaks(page.text).join(", "),
  );

  const signedIn = await signInWithGoogle(menuToken);
  record(
    "the client comes back connected",
    signedIn.ok && signedIn.landedAt.includes("google=connected"),
    signedIn.landedAt || signedIn.reason,
  );

  const afterConsent = await anon(`/api/connect/${menuToken}`);
  record(
    "the Google account is recorded against the project",
    afterConsent.json?.googleConnected === true &&
      afterConsent.json?.connectedEmail === "chef@example.com",
    String(afterConsent.json?.connectedEmail),
  );
  record(
    "consent alone is not reported as connected — nothing has been proved yet",
    afterConsent.json?.status === "connecting" &&
      (afterConsent.json?.services ?? []).every((s) => s.status === "connecting"),
    JSON.stringify((afterConsent.json?.services ?? []).map((s) => s.status)),
  );
  record(
    "no credential reaches the client's browser",
    leaks(afterConsent.text).length === 0,
    leaks(afterConsent.text).join(", "),
  );

  /* The callback is single use: replaying it does nothing. */
  const replay = await fetch(
    `${BASE}/api/google/callback?code=mock-code&state=${encodeURIComponent(
      new URL(startedMenu.location).searchParams.get("state") ?? "",
    )}`,
    { redirect: "manual" },
  );
  const replayLanded = replay.headers.get("location") ?? "";
  record(
    "a replayed callback is refused",
    !replayLanded.includes("google=connected"),
    replayLanded,
  );

  /* ==================================================================
     Choosing, and proving, each resource
     ================================================================== */

  console.log("\n=== Every choice is proved against Google ===\n");

  const properties = await connectPost(menuToken, { action: "resources", service: "analytics" });
  const propertyIds = (properties.json?.choices ?? []).map((c) => c.id);
  record(
    "the client sees their own Analytics properties",
    propertyIds.includes("properties/111"),
    propertyIds.join(", "),
  );

  const noStream = await connectPost(menuToken, {
    action: "select",
    service: "analytics",
    id: "properties/222",
    name: "App Only Property",
  });
  record(
    "a property with no website data stream is refused rather than stored",
    noStream.status === 400 && String(noStream.json?.error).includes("data stream"),
    String(noStream.json?.error),
  );

  const chose = await connectPost(menuToken, {
    action: "select",
    service: "analytics",
    id: "properties/111",
    name: "Ouzeri Mikro",
  });
  const analyticsState = (chose.json?.services ?? []).find((s) => s.service === "analytics");
  record(
    "choosing a readable property reports connected, with a verification time",
    chose.status === 200 && analyticsState?.status === "connected" && analyticsState?.verifiedAt > 0,
    JSON.stringify(analyticsState ?? {}),
  );

  const sheetChoices = await connectPost(menuToken, { action: "resources", service: "sheets" });
  const sheetIds = (sheetChoices.json?.choices ?? []).map((c) => c.id);
  record(
    "the client sees their own spreadsheets",
    sheetIds.includes("sheet-folder") && sheetIds.includes("sheet-menu"),
    sheetIds.join(", "),
  );
  record(
    "and never another account's spreadsheet",
    !sheetIds.includes("sheet-beach"),
    sheetIds.join(", "),
  );

  const tabs = await connectPost(menuToken, {
    action: "resources",
    service: "sheets",
    id: "sheet-folder",
  });
  record(
    "the sheets inside a chosen file are listed",
    (tabs.json?.tabs ?? []).some((t) => t.title === "Menu"),
    JSON.stringify(tabs.json?.tabs ?? []),
  );

  const choseSheet = await connectPost(menuToken, {
    action: "select",
    service: "sheets",
    id: "sheet-folder",
    name: "Menu by file name",
    sheetTitle: "Menu",
  });
  record(
    "choosing a readable spreadsheet and sheet reports connected",
    (choseSheet.json?.services ?? []).find((s) => s.service === "sheets")?.status === "connected",
    JSON.stringify((choseSheet.json?.services ?? []).find((s) => s.service === "sheets") ?? {}),
  );

  const missingTab = await connectPost(menuToken, {
    action: "select",
    service: "sheets",
    id: "sheet-folder",
    name: "Menu by file name",
    sheetTitle: "Nonexistent",
  });
  record(
    "a sheet name that is not in the file is refused",
    missingTab.status === 400,
    String(missingTab.json?.error),
  );
  // Put the good choice back, since the refusal above left the source pointing
  // at a sheet that does not exist.
  await connectPost(menuToken, {
    action: "select",
    service: "sheets",
    id: "sheet-folder",
    name: "Menu by file name",
    sheetTitle: "Menu",
  });

  const folders = await connectPost(menuToken, { action: "resources", service: "drive" });
  const folderIds = (folders.json?.choices ?? []).map((c) => c.id);
  record(
    "the client sees their own Drive folders and nobody else's",
    folderIds.includes("folder-dishes") && !folderIds.includes("folder-beach"),
    folderIds.join(", "),
  );

  const choseFolder = await connectPost(menuToken, {
    action: "select",
    service: "drive",
    id: "folder-dishes",
    name: "Dish photographs",
  });
  record(
    "choosing a readable folder reports connected",
    (choseFolder.json?.services ?? []).find((s) => s.service === "drive")?.status === "connected",
    JSON.stringify((choseFolder.json?.services ?? []).find((s) => s.service === "drive") ?? {}),
  );
  record(
    "the project is now fully connected",
    choseFolder.json?.status === "connected",
    String(choseFolder.json?.status),
  );

  /* ==================================================================
     Project isolation
     ================================================================== */

  console.log("\n=== One client's credentials cannot reach another's material ===\n");

  const secondSignIn = await signInWithGoogle(siteToken, { account: "b" });
  record(
    "the second project connects a different Google account",
    secondSignIn.ok && secondSignIn.landedAt.includes("google=connected"),
    secondSignIn.landedAt || secondSignIn.reason,
  );

  const siteState = await anon(`/api/connect/${siteToken}`);
  record(
    "each project records its own account",
    siteState.json?.connectedEmail === "owner@beachbar.example",
    String(siteState.json?.connectedEmail),
  );

  const bProperties = await connectPost(siteToken, { action: "resources", service: "analytics" });
  const bIds = (bProperties.json?.choices ?? []).map((c) => c.id);
  record(
    "the second project sees only the second account's property",
    bIds.includes("properties/333") && !bIds.includes("properties/111"),
    bIds.join(", "),
  );

  const stillA = await connectPost(menuToken, { action: "resources", service: "analytics" });
  record(
    "the first project still sees only the first account's property",
    (stillA.json?.choices ?? []).some((c) => c.id === "properties/111") &&
      !(stillA.json?.choices ?? []).some((c) => c.id === "properties/333"),
    (stillA.json?.choices ?? []).map((c) => c.id).join(", "),
  );

  const crossed = await connectPost(siteToken, {
    action: "select",
    service: "analytics",
    id: "properties/111",
    name: "Ouzeri Mikro",
  });
  record(
    "project B cannot select project A's Analytics property",
    crossed.status !== 200,
    `${crossed.status} · ${String(crossed.json?.error ?? "")}`,
  );

  const aAfterCross = await anon(`/api/connect/${menuToken}`);
  record(
    "and the attempt changed nothing about project A",
    aAfterCross.json?.status === "connected" &&
      (aAfterCross.json?.services ?? []).find((s) => s.service === "analytics")?.resource ===
        "Ouzeri Mikro",
    JSON.stringify((aAfterCross.json?.services ?? []).find((s) => s.service === "analytics") ?? {}),
  );

  /* A link asking for analytics only cannot be used to reach Sheets or Drive,
     because this link has no notion of those services at all. */
  const outOfScope = await connectPost(siteToken, { action: "resources", service: "sheets" });
  record(
    "a website link cannot list spreadsheets, whatever it is asked",
    outOfScope.status === 400,
    `${outOfScope.status} · ${String(outOfScope.json?.error ?? "")}`,
  );

  /* Ownership on the developer's own routes. */
  await otherApi("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Someone Else",
      email: `other+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });
  const peeked = await otherApi(`/api/projects/${menuId}/connection`);
  record(
    "another developer cannot see this project's connection at all",
    peeked.status === 404,
    String(peeked.status),
  );
  const crossRevoke = await api(`/api/projects/${siteId}/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke-link", linkId: menuToken }),
  });
  record(
    "a link cannot be withdrawn through a different project",
    crossRevoke.status === 400,
    String(crossRevoke.json?.error ?? ""),
  );
  const menuStillUsable = await anon(`/api/connect/${menuToken}`);
  record("and that link still works", menuStillUsable.status === 200);

  /* ==================================================================
     The connection does real work
     ================================================================== */

  console.log("\n=== The connection does the work the project needs ===\n");

  const synced = await api(`/api/projects/${menuId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync" }),
  });
  record(
    "the menu syncs using the client's own credentials",
    synced.json?.ok === true && (synced.json?.stats?.items ?? 0) >= 3,
    JSON.stringify(synced.json?.stats ?? synced.json?.error ?? {}),
  );
  record(
    "dish photographs are found by file name in the connected Drive folder",
    (synced.json?.stats?.imagesResolved ?? 0) >= 3,
    `${synced.json?.stats?.imagesResolved ?? 0} resolved, ${synced.json?.stats?.imagesFailed ?? 0} failed`,
  );
  record(
    "a photograph that is not in the folder is reported, not invented",
    (synced.json?.findings ?? []).some((f) => String(f.message).includes("folder")),
    JSON.stringify((synced.json?.findings ?? []).map((f) => f.message).slice(0, 3)),
  );

  const insights = await api(`/api/projects/${menuId}/insights?report=analytics&range=28d`);
  record(
    "analytics reports through the client's connection",
    insights.status === 200 && (insights.json?.report?.visitors ?? 0) > 0,
    JSON.stringify(insights.json?.report?.visitors ?? insights.json?.error ?? {}),
  );
  record(
    "the insights response carries no credential",
    leaks(insights.text).length === 0,
    leaks(insights.text).join(", "),
  );

  const siteDoc = (await api(`/api/projects/${menuId}/site`)).json?.site;
  record(
    "the website carries the public measurement id, and nothing else from Google",
    siteDoc?.meta?.analytics?.measurementId === "G-MOCK12345",
    String(siteDoc?.meta?.analytics?.measurementId),
  );
  record(
    "connecting is not consenting — the cookie acknowledgement starts false",
    siteDoc?.meta?.analytics?.consentAcknowledged === false,
    String(siteDoc?.meta?.analytics?.consentAcknowledged),
  );

  const rendered = await api(`/api/projects/${menuId}/render?locale=en`);
  record(
    "the generated website contains no credential and no connection link",
    leaks(rendered.text).length === 0 && !rendered.text.includes(menuToken),
    leaks(rendered.text).join(", "),
  );
  record(
    "the public menu never points a browser at private Google Drive",
    !/<img[^>]+src="[^"]*(?:drive\.google\.com|googleusercontent)/i.test(rendered.text),
  );

  /* ==================================================================
     Withdrawing the connection
     ================================================================== */

  console.log("\n=== Disconnecting withdraws permission and nothing else ===\n");

  const beforeVersions = (await api(`/api/projects/${menuId}/versions`)).json?.versions?.length ?? 0;
  const beforeMenuItems = JSON.stringify(
    (siteDoc?.sections ?? []).find((s) => s.type === "menu")?.categories ?? [],
  );

  const disconnected = await api(`/api/projects/${menuId}/connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "disconnect" }),
  });
  record(
    "the project's Google credentials are gone",
    disconnected.json?.connection?.status === "not_connected" &&
      disconnected.json?.access?.source !== "project",
    `${disconnected.json?.connection?.status} · ${disconnected.json?.access?.source}`,
  );

  const afterDoc = (await api(`/api/projects/${menuId}/site`)).json?.site;
  record(
    "the website is untouched",
    JSON.stringify((afterDoc?.sections ?? []).find((s) => s.type === "menu")?.categories ?? []) ===
      beforeMenuItems,
  );
  record(
    "the menu data that was already synced is still there",
    beforeMenuItems.length > 10,
  );
  record(
    "every saved version is still there",
    ((await api(`/api/projects/${menuId}/versions`)).json?.versions?.length ?? 0) >= beforeVersions,
  );
  record(
    "the Analytics property the client chose is still recorded",
    Boolean((await api(`/api/projects/${menuId}/insights`)).json?.analytics?.property_id),
  );
  record(
    "the website still carries its measurement id",
    afterDoc?.meta?.analytics?.measurementId === "G-MOCK12345",
  );

  const afterDisconnect = await connectPost(menuToken, { action: "resources", service: "analytics" });
  record(
    "the link says only that a Google account is needed, never whether one exists elsewhere",
    afterDisconnect.status === 400 &&
      String(afterDisconnect.json?.error) === "Connect your Google account first.",
    String(afterDisconnect.json?.error),
  );

  /* ==================================================================
     The audit trail, and the backup
     ================================================================== */

  console.log("\n=== What is written down, and what is not ===\n");

  const state = await api(`/api/projects/${menuId}/connection`);
  const events = state.json?.events ?? [];
  record(
    "the history records the link, the sign-in, the choices and the disconnection",
    ["link-created", "connected", "resource-selected", "verified", "disconnected"].every((e) =>
      events.some((row) => row.event === e),
    ),
    events.map((e) => e.event).join(", "),
  );
  record(
    "the history contains no token, code or secret",
    leaks(JSON.stringify(events)).length === 0 &&
      !JSON.stringify(events).includes(menuToken) &&
      !JSON.stringify(events).includes("mock-code"),
    leaks(JSON.stringify(events)).join(", "),
  );

  const backup = await fetch(`${BASE}/api/projects/${menuId}/backup`, {
    headers: { Cookie: jars.creator },
  });
  const backupBytes = Buffer.from(await backup.arrayBuffer());
  record("a backup can still be taken", backup.ok, `status ${backup.status}`);

  /* Read the archive rather than scanning the compressed bytes: a secret
     inside a deflated entry would not show up as a plain string, so scanning
     the file as text would be a check that can only ever pass. */
  const entries = await readZip(backupBytes);
  const manifestEntry = entries.find((e) => e.name === "backup.json");
  const manifestText = manifestEntry ? manifestEntry.bytes.toString("utf8") : "";
  const manifest = manifestText ? JSON.parse(manifestText) : null;
  const wholeArchive = entries.map((e) => e.bytes.toString("latin1")).join("\n");

  record(
    "the backup manifest was read back out of the archive",
    Boolean(manifest),
    manifestEntry ? `${manifestEntry.bytes.length} bytes` : "no manifest",
  );
  record(
    "the backup carries no Google credential, decompressed and all",
    leaks(wholeArchive).length === 0,
    leaks(wholeArchive).join(", "),
  );
  record(
    "the backup carries no connection link",
    !wholeArchive.includes(menuToken) && !wholeArchive.includes(siteToken),
  );
  record(
    "the backup does carry the spreadsheet and folder it used, which are not secret",
    manifest?.integrations?.menu?.spreadsheet_id === "sheet-folder" &&
      manifest?.integrations?.menu?.drive_folder_id === "folder-dishes",
    JSON.stringify(manifest?.integrations?.menu ?? {}),
  );
  record(
    "and the Analytics property, which is not secret either",
    (manifest?.integrations?.google ?? []).some((g) => g.property_id === "properties/111"),
    JSON.stringify(manifest?.integrations?.google ?? []),
  );

  /* ==================================================================
     Partial consent
     ================================================================== */

  console.log("\n=== A client who approves only some of it ===\n");

  const partialLink = (await createLink(menuId, { label: "partial" })).json?.links?.find(
    (l) => l.label === "partial",
  )?.id ?? "";
  const partial = await signInWithGoogle(partialLink, { refuse: "drive.readonly" });
  record(
    "a partly approved consent says so rather than claiming success",
    partial.ok && partial.landedAt.includes("google=partial"),
    partial.landedAt || partial.reason,
  );

  const partialState = await anon(`/api/connect/${partialLink}`);
  const driveState = (partialState.json?.services ?? []).find((s) => s.service === "drive");
  record(
    "the declined permission is reported as not connected, with the reason",
    driveState?.status === "not_connected" && String(driveState?.error).includes("not approved"),
    JSON.stringify(driveState ?? {}),
  );
  record(
    "and the project reads as partly connected, not connected",
    ["partially_connected", "connecting"].includes(String(partialState.json?.status)),
    String(partialState.json?.status),
  );

  /* ==================================================================
     Nothing leaked anywhere along the way
     ================================================================== */

  console.log("\n=== The server's own output ===\n");

  record(
    "no access or refresh token was ever logged",
    !appLog.includes("mock-access") && !appLog.includes("mock-refresh"),
    leaks(appLog).join(", "),
  );
  record(
    "no link token was ever logged",
    !appLog.includes(menuToken) && !appLog.includes(siteToken),
  );

  /* ==================================================================
     Real Google
     ================================================================== */

  console.log("\n=== Against real Google ===\n");
  const realCredentials = Boolean(
    process.env.WG_REAL_GOOGLE_CLIENT_ID && process.env.WG_REAL_GOOGLE_CLIENT_SECRET,
  );
  if (!realCredentials) {
    console.log(
      "  SKIP  a real Google account was not available in this environment.\n" +
        "        Everything above ran against scripts/mock-google.mjs, which implements\n" +
        "        the exact endpoints, response shapes and status codes the application\n" +
        "        uses — including PKCE, refresh, partial consent and per-account\n" +
        "        isolation. What that cannot cover is Google's own consent screen and\n" +
        "        its verification requirements for the analytics.readonly,\n" +
        "        spreadsheets.readonly and drive.readonly scopes. Those remain\n" +
        "        unverified here and need one real run; see the developer guide.",
    );
  }
} catch (err) {
  record("the suite ran to completion", false, err instanceof Error ? err.message : String(err));
} finally {
  for (const child of children) stop(child);
  await sleep(500);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* the directory is a temporary one either way */
  }
}

console.log(`\n${results.length - failures}/${results.length} checks passed.`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
process.exit(failures ? 1 : 0);
