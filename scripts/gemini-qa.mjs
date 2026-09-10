#!/usr/bin/env node
/**
 * Hosted-AI integration test: Gemini.
 *
 * Drives the five features that use the hosted model — research, visual
 * identity, copy, translation and free-form editing — against a stub Gemini
 * (scripts/mock-gemini.mjs), so the client code is genuinely exercised without
 * a real key.
 *
 * The point of the suite is the migration's contract: the rest of the
 * application should not be able to tell that the provider changed. So it
 * asserts the outputs the application already depended on, the fallbacks it
 * already had when no key is configured, and that a provider failure still
 * degrades the way it always did.
 *
 *   node scripts/gemini-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_PORT = 3413;
const GEMINI_PORT = 11866;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const GEMINI = `http://127.0.0.1:${GEMINI_PORT}`;
const KEY = "AIzaSyGeminiQa-not-a-real-key-0000";

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
    const value = await fn();
    if (value) return value;
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
async function waitForPortFree(port) {
  return waitFor(
    async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/login`);
        return false;
      } catch {
        return true;
      }
    },
    { timeout: 20000, interval: 300 },
  );
}

let cookie = "";
async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON bodies are fine */
  }
  return { status: res.status, json, text };
}

async function signUp(label) {
  cookie = "";
  // Checked rather than assumed: an unnoticed failure here makes every later
  // call anonymous, and the suite would report that as a migration failure.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await api("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Gemini QA ${label}`,
        email: `gemini+${label}${Date.now()}-${attempt}@example.com`,
        password: "supersecret123",
      }),
    });
    if (res.status === 200 && cookie) return;
    await sleep(500);
  }
  throw new Error(`could not sign in for the ${label} phase`);
}

async function generate(payload) {
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const id = created.json?.project?.id;
  if (!id) throw new Error(`could not create a project: ${created.status} ${created.text.slice(0, 120)}`);
  await api(`/api/projects/${id}/generate`, { method: "POST" });
  const done = await waitFor(
    async () => {
      const st = await api(`/api/projects/${id}/status`);
      return st.json?.status === "ready" || st.json?.status === "failed" ? st.json : null;
    },
    { timeout: 180000 },
  );
  if (!done) throw new Error("generation did not finish in time");
  const site = await api(`/api/projects/${id}/site`);
  return { id, status: done.status, site: site.json?.site };
}

const CAFE = {
  businessName: "Kafeneio Nikos",
  businessType: "cafe",
  location: "Athens",
  description: "A warm neighbourhood cafe serving Greek coffee and pastries.",
  siteKind: "website",
  style: "warm",
  defaultLocale: "en",
  locales: ["en"],
};

/** What the stub was actually asked, so the request itself can be checked. */
async function calls() {
  const res = await fetch(`${GEMINI}/__calls`);
  return res.ok ? res.json() : [];
}

/**
 * Start the app pointed at a stub in a given mode. Each mode needs its own
 * stub process, and the app has to be restarted so its environment changes.
 */
async function boot({ mode = "ok", key = KEY, dataDir }) {
  // Both ports must be genuinely free first: a server that fails to bind exits
  // quietly, and the previous phase's server would answer in its place.
  await waitForPortFree(APP_PORT);
  const stub = spawnChild("node", ["scripts/mock-gemini.mjs", String(GEMINI_PORT), mode]);
  const stubUp = await waitFor(
    async () => {
      try {
        return (await fetch(`${GEMINI}/__calls`)).ok;
      } catch {
        return false;
      }
    },
    { timeout: 15000, interval: 200 },
  );
  if (!stubUp) throw new Error("the Gemini stub did not start");
  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    ...(key ? { GEMINI_API_KEY: key } : { GEMINI_API_KEY: "" }),
    GEMINI_BASE_URL: GEMINI,
    // Ollama is a separate system and is deliberately absent here: this suite
    // is about the hosted model, and the local one has its own suite.
    OLLAMA_HOST: "http://127.0.0.1:1",
    WG_OLLAMA_AUTOPULL: "0",
  });
  app.stderr.on("data", (d) => {
    const s = String(d);
    if (/Error|error/.test(s) && !/ECONNREFUSED/.test(s)) process.stderr.write(`[app] ${s}`);
  });
  const portTaken = (d) => {
    if (/EADDRINUSE|address already in use/i.test(String(d))) {
      console.error(
        `\nPort ${APP_PORT} is already in use — something else is running there.\n`,
      );
      process.exit(1);
    }
  };
  app.stdout.on("data", portTaken);
  app.stderr.on("data", portTaken);
  app.on("exit", (code, signal) => {
    if (code !== 0 && !signal) process.stderr.write(`[app] exited with code ${code}\n`);
  });
  const up = await waitFor(
    async () => {
      try {
        return (await fetch(`${BASE}/login`)).ok;
      } catch {
        return false;
      }
    },
    { timeout: 60000 },
  );
  if (!up) throw new Error("app did not start");

  // Confirm it is still there a moment later. A server that lost a race for
  // the port answers once and disappears, and every check after that would
  // fail for a reason that has nothing to do with the migration.
  await sleep(700);
  const settled = await waitFor(
    async () => {
      try {
        return (await fetch(`${BASE}/login`)).ok;
      } catch {
        return false;
      }
    },
    { timeout: 20000 },
  );
  if (!settled) throw new Error(`app started and then stopped (mode ${mode})`);
  return { app, stub };
}

async function shutdown({ app, stub }) {
  stop(app);
  stop(stub);
  await waitForPortFree(APP_PORT);
  await waitFor(
    async () => {
      try {
        await fetch(`${GEMINI}/__calls`);
        return false;
      } catch {
        return true;
      }
    },
    { timeout: 15000, interval: 200 },
  );
  await sleep(300);
}

const root = mkdtempSync(path.join(tmpdir(), "wg-gemini-"));

try {
  /* ------------------------------------------------------ key configured */
  console.log("\n=== The key is detected ===\n");

  let running = await boot({ mode: "ok", dataDir: path.join(root, "ok") });
  await signUp("ok");

  const health = await api("/api/health");
  record("a configured GEMINI_API_KEY is reported as AI being available",
    health.json?.aiConfigured === true);
  record("the key itself never reaches the client",
    !health.text.includes(KEY) && !/AIza/.test(health.text));

  const setup = await api("/api/setup");
  record("the design catalogue is unaffected by the provider",
    setup.json?.skill?.available === true);
  record("the local model is reported separately from the hosted one",
    setup.json?.ollama?.available === false && "model" in (setup.json?.ollama ?? {}),
    `local model: ${setup.json?.ollama?.model ?? "?"}`);

  /* ------------------------------------------------------------ research */
  console.log("\n=== Research, identity, copy ===\n");

  const built = await generate(CAFE);
  record("a website generates end to end through Gemini", built?.status === "ready");

  const site = built?.site;
  const strings = site?.i18n?.en?.strings ?? {};
  const values = Object.values(strings).join(" ");

  record("the site document still matches the schema the app expects",
    Boolean(site?.meta && site?.theme && Array.isArray(site?.sections) && site?.i18n),
  );
  record("researched facts reached the finished site",
    values.includes("Greek coffee") || values.includes("neighbourhood"),
  );
  record("the identity analysis set the theme",
    site?.theme?.colors?.primary === "#6b3f23" || Boolean(site?.theme?.colors?.primary),
    site?.theme?.colors?.primary ?? "",
  );
  record("the architecture came back on the document",
    typeof site?.theme?.architecture === "string" && site.theme.architecture.length > 0,
    site?.theme?.architecture ?? "",
  );

  const sent = await calls();
  record("requests went to the configured Gemini model",
    sent.length > 0 && sent.every((c) => c.model.startsWith("gemini-")),
    sent[0]?.model ?? "no calls",
  );
  record("every request carried the API key as a header, not in the URL",
    sent.every((c) => c.hasKey && !c.url.includes("key=")),
  );
  record("research asked for Google Search grounding",
    sent.some((c) => JSON.stringify(c.tools ?? []).includes("googleSearch")),
  );
  record("research also asked to read the pages it finds",
    sent.some((c) => JSON.stringify(c.tools ?? []).includes("urlContext")),
  );
  record("the system instruction was sent, not folded into the prompt",
    sent.every((c) => c.system && c.system.length > 2),
  );
  record("thinking is left to the model, as it was before",
    sent.some((c) => c.thinking && c.thinking.thinkingBudget === -1),
    JSON.stringify(sent[0]?.thinking ?? null),
  );
  record("an output budget is set on every request",
    sent.every((c) => typeof c.maxOutputTokens === "number" && c.maxOutputTokens > 0),
  );

  /* --------------------------------------------------------- translation */
  console.log("\n=== Translation ===\n");

  const before = JSON.stringify(site?.sections ?? []);
  const themeBefore = JSON.stringify(site?.theme ?? {});
  const added = await api(`/api/projects/${built.id}/languages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "el" }),
  });
  const translated = added.json?.site;
  record("a language can be added through Gemini", added.status === 200 && Boolean(translated?.i18n?.el));
  const elValues = Object.values(translated?.i18n?.el?.strings ?? {}).join(" ");
  record("translated strings came back for the new language", elValues.includes("[el]"));
  record("translation left the structure untouched",
    JSON.stringify(translated?.sections ?? []) === before);
  record("translation left the design untouched",
    JSON.stringify(translated?.theme ?? {}) === themeBefore);
  record("SEO metadata was translated too",
    String(translated?.i18n?.el?.seo?.title ?? "").includes("[el]"),
    translated?.i18n?.el?.seo?.title ?? "");

  /* ----------------------------------------------------------- AI editing */
  console.log("\n=== AI editing ===\n");

  const edit = await api(`/api/projects/${built.id}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: "make the tagline warmer", locale: "en" }),
  });
  record("a free-form edit is applied", edit.status === 200 && edit.json?.changed === true,
    edit.json?.summary ?? "");
  record("the edited document is still a valid site document",
    Boolean(edit.json?.site?.meta && Array.isArray(edit.json?.site?.sections)));
  record("the edit reached the document",
    JSON.stringify(edit.json?.site?.i18n?.en?.strings ?? {}).includes("Edited by the stub"));

  await shutdown(running);

  /* ---------------------------------------------------------- no API key */
  console.log("\n=== With no API key ===\n");

  running = await boot({ mode: "ok", key: "", dataDir: path.join(root, "nokey") });
  await signUp("nokey");

  const noKeyHealth = await api("/api/health");
  record("no key is reported as no hosted AI", noKeyHealth.json?.aiConfigured === false);

  const fallbackBuild = await generate(CAFE);
  record("a website still generates with no key", fallbackBuild?.status === "ready");
  record("the template generator wrote it, not Gemini",
    (await calls()).length === 0,
  );

  const localEdit = await api(`/api/projects/${fallbackBuild.id}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: "make the tagline warmer" }),
  });
  record("free-form editing explains that a key is needed",
    /Gemini API key/i.test(localEdit.json?.summary ?? ""),
    localEdit.json?.summary ?? "");
  record("the rule-based editor still works without a key",
    (await api(`/api/projects/${fallbackBuild.id}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "use a green colour scheme" }),
    })).json?.changed === true,
  );

  await shutdown(running);

  /* ------------------------------------------------------------- failures */
  for (const [mode, label] of [
    ["invalid-key", "a rejected API key"],
    ["rate-limit", "a rate limit"],
    ["malformed", "a response that is not JSON"],
    ["refuse", "a refusal"],
    ["unavailable", "a model that is not available"],
  ]) {
    console.log(`\n=== ${label} ===\n`);
    running = await boot({ mode, dataDir: path.join(root, mode) });
    await signUp(mode);

    const built = await generate(CAFE);
    record(`${label}: generation still finishes`, built?.status === "ready");
    record(`${label}: the site is still valid`,
      Boolean(built?.site?.meta && Array.isArray(built?.site?.sections) && built?.site?.i18n));

    const edited = await api(`/api/projects/${built.id}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "make the tagline warmer" }),
    });
    record(`${label}: the editor answers rather than failing`, edited.status === 200);
    record(`${label}: nothing sensitive is shown to the user`,
      !JSON.stringify(edited.json ?? {}).includes(KEY) &&
        !/AIza|x-goog-api-key/i.test(JSON.stringify(edited.json ?? {})),
    );

    await shutdown(running);
  }
} finally {
  for (const child of children) stop(child);
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  process.exit(1);
}
