#!/usr/bin/env node
/**
 * First-launch setup, end to end.
 *
 * Drives desktop/bootstrap/run.mjs exactly as the Tauri shell does — spawning
 * it, reading its NDJSON, answering its questions — so the whole flow can be
 * tested without Windows, a GUI, or a real gigabyte download.
 *
 * The cases are the ones that actually happen on a user's machine, not just the
 * happy path: an interrupted download, a pull that dies partway, a daemon that
 * is listening but not serving yet, a daemon that never serves, a model that is
 * present but will not load, a model somebody deleted afterwards, a catalogue
 * file that went missing, a disk with no room, and an installation set up by an
 * older version of this application.
 *
 * Two rules the suite exists to defend: nothing is reported ready before its
 * underlying resource has been checked, and nothing already installed is
 * downloaded again.
 *
 *   node scripts/setup-qa.mjs
 */
import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE_PORT = 11744;
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
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

/** A stub Ollama on its own port, so one case's state never leaks into another. */
let nextPort = BASE_PORT;
async function startOllama(flags = []) {
  const port = nextPort++;
  const child = spawnChild("node", ["scripts/mock-ollama.mjs", String(port), ...flags]);
  const host = `http://127.0.0.1:${port}`;
  // Wait for the socket rather than sleeping a fixed time: a --never-ready stub
  // answers 503, which is still an answer and still means it is listening.
  for (let i = 0; i < 60; i += 1) {
    try {
      await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(300) });
      break;
    } catch {
      await sleep(100);
    }
  }
  return { child, host, port };
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
      env,
    );
    const events = [];
    let buffer = "";
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
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
          try {
            child.stdin.write(`${JSON.stringify({ id: event.id, ...reply })}\n`);
          } catch {
            /* the process is already gone */
          }
        }
      }
    });
    child.on("exit", (code) => resolve({ events, code, killed, stdout, stderr }));
  });
}

const useRecommended = (event) =>
  event.kind === "model" ? { answer: { model: event.recommended.id } } : { skip: true };
const retryThenSkip = (event) => (event.kind === "retry" ? { skip: true } : useRecommended(event));

const find = (events, t, id) => events.find((e) => e.t === t && (!id || e.id === id));
/** The finished step, not the "running" one that shares its id. */
const finished = (events, id) =>
  [...events].reverse().find((e) => e.t === "step" && e.id === id && e.state !== "running");
const stepState = (events, id) =>
  [...events].reverse().find((e) => e.t === "step" && e.id === id)?.state ?? null;
const readMarker = (dir) => JSON.parse(readFileSync(path.join(dir, "setup-state.json"), "utf8"));

const root = mkdtempSync(path.join(tmpdir(), "wg-setup-"));
const SKILL_REL = path.join("uiux", ".claude", "skills", "ui-ux-pro-max");

try {
  /* ==================================================================
     The manifest is the one source of truth
     ================================================================== */
  console.log("\n=== One authoritative manifest ===\n");

  const manifest = await import("../desktop/bootstrap/manifest.mjs");
  const models = await import("../desktop/bootstrap/models.mjs");
  const localai = await import("../desktop/bootstrap/localai.mjs");
  const uiux = await import("../desktop/bootstrap/uiux.mjs");
  const stateModule = await import("../desktop/bootstrap/state.mjs");

  record(
    "the required model comes from the manifest",
    manifest.requiredModel() === manifest.MANIFEST.ai.requiredModel,
    manifest.requiredModel(),
  );
  record(
    "the model ladder is the manifest's, not a second copy",
    models.LADDER === manifest.MANIFEST.ai.models,
  );
  record(
    "the required model is on the ladder",
    models.LADDER.some((m) => m.id === manifest.requiredModel()),
  );
  record(
    "the server reads the same manifest file",
    JSON.parse(readFileSync("desktop/bootstrap/manifest.json", "utf8")).ai.requiredModel ===
      manifest.MANIFEST.ai.requiredModel,
  );
  record(
    "no source file names a model of its own",
    !/"qwen2\.5/.test(
      ["src/server/ollama.ts", "src/server/setup-manifest.ts", "desktop/bootstrap/models.mjs", "scripts/setup.mjs"]
        .map((f) => readFileSync(f, "utf8"))
        .join("\n"),
    ),
  );
  record(
    "every skill the manifest requires names the files that prove it",
    manifest.skills().every((s) => s.requiredFiles.length >= 2 && s.verify?.script),
    `${manifest.skills().length} skill(s), ${manifest.skills()[0].requiredFiles.length} files`,
  );

  /* ==================================================================
     Download integrity
     ================================================================== */
  console.log("\n=== The Ollama installer is verified before it is run ===\n");

  const spec = manifest.installerSpec();
  const realish = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(spec.minBytes)]);
  record(
    "a genuine Windows installer passes",
    localai.checkInstaller(realish, { declared: realish.byteLength }).ok,
  );
  record(
    "a truncated download is refused",
    localai.checkInstaller(realish.subarray(0, 4096), { declared: realish.byteLength }).reason ===
      "the download was incomplete",
  );
  record(
    "an implausibly small download is refused",
    localai.checkInstaller(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(1024)])).reason ===
      "the download was not the expected size",
  );
  record(
    "a captive-portal page served as the installer is refused",
    localai.checkInstaller(
      Buffer.concat([Buffer.from("<!doctype html>"), Buffer.alloc(spec.minBytes)]),
    ).reason === "the download was not a Windows installer",
  );
  record(
    "a pinned checksum that does not match is refused",
    localai.checkInstaller(realish, { env: { [spec.sha256Env]: "deadbeef" } }).reason ===
      "the download did not match the expected checksum",
  );
  const digest = (await import("node:crypto")).createHash("sha256").update(realish).digest("hex");
  record(
    "a pinned checksum that matches is accepted, and says it was pinned",
    localai.checkInstaller(realish, { env: { [spec.sha256Env]: digest } }).pinned === true,
  );
  record(
    "nothing is installed automatically on a platform that has no installer",
    (await localai.installRuntime(() => {})).reason === "unsupported-platform",
  );

  /* ==================================================================
     Waiting for Ollama
     ================================================================== */
  console.log("\n=== Ollama readiness ===\n");

  const slow = await startOllama(["--ready-after", "2500"]);
  process.env.OLLAMA_HOST = slow.host;
  const slowStart = Date.now();
  const becameReady = await localai.waitForDaemon({ timeoutMs: 20000 });
  const waited = Date.now() - slowStart;
  record(
    "a daemon that is not answering yet is waited for, not given up on",
    becameReady && waited >= 2000 && waited < 20000,
    `answered after ${waited}ms`,
  );
  let backoffAttempts = 0;
  const never = await startOllama(["--never-ready"]);
  process.env.OLLAMA_HOST = never.host;
  const neverReady = await localai.waitForDaemon({
    timeoutMs: 3000,
    onWait: () => (backoffAttempts += 1),
  });
  record("a daemon that never answers is reported, not waited on for ever", neverReady === false);
  record("the wait backs off rather than hammering it", backoffAttempts >= 2 && backoffAttempts < 30, `${backoffAttempts} polls`);
  record(
    "an unreachable daemon is 'unknown', never 'the model is gone'",
    (await localai.modelPresent(manifest.requiredModel())) === null,
  );
  stop(slow.child);
  stop(never.child);
  delete process.env.OLLAMA_HOST;

  /* ==================================================================
     First launch
     ================================================================== */
  console.log("\n=== First launch ===\n");

  const main = await startOllama();
  const dataDir = path.join(root, "app");
  const first = await runSetup(dataDir, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });

  record("setup runs because nothing is initialised",
    find(first.events, "begin")?.reason === "first-launch");
  record("the application's own folders are prepared first",
    stepState(first.events, "application") === "done" &&
      manifest.MANIFEST.application.directories.every((d) => existsSync(path.join(dataDir, d))),
    manifest.MANIFEST.application.directories.join(", "));
  record("it inspects the computer before deciding anything",
    stepState(first.events, "hardware") === "done");

  const hardware = finished(first.events, "hardware")?.detail ?? [];
  const labels = hardware.map(([k]) => k);
  record("it reports system, processor, memory, graphics and disk",
    ["System", "Processor", "Memory", "Graphics", "Free space"].every((l) => labels.includes(l)),
    labels.join(", "));

  record("free space is checked before anything large is downloaded",
    stepState(first.events, "disk") === "done" &&
      first.events.findIndex((e) => e.t === "step" && e.id === "disk") <
        first.events.findIndex((e) => e.t === "ask" && e.kind === "model"));

  record("every required skill is installed", stepState(first.events, "skills") === "done");
  const skillDetail = finished(first.events, "skills")?.detail ?? [];
  record("it says how many of each skill's files are there, and whether it answers",
    /\d+ of \d+ files/.test(String(skillDetail[0]?.[1] ?? "")) &&
      /answering/.test(String(skillDetail[0]?.[1] ?? "")),
    skillDetail[0]?.[1] ?? "");

  const skillDir = path.join(dataDir, SKILL_REL);
  const requiredFiles = manifest.skills()[0].requiredFiles;
  record("every file the manifest requires is on disk, not just the directory",
    requiredFiles.every((f) => existsSync(path.join(skillDir, f))),
    `${requiredFiles.length} files`);
  record("the application's own loader can use it",
    (await uiux.verify(dataDir, "python3")).ok);

  const askedModel = find(first.events, "ask");
  record("the user is asked before a model is downloaded",
    askedModel?.kind === "model" && Boolean(askedModel.recommended?.id),
    askedModel?.recommended?.id ?? "not asked");
  record("the model offered is the one the manifest requires",
    askedModel?.recommended?.id === manifest.requiredModel());
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
  record("100% is only reported when the pull actually finished",
    progress.filter((p) => p.percent === 100).length <= 1 &&
      (progress.at(-1)?.percent ?? 0) === 100);
  record("phases with no byte count report no percentage",
    first.events.some((e) => e.t === "progress" && e.id === "model" && e.percent === null));

  record("the model is verified, not just downloaded",
    first.events.some((e) => e.t === "progress" && /answers/i.test(e.detail ?? "")));
  record("setup finishes", find(first.events, "done")?.reason === "installed");
  record("the bootstrap process exits", first.code === 0, `exit ${first.code}`);

  const state = readMarker(dataDir);
  record("initialisation is recorded outside the browser, in the data directory",
    Boolean(state.completedAt));
  record("the record says completed", state.status === "completed", String(state.status));
  record("every component is accounted for",
    stateModule.COMPONENTS.every((id) => state.components?.[id]?.status === "completed"),
    stateModule.COMPONENTS.map((id) => `${id}:${state.components?.[id]?.status}`).join(" "));
  record("each component carries when it was last checked",
    stateModule.COMPONENTS.every((id) => (state.components[id].lastChecked ?? 0) > 0));
  record("the skills record distinguishes required, installed and verified",
    state.skills?.["ui-ux-pro-max"]?.required === requiredFiles.length &&
      state.skills["ui-ux-pro-max"].installed === requiredFiles.length &&
      state.skills["ui-ux-pro-max"].verified === true,
    JSON.stringify(state.skills?.["ui-ux-pro-max"] ?? {}));
  record("the recorded model is the one that was confirmed",
    state.model?.id === askedModel.recommended.id && state.model.pending === false);
  record("the setup state carries no secrets",
    !JSON.stringify(state).match(/api[_-]?key|secret|token|password/i));
  record("nothing credential-shaped was printed either",
    !/api[_-]?key|client_secret|password|bearer /i.test(first.stdout + first.stderr));

  /* ==================================================================
     Second launch
     ================================================================== */
  console.log("\n=== Second launch ===\n");

  const startedAt = Date.now();
  const second = await runSetup(dataDir, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });
  const elapsed = Date.now() - startedAt;

  record("setup does not run again",
    find(second.events, "done")?.reason === "already-initialised");
  record("no model is downloaded",
    !second.events.some((e) => e.t === "progress" && e.percent != null));
  record("no skill is downloaded",
    !second.events.some((e) => e.t === "step" && e.id === "skills"));
  record("Ollama is not reinstalled",
    !second.events.some((e) => e.t === "step" && e.id === "localai"));
  record("the user is asked nothing", !second.events.some((e) => e.t === "ask"));
  record("no hardware probing happens on the fast path",
    !second.events.some((e) => e.t === "step" && e.id === "hardware"));
  record("it decides quickly", elapsed < 4000, `${elapsed}ms`);

  /* ==================================================================
     Only what is missing
     ================================================================== */
  console.log("\n=== Only what is missing ===\n");

  const reRun = await runSetup(dataDir, {
    answer: useRecommended,
    extraArgs: ["--force"],
    env: { OLLAMA_HOST: main.host },
  });
  record("a forced re-run keeps the installed design skills",
    stepState(reRun.events, "skills") === "skipped");
  record("it keeps the model that is already downloaded",
    stepState(reRun.events, "model") === "skipped");
  record("...but proves it still answers rather than assuming",
    reRun.events.some((e) => e.t === "progress" && e.id === "model" && /answers/i.test(e.detail ?? "")));
  record("hardware is read from the record rather than probed again",
    readMarker(dataDir).hardware.inspectedAt === state.hardware.inspectedAt);

  /* ==================================================================
     The model was deleted afterwards
     ================================================================== */
  console.log("\n=== A model deleted after setup ===\n");

  await fetch(`${main.host}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: manifest.requiredModel() }),
  });
  record("the model is gone from Ollama",
    !(await (await fetch(`${main.host}/api/tags`)).json()).models.length);

  const afterDelete = await runSetup(dataDir, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });
  record("a launch notices, although the record says setup is complete",
    find(afterDelete.events, "begin")?.reason === "model-missing",
    find(afterDelete.events, "begin")?.reason ?? "did not re-run");
  record("the model is downloaded again",
    stepState(afterDelete.events, "model") === "done");
  record("the design skills are not reinstalled for it",
    stepState(afterDelete.events, "skills") === "skipped");
  record("setup is complete again", Boolean(readMarker(dataDir).completedAt));

  /* ==================================================================
     A damaged skill
     ================================================================== */
  console.log("\n=== A damaged design catalogue ===\n");

  const victim = path.join(skillDir, requiredFiles.at(-1));
  unlinkSync(victim);
  record("one required catalogue file is missing", !existsSync(victim));

  const afterDamage = await runSetup(dataDir, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });
  record("a launch notices the missing file",
    find(afterDamage.events, "begin")?.reason === "skills-missing",
    find(afterDamage.events, "begin")?.reason ?? "did not re-run");
  record("it says it is repairing rather than installing",
    afterDamage.events.some((e) => e.t === "progress" && /Repairing/i.test(e.detail ?? "")),
    afterDamage.events.filter((e) => e.t === "progress" && e.id === "skills").map((e) => e.detail)[0] ?? "");
  record("the file is restored", existsSync(victim));
  record("the skill is verified again after the repair",
    readMarker(dataDir).skills?.["ui-ux-pro-max"]?.verified === true);
  record("the model is not downloaded again for a catalogue repair",
    !afterDamage.events.some((e) => e.t === "progress" && e.id === "model" && e.percent != null));

  /* ==================================================================
     An installation from an older version
     ================================================================== */
  console.log("\n=== An installation set up by an older version ===\n");

  const legacy = path.join(root, "legacy");
  mkdirSync(legacy, { recursive: true });
  // Exactly what the previous release wrote: schema 1, no components, no
  // per-skill record.
  writeFileSync(
    path.join(legacy, "setup-state.json"),
    JSON.stringify({
      schema: 1,
      revision: 1,
      completedAt: Date.now() - 86_400_000,
      hardware: state.hardware,
      model: { id: manifest.requiredModel(), verifiedAt: Date.now() - 86_400_000, pending: false },
      uiux: { source: "cli", path: skillDir, version: "1.0.0" },
      localAi: null,
      steps: {},
    }),
  );
  const migrated = stateModule.readState(legacy);
  record("an old record is read rather than discarded",
    migrated.status === "completed" && migrated.components.model.status === "completed");
  record("it is marked as migrated rather than as freshly verified",
    migrated.components.model.migrated === true);
  record("the old skill location is carried across",
    migrated.skills?.["ui-ux-pro-max"]?.path === skillDir);

  const legacyLaunch = await runSetup(legacy, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });
  record("an existing installation is not made to reinstall everything",
    find(legacyLaunch.events, "done")?.reason === "already-initialised" ||
      find(legacyLaunch.events, "begin")?.reason === "update",
    find(legacyLaunch.events, "begin")?.reason ?? find(legacyLaunch.events, "done")?.reason);

  /* ==================================================================
     Interrupted download
     ================================================================== */
  console.log("\n=== Interrupted download ===\n");

  const fresh = await startOllama();
  const interrupted = path.join(root, "interrupted");
  const cut = await runSetup(interrupted, {
    env: { OLLAMA_HOST: fresh.host },
    answer: useRecommended,
    // Kill the process partway through the download, as a power cut would.
    killAt: (e) => e.t === "progress" && e.id === "model" && e.percent >= 20,
  });
  record("the download was interrupted partway", cut.killed);

  const cutState = readMarker(interrupted);
  record("the interrupted model is recorded as unfinished", cutState.model?.pending === true);
  record("setup is not marked complete", !cutState.completedAt);
  record("the model component says it was in progress",
    cutState.components?.model?.status === "in_progress",
    String(cutState.components?.model?.status));
  record("what was already installed is kept",
    Boolean(cutState.skills) && existsSync(path.join(interrupted, SKILL_REL, "scripts", "search.py")));

  const resumed = await runSetup(interrupted, { answer: useRecommended, env: { OLLAMA_HOST: fresh.host } });
  record("the next launch resumes rather than starting over",
    find(resumed.events, "begin")?.reason === "resume-download");
  record("it does not reinstall the design skills",
    stepState(resumed.events, "skills") === "skipped");
  record("the model download completes on the second attempt",
    stepState(resumed.events, "model") === "done");
  record("setup is complete afterwards", Boolean(readMarker(interrupted).completedAt));

  /* ==================================================================
     A pull that fails
     ================================================================== */
  console.log("\n=== A download that fails ===\n");

  const failing = await startOllama(["--pull-fails"]);
  const pullFailed = path.join(root, "pull-failed");
  let sawRetry = false;
  const failedRun = await runSetup(pullFailed, {
    env: { OLLAMA_HOST: failing.host },
    answer: (event) => {
      if (event.kind === "retry") {
        sawRetry = true;
        return { skip: true };
      }
      return useRecommended(event);
    },
  });
  record("a failed download is reported in plain language",
    failedRun.events.some((e) => e.t === "failed" && e.id === "model" && !/ at |node:internal/.test(e.message ?? "")),
    find(failedRun.events, "failed", "model")?.message ?? "no failure reported");
  record("the user is offered a retry", sawRetry);
  const failedState = readMarker(pullFailed);
  record("the partial download is not thrown away",
    failedState.model?.pending === true && failedState.model.id === manifest.requiredModel());
  record("no model is claimed as ready",
    failedState.components?.model?.status === "skipped" && !failedState.model.verifiedAt,
    String(failedState.components?.model?.status));
  record("the application is still usable, without local AI",
    find(failedRun.events, "done")?.reason === "installed" &&
      Array.isArray(failedState.degraded) && failedState.degraded.includes("model"),
    JSON.stringify(failedState.degraded ?? null));
  stop(failing.child);

  /* ==================================================================
     A model that is present but will not load
     ================================================================== */
  console.log("\n=== A model that is installed but does not answer ===\n");

  const mute = await startOllama(["--preinstalled", "--chat-fails"]);
  const muteDir = path.join(root, "mute");
  let muteRetries = 0;
  const muteRun = await runSetup(muteDir, {
    env: { OLLAMA_HOST: mute.host },
    answer: (event) => {
      if (event.kind === "retry") {
        muteRetries += 1;
        return { skip: true };
      }
      return useRecommended(event);
    },
  });
  record("a listed model that will not answer is not accepted",
    stepState(muteRun.events, "model") !== "skipped" ||
      readMarker(muteDir).components?.model?.status !== "completed");
  record("it is reinstalled rather than reported as working",
    muteRun.events.some((e) => e.t === "progress" && /did not answer/i.test(e.detail ?? "")),
    muteRun.events.filter((e) => e.t === "progress" && e.id === "model").map((e) => e.detail).find((d) => /answer/i.test(d ?? "")) ?? "");
  record("the failure was surfaced with a retry", muteRetries >= 1);
  record("setup never records it as verified",
    !readMarker(muteDir).model?.verifiedAt);
  stop(mute.child);

  /* ==================================================================
     Ollama missing entirely
     ================================================================== */
  console.log("\n=== Ollama missing ===\n");

  const noOllama = path.join(root, "no-ollama");
  let ollamaRetried = false;
  const withoutOllama = await runSetup(noOllama, {
    // A port nothing is listening on.
    env: { OLLAMA_HOST: "http://127.0.0.1:1" },
    answer: (event) => {
      if (event.kind === "retry") {
        ollamaRetried = true;
        return { skip: true };
      }
      return useRecommended(event);
    },
  });
  record("a missing local AI runtime is reported, not ignored",
    withoutOllama.events.some((e) => e.t === "failed" && e.id === "localai"),
    find(withoutOllama.events, "failed", "localai")?.message ?? "");
  record("the message is a sentence, not a stack trace",
    !/ at |node:internal|Error:/.test(find(withoutOllama.events, "failed", "localai")?.message ?? ""));
  record("the user is offered a retry", ollamaRetried);
  const noAiState = readMarker(noOllama);
  record("the design skills were still installed",
    noAiState.components?.skills?.status === "completed");
  record("no model is claimed",
    noAiState.components?.model?.status === "skipped" && !noAiState.model);
  record("setup completes, and records what was skipped",
    Boolean(noAiState.completedAt) && (noAiState.degraded ?? []).includes("ollama"),
    JSON.stringify(noAiState.degraded ?? null));

  /* ==================================================================
     Disk space
     ================================================================== */
  console.log("\n=== Disk space ===\n");

  const budget = manifest.diskBudgetGb({ model: models.SMALLEST });
  record("the budget covers Ollama, the model, the catalogue and working space",
    budget.parts.length >= 4 && budget.totalGb > models.SMALLEST.downloadGb + 2,
    `${budget.totalGb} GB: ${budget.parts.map(([l]) => l).join(", ")}`);
  record("an already-installed Ollama is not budgeted for again",
    manifest.diskBudgetGb({ model: models.SMALLEST, needsOllama: false }).totalGb < budget.totalGb);
  record("a disk that cannot be measured is 'unknown', not 'full'",
    models.diskCheck({ disk: { freeGb: null } }, { model: models.SMALLEST }).unknown === true);

  const cramped = path.join(root, "cramped");
  mkdirSync(cramped, { recursive: true });
  // A recorded machine with almost no free space: the setup reads its cached
  // hardware, so this is the real code path rather than a stubbed one.
  writeFileSync(
    path.join(cramped, "setup-state.json"),
    JSON.stringify({
      schema: manifest.SCHEMA,
      revision: manifest.BOOTSTRAP_REVISION,
      status: "not_started",
      completedAt: null,
      hardware: { ...state.hardware, disk: { ...state.hardware.disk, freeGb: 0.5 } },
    }),
  );
  let diskRetried = false;
  const tight = await runSetup(cramped, {
    env: { OLLAMA_HOST: main.host },
    answer: (event) => {
      if (event.step === "disk") {
        diskRetried = true;
        return { retry: true };
      }
      return useRecommended(event);
    },
  });
  const diskFailure = find(tight.events, "failed", "disk");
  record("a full disk stops the download before it starts", Boolean(diskFailure));
  record("it says how much is needed and how much is free",
    /about [\d.]+ GB is needed and [\d.]+ GB is free/i.test(diskFailure?.message ?? ""),
    diskFailure?.message ?? "");
  record("and what the space is for",
    Array.isArray(diskFailure?.detail) &&
      diskFailure.detail.length >= 3 &&
      diskFailure.detail.some(([label]) => /working space/i.test(label)),
    JSON.stringify(diskFailure?.detail ?? null));
  record("the user is offered a retry", diskRetried);
  record("no download was started while it was refused",
    !tight.events.some(
      (e) => e.t === "progress" && e.id === "model" && e.percent != null &&
        tight.events.indexOf(e) < tight.events.indexOf(diskFailure),
    ));

  const roomy = models.diskCheck({ disk: { freeGb: 500 } }, { model: models.SMALLEST });
  record("plenty of space passes", roomy.ok && !roomy.unknown, `${roomy.totalGb} GB needed`);

  /* ==================================================================
     Repair on request
     ================================================================== */
  console.log("\n=== Repair on request ===\n");

  stateModule.requestRepair(dataDir);
  record("a repair request is recorded", Boolean(readMarker(dataDir).repairRequested));
  const repairRun = await runSetup(dataDir, { answer: useRecommended, env: { OLLAMA_HOST: main.host } });
  record("the next launch repairs rather than opening",
    find(repairRun.events, "begin")?.reason === "repair");
  record("it installs nothing that is already there",
    stepState(repairRun.events, "skills") === "skipped" &&
      stepState(repairRun.events, "model") === "skipped");
  record("the request is cleared once honoured",
    !readMarker(dataDir).repairRequested);

  /* ==================================================================
     The completion rule
     ================================================================== */
  console.log("\n=== Nothing is complete until it verified ===\n");

  const done = (c) => ({ status: c });
  record("every mandatory component verified, optional ones skipped → complete",
    manifest.completionCheck({
      application: done("completed"), runtime: done("completed"), skills: done("completed"),
      ollama: done("skipped"), model: done("skipped"),
    }).complete);
  record("a failed mandatory component → not complete",
    manifest.completionCheck({
      application: done("completed"), runtime: done("completed"), skills: done("failed"),
      ollama: done("completed"), model: done("completed"),
    }).blocking.includes("skills"));
  record("an optional component still in progress → not complete",
    !manifest.completionCheck({
      application: done("completed"), runtime: done("completed"), skills: done("completed"),
      ollama: done("completed"), model: done("in_progress"),
    }).complete);
  record("a skipped optional component is recorded as degraded, not hidden",
    manifest.completionCheck({
      application: done("completed"), runtime: done("completed"), skills: done("completed"),
      ollama: done("completed"), model: done("skipped"),
    }).degraded);

  /* ==================================================================
     Damaged state file
     ================================================================== */
  console.log("\n=== Damaged state ===\n");

  writeFileSync(path.join(dataDir, "setup-state.json"), "{ this is not json");
  const afterCorruption = await runSetup(dataDir, {
    answer: () => ({ skip: true }),
    env: { OLLAMA_HOST: main.host },
  });
  record("a damaged record means 'set up again', never 'silently broken'",
    find(afterCorruption.events, "begin")?.reason === "first-launch");

  writeFileSync(
    path.join(dataDir, "setup-state.json"),
    JSON.stringify({ schema: 999, completedAt: Date.now() }),
  );
  record("a record from a newer version is not guessed at",
    stateModule.readState(dataDir).completedAt === null);

  /* ==================================================================
     The running application's own view, and Repair Installation
     ================================================================== */
  console.log("\n=== Readiness and repair, from inside the application ===\n");

  const APP_PORT = 3327;
  const APP = `http://127.0.0.1:${APP_PORT}`;
  const appData = path.join(root, "server-data");
  mkdirSync(appData, { recursive: true });
  // A record as a completed desktop installation would have it, so the
  // application reads the same file the bootstrap wrote.
  writeFileSync(
    path.join(appData, "setup-state.json"),
    JSON.stringify({
      schema: manifest.SCHEMA,
      revision: manifest.BOOTSTRAP_REVISION,
      status: "completed",
      completedAt: Date.now(),
      model: { id: manifest.requiredModel(), pending: false, verifiedAt: Date.now() },
      skills: { "ui-ux-pro-max": { path: skillDir, source: "installed", required: 12, installed: 12, verified: true } },
      components: Object.fromEntries(
        stateModule.COMPONENTS.map((id) => [id, { status: "completed", lastChecked: Date.now(), error: null }]),
      ),
    }),
  );

  const modelled = await startOllama(["--preinstalled"]);
  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: appData,
    WG_SECRET: "setup-qa-secret",
    WG_RUNTIME: "desktop",
    OLLAMA_HOST: modelled.host,
    WG_OLLAMA_AUTOPULL: "0",
    WG_GITHUB_TOKEN: "",
    GITHUB_TOKEN: "",
  });
  let appLog = "";
  app.stdout.on("data", (d) => (appLog += String(d)));
  app.stderr.on("data", (d) => (appLog += String(d)));

  let up = false;
  for (let i = 0; i < 240; i += 1) {
    try {
      if ((await fetch(`${APP}/login`, { signal: AbortSignal.timeout(1000) })).ok) {
        up = true;
        break;
      }
    } catch {
      /* still starting */
    }
    await sleep(500);
  }
  record("the application starts against the recorded installation", up);

  if (up) {
    let cookie = "";
    const api = async (pathname, init = {}) => {
      const res = await fetch(`${APP}${pathname}`, {
        ...init,
        redirect: "manual",
        headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        cookie = cookie ? `${cookie}; ${pair}` : pair;
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* html */
      }
      return { status: res.status, json, text };
    };

    const anonymous = await api("/api/setup?readiness=1");
    record("the readiness report needs a signed-in user", anonymous.status === 401);

    await api("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Setup QA",
        email: `setup+${Date.now()}@example.com`,
        password: "supersecret123",
      }),
    });

    const report = await api("/api/setup?readiness=1");
    const readiness = report.json?.readiness;
    record("every component is reported", 
      stateModule.COMPONENTS.every((id) => (readiness?.components ?? []).some((c) => c.id === id)),
      (readiness?.components ?? []).map((c) => `${c.id}:${c.status}`).join(" "));
    record("the required model named is the manifest's",
      readiness?.model?.required === manifest.requiredModel(),
      String(readiness?.model?.required));
    record("the design skills are counted file by file",
      readiness?.skills?.[0]?.installed === 12 && readiness.skills[0].required === 12,
      JSON.stringify(readiness?.skills?.[0] ?? null));
    record("the report exposes no filesystem paths",
      !/\/tmp|C:\\|\/home\//.test(JSON.stringify(readiness ?? {})));
    record("nor a stack trace",
      !/ at |node:internal/.test(JSON.stringify(readiness ?? {})));
    record("it says the installation is ready", readiness?.ready === true);

    const verified = await api("/api/setup?readiness=1&verify=1");
    record("verifying actually loads the model and asks it",
      verified.json?.readiness?.model?.verified === true,
      JSON.stringify(verified.json?.readiness?.model ?? null));

    const repaired = await api("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "repair" }),
    });
    record("repairing a complete installation downloads nothing",
      repaired.json?.ok === true &&
        (repaired.json?.actions ?? []).some((a) => /already installed/i.test(a)),
      JSON.stringify(repaired.json?.actions ?? null));
    record("...and says the catalogue is complete rather than reinstalling it",
      (repaired.json?.actions ?? []).some((a) => /catalogue is complete/i.test(a)));
    record("the repair response carries no credential",
      !/api[_-]?key|secret|token|password/i.test(JSON.stringify(repaired.json ?? {})));

    // The model removed underneath a running application: the repair is the
    // thing that puts it back, and it must say so rather than claim success.
    await fetch(`${modelled.host}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: manifest.requiredModel() }),
    });
    const afterLoss = await api("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "repair" }),
    });
    record("a missing model is downloaded by the repair",
      (afterLoss.json?.actions ?? []).some((a) => /Started downloading/i.test(a)),
      JSON.stringify(afterLoss.json?.actions ?? null));

    record("the application's log never printed a credential",
      !/api[_-]?key=|client_secret|password=|bearer /i.test(appLog));
  }
  stop(app);
  stop(modelled.child);

  stop(main.child);
  stop(fresh.child);
} catch (err) {
  record("the suite ran to completion", false, err instanceof Error ? err.stack : String(err));
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
