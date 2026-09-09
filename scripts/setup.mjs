#!/usr/bin/env node
/**
 * First-launch setup.
 *
 * Checks for Ollama and installs the smallest model that can write good
 * queries for the ui-ux-pro-max design catalogue. Everything here is
 * optional — the app generates websites without any of it — so this script
 * never fails the install. It reports what it found and moves on.
 *
 * The server does the same check itself on first launch; this exists so the
 * step can be run deliberately, and so `npm run setup` has something to say.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
const MODEL = process.env.WG_OLLAMA_MODEL || "qwen2.5:0.5b";

const ok = (m) => console.log(`  ✓ ${m}`);
const no = (m) => console.log(`  · ${m}`);

console.log("\nWebsite Generator — setup\n");

/* 1. The design catalogue -------------------------------------------------- */
const skill = path.resolve("vendor/ui-ux-pro-max/scripts/search.py");
if (!existsSync(skill)) {
  no("ui-ux-pro-max is missing. Run: node scripts/refresh-uiux-skill.mjs");
} else {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    ok("Design catalogue (ui-ux-pro-max) ready");
  } catch {
    no("Python 3 not found — the design catalogue cannot run. Designs will use built-in presets.");
  }
}

/* 2. The local model ------------------------------------------------------- */
async function tags() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const inventory = await tags();

if (!inventory) {
  no(`Ollama not running at ${HOST}.`);
  console.log(
    "\n    Optional. Install it from https://ollama.com and re-run `npm run setup`",
  );
  console.log("    to let a small local model write the design-catalogue queries.");
  console.log("    Without it, a built-in rule set writes them instead.\n");
  process.exit(0);
}

const installed = (inventory.models ?? []).map((m) => m.name || m.model || "");
if (installed.some((m) => m === MODEL || m.split(":")[0] === MODEL.split(":")[0])) {
  ok(`Local design model ${MODEL} ready`);
  console.log("");
  process.exit(0);
}

console.log(`  · Downloading ${MODEL} (a few hundred MB, one time)…`);

try {
  const res = await fetch(`${HOST}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastShown = -1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.error) throw new Error(msg.error);
      if (msg.total && msg.completed) {
        const pct = Math.floor((msg.completed / msg.total) * 100);
        // Only redraw on whole-decile changes; this may be a CI log.
        if (pct >= lastShown + 10) {
          lastShown = pct;
          console.log(`    ${pct}%`);
        }
      }
    }
  }
  ok(`Local design model ${MODEL} installed`);
} catch (err) {
  no(`Could not download ${MODEL}: ${err instanceof Error ? err.message : err}`);
  console.log("    The app still works — the built-in rule set writes the queries.");
}

console.log("");
