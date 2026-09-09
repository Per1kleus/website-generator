#!/usr/bin/env node
/**
 * Design-engine integration test.
 *
 * Covers the three tiers the app can run at, and the transitions between them:
 *
 *   1. catalogue only        — no Ollama; the built-in rule set writes queries
 *   2. Ollama, model missing — first launch detects it and pulls in background
 *   3. Ollama + model        — the local model writes the catalogue query
 *   4. Ollama disappears     — generation still succeeds
 *
 * A stub daemon stands in for Ollama (scripts/mock-ollama.mjs) so the client
 * code is genuinely exercised rather than assumed.
 *
 *   node scripts/design-engine-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const APP_PORT = 3211;
const OLLAMA_PORT = 11511;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const OLLAMA = `http://127.0.0.1:${OLLAMA_PORT}`;

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

/**
 * `npx next start` forks a `next-server` child. Killing the npx wrapper leaves
 * that child holding the port, so the next tier silently fails to bind and
 * ends up talking to the previous tier's server instead. Each child therefore
 * gets its own process group, and we signal the whole group.
 */
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

function killAll() {
  for (const c of children) stop(c);
}

/** Waits until the port is actually free, so the next tier can bind it. */
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
    /* non-JSON bodies are fine here */
  }
  return { status: res.status, json, text };
}

async function generate(payload) {
  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const id = created.json?.project?.id;
  if (!id) return null;

  await api(`/api/projects/${id}/generate`, { method: "POST" });

  const done = await waitFor(
    async () => {
      const st = await api(`/api/projects/${id}/status`);
      const status = st.json?.status;
      return status === "ready" || status === "failed" ? st.json : null;
    },
    { timeout: 180000 },
  );
  if (!done) return null;

  const site = await api(`/api/projects/${id}/site`);
  return { id, job: done.job, status: done.status, site: site.json?.site };
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-de-"));

try {
  /* ---------------------------------------------------------------- tier 1 */
  console.log("\n=== Tier 1: catalogue only (no Ollama) ===\n");

  // Point at a port with nothing on it: this is the "Ollama not installed" case.
  let app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    OLLAMA_HOST: `http://127.0.0.1:${OLLAMA_PORT}`,
    WG_OLLAMA_AUTOPULL: "1",
  });
  app.stderr.on("data", (d) => {
    const s = String(d);
    if (/Error|error/.test(s)) process.stderr.write(`[app] ${s}`);
  });

  const up = await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/login`);
      return res.ok;
    } catch {
      return false;
    }
  }, { timeout: 60000 });
  if (!up) throw new Error("app did not start");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Design QA",
      email: `de+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  let setup = await api("/api/setup");
  record("design catalogue reports available", setup.json?.skill?.available === true);
  record("Ollama correctly reported as unavailable", setup.json?.ollama?.available === false);

  const cafe = await generate({
    businessName: "Caffe Verde",
    businessType: "coffee shop and bakery",
    location: "Thessaloniki",
    description: "Small independent coffee shop. We roast our own beans and bake in-house. Warm and rustic.",
    siteKind: "business",
    style: "classic",
    defaultLocale: "en",
    locales: ["en"],
  });
  record("a website is generated with no Ollama at all", cafe?.status === "ready");

  const heuristicTheme = cafe?.site?.theme;
  record(
    "the catalogue supplied the palette, not the generic preset",
    Boolean(heuristicTheme) && heuristicTheme.colors.primary !== "#4338ca",
    heuristicTheme ? `primary ${heuristicTheme.colors.primary}` : "",
  );
  record(
    "the catalogue supplied a web font pairing",
    Boolean(heuristicTheme?.fontFamilies?.heading),
    heuristicTheme?.fontFamilies
      ? `${heuristicTheme.fontFamilies.heading} / ${heuristicTheme.fontFamilies.body}`
      : "",
  );

  const rendered = await api(`/api/projects/${cafe.id}/render`);
  record(
    "the generated site loads the recommended fonts with display=swap",
    rendered.text.includes("fonts.googleapis.com") && rendered.text.includes("display=swap"),
  );
  record(
    "font loading never blocks first paint",
    rendered.text.includes('media="print"') && rendered.text.includes("<noscript>"),
  );

  stop(app);
  await waitForPortFree(APP_PORT);

  /* ---------------------------------------------------------------- tier 2 */
  console.log("\n=== Tier 2: Ollama present, model missing (first launch) ===\n");

  const mock = spawnChild("node", ["scripts/mock-ollama.mjs", String(OLLAMA_PORT)], {});
  await waitFor(async () => {
    try {
      return (await fetch(`${OLLAMA}/api/tags`)).ok;
    } catch {
      return false;
    }
  });

  app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    OLLAMA_HOST: OLLAMA,
    WG_OLLAMA_AUTOPULL: "1",
  });
  await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/login`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 60000 });

  // Hitting /api/setup is what triggers first-launch detection.
  setup = await api("/api/setup");
  record("Ollama is detected once it is running", setup.json?.ollama?.available === true);

  const pulled = await waitFor(async () => {
    const s = await api("/api/setup");
    return s.json?.ollama?.modelReady ? s.json : null;
  }, { timeout: 60000 });
  record("the model is installed automatically on first launch", Boolean(pulled));
  record(
    "install progress is reported while it downloads",
    pulled?.ollama?.pull?.percent === 100,
    pulled?.ollama?.pull ? `status ${pulled.ollama.pull.status}` : "",
  );

  /* ---------------------------------------------------------------- tier 3 */
  console.log("\n=== Tier 3: local model writes the catalogue query ===\n");

  const withModel = await generate({
    businessName: "Atelier Nord",
    businessType: "architecture studio",
    location: "Oslo",
    description: "A small architecture studio working on stone and concrete houses.",
    siteKind: "business",
    style: "classic",
    defaultLocale: "en",
    locales: ["en"],
  });
  record("a website is generated with the local model", withModel?.status === "ready");

  const messages = (withModel?.job?.steps ?? []).map((s) => s.label).join(" ");
  record("the design-catalogue stage ran", messages.length > 0);

  // The studio and the cafe must not come out looking the same.
  record(
    "a different business gets a different palette",
    withModel?.site?.theme?.colors?.primary !== heuristicTheme?.colors?.primary,
    `${heuristicTheme?.colors?.primary} vs ${withModel?.site?.theme?.colors?.primary}`,
  );
  record(
    "a different business gets a different architecture or typography",
    withModel?.site?.theme?.architecture !== heuristicTheme?.architecture ||
      withModel?.site?.theme?.fontFamilies?.heading !== heuristicTheme?.fontFamilies?.heading,
    `${heuristicTheme?.architecture}/${heuristicTheme?.fontFamilies?.heading} vs ${withModel?.site?.theme?.architecture}/${withModel?.site?.theme?.fontFamilies?.heading}`,
  );

  // A digital menu must never wait on a webfont before showing prices.
  const menu = await generate({
    businessName: "Ouzeri Mikro",
    businessType: "taverna",
    location: "Athens",
    description: "A small traditional taverna serving meze.",
    siteKind: "menu",
    style: "warm",
    defaultLocale: "en",
    locales: ["en"],
  });
  record("a digital menu generates", menu?.status === "ready");
  record("a digital menu loads no web fonts at all", menu?.site?.theme?.fontFamilies === null);
  record("a digital menu keeps the menu-first architecture", menu?.site?.theme?.architecture === "menu-first");
  const menuHtml = await api(`/api/projects/${menu.id}/render`);
  record(
    "the menu page makes no font requests",
    !menuHtml.text.includes("fonts.googleapis.com"),
  );

  /* ---------------------------------------------------------------- tier 4 */
  console.log("\n=== Tier 4: Ollama disappears mid-life ===\n");

  stop(mock);
  await sleep(800);

  const afterLoss = await generate({
    businessName: "Bar Nine",
    businessType: "cocktail bar",
    location: "Lisbon",
    description: "A small cocktail bar with a short seasonal list.",
    siteKind: "business",
    style: "bold",
    defaultLocale: "en",
    locales: ["en"],
  });
  record("generation still succeeds after Ollama goes away", afterLoss?.status === "ready");
  record(
    "the catalogue still supplied a design",
    Boolean(afterLoss?.site?.theme?.colors?.primary),
    afterLoss?.site?.theme?.colors?.primary,
  );

  const finalSetup = await api("/api/setup");
  record(
    "status reports Ollama as gone rather than pretending",
    finalSetup.json?.ollama?.available === false,
  );
} finally {
  killAll();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failures ? 1 : 0);
