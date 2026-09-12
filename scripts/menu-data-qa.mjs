#!/usr/bin/env node
/**
 * Digital Menu / Google Sheets integration test.
 *
 * Drives the whole documented flow against a stub Google (scripts/mock-google.mjs):
 *
 *   connect account -> pick spreadsheet -> pick tab -> validate columns
 *   -> sync -> images resolved -> menu rendered -> languages -> republish
 *
 * It also asserts the separation the requirements insist on: the public menu
 * contains no builder controls, no spreadsheet references and no hint that
 * Google is involved.
 *
 *   node scripts/menu-data-qa.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_PORT = 3311;
const GOOGLE_PORT = 11711;
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
/**
 * This container pre-installs Chromium outside Playwright's own cache. Fall
 * back to Playwright's resolution so the suite also runs on a plain machine.
 */
function chromeExecutable() {
  const preset = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  return process.env.PW_CHROME ?? (existsSync(preset) ? preset : undefined);
}

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

let cookie = "";
async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const [pair] = c.split(";");
    const [name] = pair.split("=");
    // Keep every cookie the app sets: the OAuth state lives in one of them.
    const existing = cookie.split("; ").filter((p) => p && !p.startsWith(`${name}=`));
    cookie = [...existing, pair].join("; ");
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html or a redirect body */
  }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-menu-"));

try {
  const google = spawnChild("node", ["scripts/mock-google.mjs", String(GOOGLE_PORT)], {});
  await waitFor(async () => {
    try {
      return (await fetch(`${GOOGLE}/o/oauth2/v2/auth`, { redirect: "manual" })).status === 302;
    } catch {
      return false;
    }
  });

  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    WG_SECRET: "menu-qa-secret",
    GOOGLE_CLIENT_ID: "mock-client",
    GOOGLE_CLIENT_SECRET: "mock-secret",
    GOOGLE_OAUTH_BASE: GOOGLE,
    GOOGLE_TOKEN_URL: `${GOOGLE}/token`,
    GOOGLE_USERINFO_URL: `${GOOGLE}/oauth2/v2/userinfo`,
    GOOGLE_SHEETS_BASE: GOOGLE,
    GOOGLE_DRIVE_BASE: GOOGLE,
    // Keep the design engine out of this test's way.
    WG_OLLAMA_AUTOPULL: "0",
    OLLAMA_HOST: "http://127.0.0.1:1",
  });
  app.stderr.on("data", (d) => {
    const s = String(d);
    if (/Error/.test(s)) process.stderr.write(`[app] ${s}`);
  });

  const up = await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/login`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 60000 });
  if (!up) throw new Error("app did not start");

  console.log("\n=== Connect and configure ===\n");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Menu QA",
      email: `menu+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  // Create and generate a digital menu project in two languages.
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: "Ouzeri Mikro",
      businessType: "taverna",
      location: "Athens",
      description: "A small traditional taverna serving meze.",
      siteKind: "menu",
      style: "warm",
      defaultLocale: "en",
      locales: ["en", "el"],
    }),
  });
  const projectId = created.json?.project?.id;
  await api(`/api/projects/${projectId}/generate`, { method: "POST" });
  const generated = await waitFor(
    async () => {
      const st = await api(`/api/projects/${projectId}/status`);
      return st.json?.status === "ready" ? st.json : null;
    },
    { timeout: 180000 },
  );
  record("a digital menu project generates", Boolean(generated));

  // Capture the design before any menu data exists, to prove sync cannot move it.
  const before = await api(`/api/projects/${projectId}/site`);
  const themeBefore = JSON.stringify(before.json?.site?.theme ?? {});

  let state = await api(`/api/projects/${projectId}/menu-source`);
  record("Google reported as configured but not yet connected",
    state.json?.google?.configured === true && state.json?.google?.connected === false);
  record("the required columns are exactly as specified",
    JSON.stringify(state.json?.requiredColumns) ===
      JSON.stringify(["name", "price", "description", "chefs choice", "category", "imageurl"]),
    (state.json?.requiredColumns ?? []).join(" | "));

  // OAuth: follow connect -> stub consent -> callback.
  const connect = await api(`/api/google/connect?returnTo=${encodeURIComponent(`/projects/${projectId}/menu-data`)}`);
  record(
    "connect redirects to Google consent",
    [302, 303, 307, 308].includes(connect.status) && Boolean(connect.location?.startsWith(GOOGLE)),
    `status ${connect.status}`,
  );

  const consent = await fetch(connect.location, { redirect: "manual" });
  const callbackUrl = new URL(consent.headers.get("location"));
  const callback = await api(`${callbackUrl.pathname}${callbackUrl.search}`);
  record(
    "the OAuth callback completes and returns to the menu screen",
    [302, 303, 307, 308].includes(callback.status) &&
      (callback.location ?? "").includes("google=connected"),
    `status ${callback.status}`,
  );

  state = await api(`/api/projects/${projectId}/menu-source`);
  record("the Google account is connected", state.json?.google?.connected === true,
    state.json?.google?.email ?? "");

  // Tokens must never leave the server.
  record("no tokens are exposed by the API",
    !JSON.stringify(state.json).match(/mock-access|mock-refresh|access_token|refresh_token/));

  console.log("\n=== Spreadsheet selection and column validation ===\n");

  const list = await api("/api/google/spreadsheets");
  record("the creator's spreadsheets are listed", (list.json?.spreadsheets ?? []).length >= 2);

  const tabs = await api("/api/google/tabs?spreadsheetId=sheet-menu");
  record("sheet tabs are listed", (tabs.json?.tabs ?? []).some((t) => t.title === "Menu"),
    (tabs.json?.tabs ?? []).map((t) => t.title).join(", "));

  // A sheet missing a required column must be refused, not silently accepted.
  await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "configure", spreadsheetId: "sheet-broken",
      spreadsheetName: "Menu missing a column", sheetTitle: "Sheet1",
    }),
  });
  const badSync = await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync" }),
  });
  record("a sheet missing a required column is refused", badSync.json?.ok === false);
  record("the missing column is named exactly",
    (badSync.json?.error ?? "").includes("imageurl"), badSync.json?.error ?? "");

  console.log("\n=== Sync ===\n");

  await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "configure", spreadsheetId: "sheet-menu",
      spreadsheetName: "Restaurant Menu", sheetTitle: "Menu",
    }),
  });
  const sync = await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync" }),
  });
  const stats = sync.json?.stats;
  record("synchronisation succeeds", sync.json?.ok === true, sync.json?.error ?? "");
  record("valid rows become menu items", stats?.items === 7, `items=${stats?.items}`);
  record("categories come from the sheet", stats?.categories === 4, `categories=${stats?.categories}`);
  record("Drive images are resolved", stats?.imagesResolved === 3, `resolved=${stats?.imagesResolved}`);
  record("bad rows are skipped, not fatal", stats?.rowsRejected === 2, `rejected=${stats?.rowsRejected}`);

  const findings = sync.json?.findings ?? [];
  const at = (row, needle) =>
    findings.some((f) => f.row === row && f.message.toLowerCase().includes(needle));
  record("the invalid price is reported with its row number", at(6, "not a valid price"));
  record("the empty name is reported with its row number", at(7, "name is empty"));
  record("the junk checkbox is reported as a warning",
    findings.some((f) => f.row === 9 && f.level === "warning"));
  record("the unreachable image is reported but keeps the dish",
    findings.some((f) => f.column === "imageurl" && f.level === "warning"));
  record("blank padding rows are not reported as errors",
    !findings.some((f) => f.row === 11));

  console.log("\n=== The generated menu ===\n");

  const after = await api(`/api/projects/${projectId}/site`);
  const themeAfter = JSON.stringify(after.json?.site?.theme ?? {});
  record("syncing menu content never changes the design", themeBefore === themeAfter);

  const html = await api(`/api/projects/${projectId}/render`);
  const page = html.text;
  record("dish names from the sheet are rendered", page.includes("Greek Salad") && page.includes("Beef Burger"));
  record("prices from the sheet are rendered", page.includes("8.50") && page.includes("14.00"));
  record("descriptions from the sheet are rendered", page.includes("Fresh tomatoes, feta and olives"));
  record("categories from the sheet become sections",
    page.includes("Starters") && page.includes("Main Courses") && page.includes("Desserts"));
  record("only categories with items appear", !page.includes("Wines") && !page.includes("Pizza"));
  record("a chef's choice item shows the badge", /class="chefs"/.test(page));
  record("the raw TRUE/FALSE value is never shown to visitors",
    !/>\s*(TRUE|FALSE)\s*</.test(page));
  record("skipped rows do not appear", !page.includes("Mystery Dish") && !page.includes("An orphan row"));
  record("a dish whose image failed still appears", page.includes("Espresso"));
  record("resolved images are served from this site, not hot-linked from Drive",
    /<img[^>]+src="\/api\/assets\//.test(page) && !page.includes("drive.google.com"));
  record("menu images are lazy-loaded", /class="menu-thumb"[\s\S]{0,200}loading="lazy"/.test(page));

  console.log("\n=== Customer-facing only ===\n");

  const forbidden = [
    "Sync now", "Sync Now", "menu-source", "spreadsheet", "Spreadsheet",
    "Google Sheets", "googleapis", "Configure", "chefs choice", "imageurl",
  ];
  const leaked = forbidden.filter((needle) => page.includes(needle));
  record("the public menu contains no builder or spreadsheet controls",
    leaked.length === 0, leaked.join(", "));
  record("the public menu makes no request to Google", !page.includes("google.com"));

  console.log("\n=== Languages ===\n");

  const site = after.json?.site;
  const menuSection = (site?.sections ?? []).find((s) => s.type === "menu");
  const el = await api(`/api/projects/${projectId}/render?locale=el`);
  record("the Greek menu renders", el.status === 200 && el.text.includes('<html lang="el"'));

  const priceOf = (doc) => (doc.match(/<span class="price">([^<]*)<\/span>/g) ?? []).join("|");
  record("prices are identical in both languages", priceOf(page) === priceOf(el.text));
  // Compared by asset, not by URL: a preview URL carries a capability token
  // whose window can roll over between two renders. The property under test is
  // that both languages show the same photographs, in the same order.
  const imgOf = (doc) =>
    [...doc.matchAll(/menu-thumb"><img src="([^"?]+)/g)].map((m) => m[1]).join("|");
  record("images are identical in both languages", imgOf(page) === imgOf(el.text),
    `${imgOf(page)} vs ${imgOf(el.text)}`);
  record("chef's choice status is identical in both languages",
    (page.match(/class="chefs"/g) ?? []).length === (el.text.match(/class="chefs"/g) ?? []).length);

  console.log("\n=== Re-sync stability ===\n");

  const idsBefore = JSON.stringify(menuSection?.categories?.map((c) => [c.id, c.items.map((i) => i.id)]));
  const resync = await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync" }),
  });
  const after2 = await api(`/api/projects/${projectId}/site`);
  const menu2 = (after2.json?.site?.sections ?? []).find((s) => s.type === "menu");
  const idsAfter = JSON.stringify(menu2?.categories?.map((c) => [c.id, c.items.map((i) => i.id)]));
  record("re-syncing succeeds", resync.json?.ok === true);
  record("item ids are stable across syncs, so translations survive", idsBefore === idsAfter);
  record("re-syncing does not duplicate images",
    resync.json?.stats?.imagesResolved === 3, `resolved=${resync.json?.stats?.imagesResolved}`);

  /* Screenshots: a rendered menu is the deliverable, so it gets looked at. */
  if (process.env.WG_QA_SHOTS !== "0") {
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({
        ...(chromeExecutable() ? { executablePath: chromeExecutable() } : {}),
      });
      // Two viewports, because two products are being looked at: the menu a
      // customer scans on a phone, and the builder screen in a desktop window.
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 900 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      });
      const [name, value] = cookie.split("; ")[0].split("=");
      await ctx.addCookies([{ name, value, domain: "127.0.0.1", path: "/" }]);
      const shot = await ctx.newPage();
      mkdirSync("qa-screenshots", { recursive: true });

      await shot.goto(`${BASE}/api/projects/${projectId}/render`, { waitUntil: "networkidle" });
      await shot.screenshot({ path: "qa-screenshots/24-menu-from-sheet.png", fullPage: true });

      // The builder is a desktop application: its own screens are judged in a
      // desktop window, against the WCAG 2.2 pointer target size.
      await shot.setViewportSize({ width: 1280, height: 900 });
      await shot.goto(`${BASE}/projects/${projectId}/menu-data`, { waitUntil: "networkidle" });
      await shot.screenshot({ path: "qa-screenshots/25-menu-data-builder.png", fullPage: true });

      // It must still survive a narrow window, so overflow is checked at both.
      const overflow = await shot.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth + 1;
      });
      await shot.setViewportSize({ width: 390, height: 900 });
      await shot.waitForTimeout(200);
      const narrowOverflow = await shot.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth <= de.clientWidth + 1;
      });
      record("the Digital Menu Data screen has no horizontal overflow", overflow && narrowOverflow);
      await shot.setViewportSize({ width: 1280, height: 900 });
      await shot.waitForTimeout(200);

      const small = await shot.evaluate(() => {
        const out = [];
        const sel = 'button, a[href], input:not([type="hidden"]), select, textarea';
        for (const el of document.querySelectorAll(sel)) {
          const st = getComputedStyle(el);
          if (st.display === "none" || st.visibility === "hidden") continue;
          if (st.clipPath && st.clipPath !== "none") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (el.tagName === "A" && st.display === "inline") continue;
          // 24px: the pointer minimum, for a screen used with a mouse.
          if (r.height < 23.5 || r.width < 23.5) out.push(`${el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return out;
      });
      record("the Digital Menu Data screen keeps usable pointer targets", small.length === 0, small.join("; "));

      await browser.close();
    } catch (err) {
      console.log(`  (screenshots skipped: ${err instanceof Error ? err.message : err})`);
    }
  }

  console.log("\n=== Failure handling ===\n");

  stop(google);
  await sleep(600);
  const offline = await api(`/api/projects/${projectId}/menu-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sync" }),
  });
  record("a failed sync reports an error rather than succeeding", offline.json?.ok === false);

  const stillThere = await api(`/api/projects/${projectId}/render`);
  record("the last good menu is still served after a failed sync",
    stillThere.text.includes("Greek Salad"));
  record("no invented menu data replaces it", !stillThere.text.includes("Lorem"));
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
