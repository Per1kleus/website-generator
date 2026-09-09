#!/usr/bin/env node
/**
 * First-launch setup test.
 *
 * Drives desktop/bootstrap/run.mjs exactly as the Tauri shell does — spawning
 * it, reading its NDJSON, answering its questions — so the whole setup can be
 * tested without Windows, a GUI, or a real 1 GB download.
 *
 * The cases here are the ones the requirements name: install once, do not
 * reinstall what is present, survive an interrupted download, recover from a
 * failure, and never mark setup complete on the strength of a download alone.
 *
 *   node scripts/setup-qa.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OLLAMA_PORT = 11744;
const OLLAMA = `http://127.0.0.1:${OLLAMA_PORT}`;

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const children = [];
function spawnChild(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  return child;
}
function stop(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/**
 * Run the bootstrap and collect its events.
 *
 * `answer` decides what to reply to each question, which is how the model
 * confirmation, the retry prompt and the skip path are all exercised.
 */
function runSetup(dataDir, { answer = () => ({ skip: true }), extraArgs = [], env = {}, killAt = null } = {}) {
  return new Promise((resolve) => {
    const child = spawnChild(
      process.execPath,
      ["desktop/bootstrap/run.mjs", "--data-dir", dataDir, "--no-install", ...extraArgs],
      { OLLAMA_HOST: OLLAMA, ...env },
    );
    const events = [];
    let buffer = "";
    let killed = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        events.push(event);
        if (killAt && !killed && killAt(event)) {
          killed = true;
          // Pulling the power out mid-download, as far as this process knows.
          stop(child);
          continue;
        }
        if (event.t === "ask") {
          const reply = answer(event) ?? { skip: true };
          child.stdin.write(`${JSON.stringify({ id: event.id, ...reply })}\n`);
        }
      }
    });
    child.on("exit", (code) => resolve({ events, code, killed }));
  });
}

const useRecommended = (event) =>
  event.kind === "model" ? { answer: { model: event.recommended.id } } : { skip: true };

const find = (events, t, id) => events.find((e) => e.t === t && (!id || e.id === id));
/** The finished step, not the "running" one that shares its id. */
const finished = (events, id) =>
  [...events].reverse().find((e) => e.t === "step" && e.id === id && e.state !== "running");
const stepState = (events, id) =>
  [...events].reverse().find((e) => e.t === "step" && e.id === id)?.state ?? null;

const root = mkdtempSync(path.join(tmpdir(), "wg-setup-"));

try {
  const mock = spawnChild("node", ["scripts/mock-ollama.mjs", String(OLLAMA_PORT)]);
  await sleep(700);

  /* ------------------------------------------------------------ first run */
  console.log("\n=== First launch ===\n");

  const dataDir = path.join(root, "app");
  const first = await runSetup(dataDir, { answer: useRecommended });

  record("setup runs because nothing is initialised",
    find(first.events, "begin")?.reason === "first-launch");
  record("it inspects the computer before deciding anything",
    stepState(first.events, "hardware") === "done");

  const hardware = finished(first.events, "hardware")?.detail ?? [];
  const labels = hardware.map(([k]) => k);
  record("it reports system, processor, memory, graphics and disk",
    ["System", "Processor", "Memory", "Graphics", "Free space"].every((l) => labels.includes(l)),
    labels.join(", "));

  record("UI/UX Pro Max is installed", stepState(first.events, "uiux") === "done");
  const uiuxDetail = finished(first.events, "uiux")?.detail ?? [];
  record("it reports the version it installed",
    /^\d+\.\d+\.\d+$/.test(String(uiuxDetail[0]?.[1] ?? "").replace("version ", "")),
    uiuxDetail[0]?.[1] ?? "");

  const skillDir = path.join(dataDir, "uiux", ".claude", "skills", "ui-ux-pro-max");
  record("the skill's own search script is on disk",
    existsSync(path.join(skillDir, "scripts", "search.py")));
  record("its catalogue data came with it",
    existsSync(path.join(skillDir, "data", "styles.csv")));

  const askedModel = find(first.events, "ask");
  record("the user is asked before a model is downloaded",
    askedModel?.kind === "model" && Boolean(askedModel.recommended?.id),
    askedModel?.recommended?.id ?? "not asked");
  record("the recommendation explains itself",
    typeof askedModel?.why === "string" && askedModel.why.length > 20);
  record("alternatives are offered as well",
    Array.isArray(askedModel?.options) && askedModel.options.length >= 3);

  const progress = first.events.filter((e) => e.t === "progress" && e.id === "model" && e.percent != null);
  record("download progress is real byte counts, not a timer",
    progress.length >= 2 && progress.every((p) => /\d+\s(MB|GB)\sof\s/.test(p.detail ?? "")),
    progress[0]?.detail ?? "no progress");
  record("progress only ever moves forward",
    progress.every((p, i) => i === 0 || p.percent >= progress[i - 1].percent));
  record("phases with no byte count report no percentage",
    first.events.some((e) => e.t === "progress" && e.id === "model" && e.percent === null));

  record("the model is verified, not just downloaded",
    first.events.some((e) => e.t === "progress" && /answers/i.test(e.detail ?? "")));
  record("setup finishes", find(first.events, "done")?.reason === "installed");
  record("the bootstrap process exits", first.code === 0, `exit ${first.code}`);

  const state = JSON.parse(readFileSync(path.join(dataDir, "setup-state.json"), "utf8"));
  record("initialisation is recorded outside the browser, in the data directory",
    Boolean(state.completedAt));
  record("the recorded model is the one that was confirmed",
    state.model?.id === askedModel.recommended.id && state.model.pending === false);
  record("the setup state carries no secrets",
    !JSON.stringify(state).match(/api[_-]?key|secret|token|password/i));

  /* ----------------------------------------------------------- second run */
  console.log("\n=== Second launch ===\n");

  const startedAt = Date.now();
  const second = await runSetup(dataDir, { answer: useRecommended });
  const elapsed = Date.now() - startedAt;

  record("setup does not run again",
    find(second.events, "done")?.reason === "already-initialised");
  record("nothing is downloaded",
    !second.events.some((e) => e.t === "progress" && e.percent != null));
  record("the user is asked nothing", !second.events.some((e) => e.t === "ask"));
  record("no hardware probing happens on the fast path",
    !second.events.some((e) => e.t === "step" && e.id === "hardware"));
  record("it decides quickly", elapsed < 3000, `${elapsed}ms`);

  /* ------------------------------------------- already-installed detection */
  console.log("\n=== Only what is missing ===\n");

  const reRun = await runSetup(dataDir, { answer: useRecommended, extraArgs: ["--force"] });
  record("a forced re-run keeps the installed design system",
    stepState(reRun.events, "uiux") === "skipped");
  record("it keeps the model that is already downloaded",
    stepState(reRun.events, "model") === "skipped");
  record("hardware is read from the record rather than probed again",
    JSON.parse(readFileSync(path.join(dataDir, "setup-state.json"), "utf8")).hardware.inspectedAt ===
      state.hardware.inspectedAt);

  /* --------------------------------------------------- interrupted download */
  console.log("\n=== Interrupted download ===\n");

  // Its own stub, on its own port: the earlier phases already downloaded a
  // model into the first one, and a machine that has it does not need to
  // resume anything.
  const freshPort = OLLAMA_PORT + 1;
  const freshMock = spawnChild("node", ["scripts/mock-ollama.mjs", String(freshPort)]);
  await sleep(700);
  const freshHost = { OLLAMA_HOST: `http://127.0.0.1:${freshPort}` };

  const interrupted = path.join(root, "interrupted");
  const cut = await runSetup(interrupted, {
    env: freshHost,
    answer: useRecommended,
    // Kill the process partway through the download, as a power cut would.
    killAt: (e) => e.t === "progress" && e.id === "model" && e.percent >= 20,
  });
  record("the download was interrupted partway", cut.killed);

  const cutState = JSON.parse(readFileSync(path.join(interrupted, "setup-state.json"), "utf8"));
  record("the interrupted model is recorded as unfinished", cutState.model?.pending === true);
  record("setup is not marked complete", !cutState.completedAt);
  record("what was already installed is kept",
    Boolean(cutState.uiux) && existsSync(path.join(interrupted, "uiux", ".claude", "skills", "ui-ux-pro-max")));

  const resumed = await runSetup(interrupted, { answer: useRecommended, env: freshHost });
  record("the next launch resumes rather than starting over",
    find(resumed.events, "begin")?.reason === "resume-download");
  record("it does not reinstall the design system",
    stepState(resumed.events, "uiux") === "skipped");
  record("the model download completes on the second attempt",
    stepState(resumed.events, "model") === "done");
  record("setup is complete afterwards",
    Boolean(JSON.parse(readFileSync(path.join(interrupted, "setup-state.json"), "utf8")).completedAt));

  /* ------------------------------------------------------- failure recovery */
  console.log("\n=== Failure recovery ===\n");

  const broken = path.join(root, "broken");
  stop(mock);
  stop(freshMock);
  await sleep(400);

  let retried = false;
  const failing = await runSetup(broken, {
    answer: (event) => {
      if (event.kind === "retry") {
        retried = true;
        return { skip: true };
      }
      return useRecommended(event);
    },
  });
  record("a failure is reported in plain language, not a stack trace",
    failing.events.some(
      (e) => e.t === "failed" && !/ at |node:internal/.test(e.message ?? ""),
    ),
    find(failing.events, "failed")?.message ?? "no failure reported");
  record("the user is offered a retry", retried || !failing.events.some((e) => e.t === "failed"));
  record("the application is still usable without local AI",
    find(failing.events, "done")?.reason === "installed");

  const brokenState = JSON.parse(readFileSync(path.join(broken, "setup-state.json"), "utf8"));
  record("a skipped local AI does not claim a model is ready",
    !brokenState.model || brokenState.model.pending !== false);

  /* ------------------------------------------------------ corrupt state file */
  console.log("\n=== Damaged state ===\n");

  writeFileSync(path.join(dataDir, "setup-state.json"), "{ this is not json");
  const afterCorruption = await runSetup(dataDir, {
    answer: (e) => (e.kind === "model" ? { skip: true } : { skip: true }),
  });
  record("a damaged marker means 'set up again', never 'silently broken'",
    find(afterCorruption.events, "begin")?.reason === "first-launch");
} finally {
  for (const child of children) stop(child);
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}`);
  process.exit(1);
}
