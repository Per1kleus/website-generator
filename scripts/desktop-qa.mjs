#!/usr/bin/env node
/**
 * Desktop packaging test.
 *
 * Verifies the parts of the packaged application that can be checked without a
 * Windows machine or a GUI: the sidecar that boots the bundled server, the
 * runtime/config split, and the desktop Google OAuth flow.
 *
 * The OAuth case matters most. A packaged app cannot use the web redirect
 * flow — Google refuses consent inside an embedded webview, and a confidential
 * client secret cannot be shipped in an installer. The desktop flow therefore
 * uses a loopback redirect with PKCE and no client secret, and this asserts
 * that it genuinely works that way rather than falling back to the web path.
 *
 *   node scripts/desktop-qa.mjs
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GOOGLE_PORT = 11811;
const GOOGLE = `http://127.0.0.1:${GOOGLE_PORT}`;

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function spawnChild(cmd, args, env, opts = {}) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
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
      /* gone */
    }
  }
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-desktop-"));

/**
 * Next leaves .next/static and public/ for whoever packages the app, so the
 * packaging script copies them into the standalone tree. This suite runs
 * against that same tree, so it needs the same copy — otherwise it would test
 * a server whose stylesheets 404 and call that normal.
 */
function stageStandalone() {
  const standalone = path.join(process.cwd(), ".next", "standalone");
  if (!existsSync(path.join(standalone, "server.js"))) {
    console.error("No standalone server found. Run `npm run build` first.");
    process.exit(1);
  }
  const staticDir = path.join(standalone, ".next", "static");
  if (!existsSync(staticDir)) {
    cpSync(path.join(process.cwd(), ".next", "static"), staticDir, { recursive: true });
  }
  const publicDir = path.join(standalone, "public");
  if (!existsSync(publicDir) && existsSync(path.join(process.cwd(), "public"))) {
    cpSync(path.join(process.cwd(), "public"), publicDir, { recursive: true });
  }
}

stageStandalone();

try {
  console.log("\n=== The sidecar ===\n");

  const google = spawnChild("node", ["scripts/mock-google.mjs", String(GOOGLE_PORT)], {});
  await sleep(600);

  // The shell keeps stdin open; closing it is how the server is told to stop.
  const sidecar = spawnChild(
    "node",
    ["desktop/sidecar/launch.mjs", "--data-dir", dataDir],
    {
      GOOGLE_CLIENT_ID: "mock-desktop-client",
      // Deliberately absent: a Desktop OAuth client has no usable secret, and
      // shipping one in an installer would not make it confidential.
      GOOGLE_CLIENT_SECRET: "",
      GOOGLE_OAUTH_BASE: GOOGLE,
      GOOGLE_TOKEN_URL: `${GOOGLE}/token`,
      GOOGLE_USERINFO_URL: `${GOOGLE}/oauth2/v2/userinfo`,
      GOOGLE_SHEETS_BASE: GOOGLE,
      GOOGLE_DRIVE_BASE: GOOGLE,
      WG_SECRET: "desktop-qa-secret",
      OLLAMA_HOST: "http://127.0.0.1:1",
    },
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  let base = "";
  let failReason = "";
  sidecar.stdout.setEncoding("utf8");
  sidecar.stdout.on("data", (chunk) => {
    for (const line of chunk.split("\n")) {
      if (line.startsWith("WG_READY ")) base = line.slice(9).trim();
      if (line.startsWith("WG_FAILED ")) failReason = line.slice(10).trim();
    }
  });

  const deadline = Date.now() + 120_000;
  while (!base && !failReason && Date.now() < deadline) await sleep(300);

  record("the sidecar reports a ready URL", Boolean(base), base || failReason);
  if (!base) throw new Error(`sidecar did not start: ${failReason}`);
  record("the server is on loopback only", /^http:\/\/127\.0\.0\.1:\d+$/.test(base), base);

  let cookie = "";
  async function api(pathname, init = {}) {
    const res = await fetch(`${base}${pathname}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const [name] = pair.split("=");
      cookie = [...cookie.split("; ").filter((p) => p && !p.startsWith(`${name}=`)), pair].join("; ");
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html */
    }
    return { status: res.status, json, text, location: res.headers.get("location") };
  }

  console.log("\n=== Runtime configuration ===\n");

  const health = await api("/api/health");
  record("the health endpoint answers", health.json?.ok === true);
  record("it reports desktop mode", health.json?.mode === "desktop");
  record("it selects the system-browser OAuth flow", health.json?.oauthFlow === "system-browser");
  record(
    "Google counts as configured without a client secret",
    health.json?.googleConfigured === true,
  );
  // The public payload is an allowlist; nothing sensitive may appear in it.
  const leaked = ["client_secret", "GOOGLE_CLIENT_SECRET", "WG_SECRET", "desktop-qa-secret", "api_key"]
    .filter((k) => health.text.includes(k));
  record("the public config leaks no secrets", leaked.length === 0, leaked.join(", "));

  // Pages, not just API routes. Next externalises native modules (sqlite,
  // sharp) under hashed names that only server-rendered pages pull in, so an
  // API-only check would have missed a packaged app that starts and then
  // fails to render anything.
  const page = await api("/login");
  record("a server-rendered page loads from the packaged server",
    page.status === 200 && page.text.includes("<!DOCTYPE html>"),
    `status ${page.status}`);
  record("it rendered the application, not an error page",
    page.text.includes("Welcome back") && !page.text.includes("Cannot find module"));

  const css = page.text.match(/href="(\/_next\/static\/[^"]+\.css)"/)?.[1];
  const styles = css ? await api(css) : { status: 0, text: "" };
  record("its stylesheet is served from the packaged static files",
    styles.status === 200 && styles.text.length > 1000,
    css ?? "no stylesheet linked");

  console.log("\n=== Desktop Google OAuth ===\n");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Desktop QA",
      email: `desktop+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  const start = await api("/api/google/connect?returnTo=%2F&mode=url");
  const consentUrl = start.json?.url ?? "";
  record("connect returns a URL instead of navigating the app window",
    start.status === 200 && consentUrl.startsWith(GOOGLE));
  record("the shell is told to use the system browser", start.json?.flow === "system-browser");

  const consent = new URL(consentUrl);
  record("the consent request carries a PKCE challenge",
    Boolean(consent.searchParams.get("code_challenge")));
  record("PKCE uses S256, not plain",
    consent.searchParams.get("code_challenge_method") === "S256");
  record("no client secret appears in the consent URL",
    !consentUrl.includes("client_secret"));
  record("the redirect URI is this loopback server",
    consent.searchParams.get("redirect_uri") === `${base}/api/google/callback`,
    consent.searchParams.get("redirect_uri") ?? "");

  // Follow consent the way the user's browser would.
  const bounced = await fetch(consentUrl, { redirect: "manual" });
  const callbackUrl = new URL(bounced.headers.get("location"));
  const callback = await api(`${callbackUrl.pathname}${callbackUrl.search}`);

  record("the callback renders a page rather than redirecting into the app",
    callback.status === 200 && callback.text.includes("<!doctype html"));
  record("that page tells the user to return to the application",
    /return to Website Generator/i.test(callback.text));

  // Ask a route that reports connection state for this user.
  const project = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: "Desktop Taverna",
      businessType: "taverna",
      location: "Athens",
      description: "A small taverna.",
      siteKind: "menu",
      style: "warm",
      defaultLocale: "en",
      locales: ["en"],
    }),
  });
  const source = await api(`/api/projects/${project.json?.project?.id}/menu-source`);
  record("the Google account is now connected",
    source.json?.google?.connected === true,
    source.json?.google?.email ?? "");
  record("the stored tokens are never returned to the client",
    !source.text.includes("mock-access") && !source.text.includes("mock-refresh"));

  // Confirm through a route that needs real credentials.
  const sheets = await api("/api/google/spreadsheets");
  record("the connected account can reach Google with PKCE-issued tokens",
    sheets.status === 200 && (sheets.json?.spreadsheets ?? []).length >= 1,
    `status ${sheets.status}`);

  console.log("\n=== Keys, without a terminal ===\n");

  // The desktop promise is that nobody opens a terminal, so the app has to
  // have somewhere to put the user's own keys. That store is write-only over
  // the API and encrypted on disk.
  const anon = await fetch(`${base}/api/settings`, { redirect: "manual" });
  record("settings need a signed-in user", anon.status === 401, `status ${anon.status}`);

  const before = await api("/api/settings");
  const listed = (before.json?.settings ?? []).map((s) => s.key);
  record("the settings list is the allowlist, nothing more",
    JSON.stringify(listed) ===
      JSON.stringify(["ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OLLAMA_HOST"]),
    listed.join(", "));
  record("a key set at launch is shown as coming from the environment",
    before.json?.settings?.find((s) => s.key === "GOOGLE_CLIENT_ID")?.fromEnvironment === true);

  const KEY = "sk-ant-desktopqa-0123456789abcdef";
  const saved = await api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // WG_SECRET is not on the allowlist: overwriting it would make every
    // stored Google token undecryptable, so a request may not touch it.
    body: JSON.stringify({ ANTHROPIC_API_KEY: KEY, WG_SECRET: "hijacked" }),
  });
  record("a key can be saved from inside the application", saved.status === 200);
  record("the saved key is never echoed back", !saved.text.includes(KEY));
  record("it is reported by its last four characters only",
    saved.json?.settings?.find((s) => s.key === "ANTHROPIC_API_KEY")?.hint === "••••cdef",
    saved.json?.settings?.find((s) => s.key === "ANTHROPIC_API_KEY")?.hint ?? "");
  record("a variable outside the allowlist is ignored",
    !saved.text.includes("WG_SECRET") && !saved.text.includes("hijacked"));

  const afterSave = await api("/api/health");
  record("the key takes effect immediately, with no restart",
    afterSave.json?.aiConfigured === true);
  record("the health endpoint still never carries the key itself",
    !afterSave.text.includes(KEY));

  const store = path.join(dataDir, "settings.enc");
  record("the key is encrypted on disk, not stored in the clear",
    existsSync(store) && !readFileSync(store, "utf8").includes(KEY));

  // WG_SECRET survived, so tokens stored before the write are still readable.
  const stillConnected = await api("/api/google/spreadsheets");
  record("the encryption secret was not disturbed by the write",
    stillConnected.status === 200);

  console.log("\n=== PKCE is genuinely enforced ===\n");

  // A verifier that does not match the challenge must be rejected, or the
  // flow is not actually protected.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await fetch(`${GOOGLE}/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(`${base}/api/google/callback`)}&state=x&code_challenge=${challenge}&code_challenge_method=S256`, { redirect: "manual" });
  const wrong = await fetch(`${GOOGLE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: "mock-code",
      grant_type: "authorization_code",
      client_id: "mock-desktop-client",
      code_verifier: randomBytes(32).toString("base64url"),
    }),
  });
  record("a mismatched PKCE verifier is rejected", wrong.status === 400);

  const right = await fetch(`${GOOGLE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: "mock-code",
      grant_type: "authorization_code",
      client_id: "mock-desktop-client",
      code_verifier: verifier,
    }),
  });
  record("the matching verifier is accepted", right.status === 200);

  console.log("\n=== Backend unavailable ===\n");

  stop(google);
  await sleep(600);
  const offline = await api("/api/google/spreadsheets");
  record("a Google outage returns a message, not a stack trace",
    offline.status >= 400 && typeof offline.json?.error === "string" &&
      !offline.text.includes("at Object.") && !offline.text.includes("node:internal"),
    offline.json?.error ?? "");

  console.log("\n=== Shutdown ===\n");

  // Closing stdin is how the shell stops the server when the window closes.
  sidecar.stdin.end();
  await sleep(4000);
  let stillUp = true;
  try {
    await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
  } catch {
    stillUp = false;
  }
  record("closing the shell stops the bundled server", !stillUp);
} finally {
  for (const c of children) stop(c);
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failures ? 1 : 0);
