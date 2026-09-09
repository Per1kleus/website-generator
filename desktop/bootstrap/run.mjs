#!/usr/bin/env node
/**
 * First-launch setup.
 *
 * The desktop application promises: install, open, use. Everything that would
 * otherwise be a README — a runtime, a design system, a local model — happens
 * here, once, behind a native screen rather than a terminal.
 *
 * This process is deliberately headless. It reports what it is doing as
 * newline-delimited JSON on stdout and takes answers on stdin; the Tauri shell
 * renders that as the setup screen. Keeping the logic in Node rather than in
 * the shell means it can be tested directly, which is why every step here has
 * a test that does not involve a window.
 *
 *   → {"t":"step","id":"uiux","state":"running","title":"…"}
 *   → {"t":"progress","id":"model","percent":42,"detail":"420 MB of 1.0 GB"}
 *   → {"t":"ask","id":"model","choice":{…}}      waits for an answer
 *   → {"t":"failed","id":"ollama","message":"…","retryable":true}
 *   → {"t":"done","state":{…}}
 *   ← {"answer":{"model":"qwen2.5:1.5b"}} | {"retry":true} | {"skip":true}
 *
 * Rules taken from the requirements and enforced below: only install what is
 * missing; never report progress that is not real; never mark setup complete
 * before the component verified; never delete a partial download.
 */
import path from "node:path";
import process from "node:process";
import { inspect, describe } from "./hardware.mjs";
import { recommend, options, findModel } from "./models.mjs";
import * as ai from "./localai.mjs";
import * as uiux from "./uiux.mjs";
import { BOOTSTRAP_REVISION, needsSetup, readState, recordStep, writeState } from "./state.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const dataDir = flag("data-dir", path.join(process.cwd(), "data"));
const resources = flag("resources", null);

function say(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

/* ---------------------------------------------------------------- questions */

const pending = new Map();
let nextId = 1;

/**
 * Ask the setup screen a question and wait for the answer.
 *
 * The user confirming their model before a gigabyte is downloaded is a
 * requirement, not a nicety, so this genuinely blocks.
 */
function ask(payload) {
  const id = `q${nextId++}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // The correlation id is written last on purpose: a payload carrying its
    // own step id must not silently replace the id the answer is matched on.
    say({ t: "ask", ...payload, id });
  });
}

let stdinBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split("\n");
  stdinBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});
// The shell closing stdin means the window is gone; there is nobody to set up
// for any more.
process.stdin.on("end", () => process.exit(0));

/* -------------------------------------------------------------------- steps */

const step = (id, title) => {
  say({ t: "step", id, state: "running", title });
  return {
    done: (detail = null) => say({ t: "step", id, state: "done", detail }),
    skipped: (detail = null) => say({ t: "step", id, state: "skipped", detail }),
    note: (detail) => say({ t: "progress", id, percent: null, detail }),
    progress: (percent, detail) => say({ t: "progress", id, percent, detail }),
    failed: (message, retryable = true) =>
      say({ t: "failed", id, message, retryable }),
  };
};

/**
 * Run one fallible step, letting the user retry it from the setup screen.
 *
 * `optional` steps offer "continue without it" as well, because the
 * application genuinely works without a local model or a design catalogue and
 * trapping someone in a setup screen over an optional component would be worse
 * than starting without it.
 */
async function attempt(id, title, work, { optional = false } = {}) {
  for (;;) {
    const s = step(id, title);
    try {
      return { ok: true, value: await work(s) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      s.failed(message, true);
      const answer = await ask({
        step: id,
        kind: "retry",
        message,
        canSkip: optional,
      });
      if (answer.skip || answer.answer === "skip") return { ok: false, skipped: true, message };
      if (answer.cancel) process.exit(1);
    }
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  const state = readState(dataDir);
  const status = needsSetup(dataDir, state);

  if (!status.needed && !has("force")) {
    // Nothing to do: this is the fast path every launch after the first.
    say({ t: "done", reason: "already-initialised", state: publicState(state) });
    return;
  }
  say({ t: "begin", reason: status.reason, revision: BOOTSTRAP_REVISION });

  /* 1. What is this computer? ------------------------------------------- */
  // Cached deliberately: re-probing GPUs on every launch is exactly the kind
  // of slow start the requirements rule out.
  let hardware = state.hardware;
  if (!hardware || has("reconfigure")) {
    const s = step("hardware", "Checking your computer");
    hardware = await inspect(dataDir);
    s.done(describe(hardware));
    state.hardware = hardware;
    writeState(dataDir, state);
  } else {
    const s = step("hardware", "Checking your computer");
    s.done(describe(hardware));
  }

  if (hardware.os.platform === "win32" && !hardware.os.supported) {
    say({
      t: "failed",
      id: "hardware",
      message: `${hardware.os.name} is older than this application supports. Windows 10 or later is required.`,
      retryable: false,
    });
    process.exit(1);
  }

  /* 2. Runtimes ---------------------------------------------------------- */
  {
    const s = step("runtime", "Checking installed components");
    const python = await pythonReady();
    const detail = [
      ["Application runtime", `Node ${process.version} (included)`],
      ["Design search", python ? `Python found (${python})` : "Python not found — the catalogue will use built-in rules"],
    ];
    state.runtime = { node: process.version, python };
    s.done(detail);
  }

  /* 3. The design system ------------------------------------------------- */
  const already = uiux.existing(dataDir);
  if (already && state.uiux && !has("reconfigure")) {
    const s = step("uiux", "Checking UI/UX Pro Max");
    s.skipped([["Already installed", already.version ? `version ${already.version}` : "present"]]);
  } else {
    const result = await attempt(
      "uiux",
      "Installing UI/UX Pro Max",
      async (s) => {
        const installed = already ?? (await uiux.install(dataDir, { resources, report: (m) => s.note(m.detail) }));
        s.note("Checking it answers…");
        const check = await uiux.verify(dataDir, state.runtime?.python || "python3");
        // Python missing is not an installation failure: the application falls
        // back to its own rules, exactly as on a server without Python.
        if (!check.ok && check.reason !== "search-failed: python3 ENOENT") {
          if (check.reason === "not-installed") throw new Error("The design system did not install correctly.");
        }
        s.done([["UI/UX Pro Max", installed.version ? `version ${installed.version}` : "installed"]]);
        return { ...installed, verified: check.ok };
      },
      { optional: true },
    );
    if (result.ok) {
      state.uiux = result.value;
    } else {
      // The vendored copy shipped inside the application still works.
      state.uiux = { source: "vendored", path: null, note: result.message ?? null };
    }
    recordStep(state, "uiux", result.ok ? "done" : "fallback");
    writeState(dataDir, state);
  }

  /* 4. The local AI runtime ---------------------------------------------- */
  let aiReady = await ai.daemonUp();
  if (!aiReady) {
    const result = await attempt(
      "localai",
      "Preparing local AI",
      async (s) => {
        if (await ai.binaryPresent()) {
          s.note("Starting Ollama…");
          if (await ai.startDaemon()) return true;
          throw new Error("Ollama is installed but did not start.");
        }
        if (process.platform !== "win32" || has("no-install")) {
          throw new Error("Ollama is not installed on this computer.");
        }
        s.note("Ollama is not installed yet. This download is about 700 MB.");
        const install = await ai.installRuntime((m) => s.note(m.detail));
        if (!install.ok) throw new Error(`Ollama could not be installed (${install.reason}).`);
        if (!(await ai.startDaemon())) throw new Error("Ollama installed but did not start.");
        state.localAi = { installedBy: install.via, at: Date.now() };
        return true;
      },
      { optional: true },
    );
    aiReady = result.ok;
    recordStep(state, "localai", result.ok ? "done" : "skipped");
    writeState(dataDir, state);
  }

  /* 5. The model --------------------------------------------------------- */
  if (aiReady) {
    const installed = await ai.installedModels();
    const configured = state.model?.id ?? process.env.WG_OLLAMA_MODEL ?? null;
    const suggestion = recommend(hardware, { configured });

    let chosen = suggestion.model;
    if (suggestion.blocked) {
      say({ t: "failed", id: "model", message: suggestion.blocked, retryable: true });
      const answer = await ask({ step: "model", kind: "retry", message: suggestion.blocked, canSkip: true });
      if (answer.skip) chosen = null;
    }

    // Already downloaded and verified: say so and move on rather than asking
    // the user to confirm something that is finished.
    if (chosen && ai.hasModel(installed, chosen.id) && !state.model?.pending) {
      const s = step("model", "Checking the local AI model");
      s.skipped([["Model", `${chosen.label} is already installed`]]);
      state.model = { id: chosen.id, verifiedAt: Date.now(), pending: false };
      writeState(dataDir, state);
    } else if (chosen) {
      const answer = await ask({
        step: "model",
        kind: "model",
        recommended: chosen,
        why: suggestion.why,
        kept: Boolean(suggestion.kept),
        changed: Boolean(suggestion.changed),
        previous: suggestion.previous ?? null,
        hardware: describe(hardware),
        resuming: Boolean(state.model?.pending && state.model.id === chosen.id),
        options: options(hardware),
      });
      const picked = findModel(answer.answer?.model) ?? chosen;

      if (answer.skip) {
        const s = step("model", "Local AI model");
        s.skipped([["Skipped", "You can install it later from the Profile screen."]]);
        recordStep(state, "model", "skipped");
      } else {
        // Marked pending *before* the download starts: if the machine is
        // switched off mid-download, the next launch knows to resume.
        state.model = { id: picked.id, pending: true, startedAt: Date.now() };
        writeState(dataDir, state);

        const result = await attempt(
          "model",
          `Downloading ${picked.label}`,
          async (s) => {
            await ai.pullModel(picked.id, (m) => {
              if (m.percent == null) s.note(m.detail);
              else s.progress(m.percent, m.detail);
            });
            s.note("Checking the model answers…");
            if (!(await ai.verifyModel(picked.id))) {
              throw new Error("The model downloaded but did not answer correctly.");
            }
            s.done([["Model", `${picked.label} ready`]]);
            return picked;
          },
          { optional: true },
        );

        state.model = result.ok
          ? { id: picked.id, pending: false, verifiedAt: Date.now() }
          : { id: picked.id, pending: true, error: result.message ?? null };
        recordStep(state, "model", result.ok ? "done" : "incomplete");
        writeState(dataDir, state);
      }
    }
  } else {
    const s = step("model", "Local AI model");
    s.skipped([
      ["Not configured", "The application generates websites without it, and can set it up later."],
    ]);
  }

  /* 6. Finish ------------------------------------------------------------ */
  {
    const s = step("finish", "Finishing setup");
    // Only now: every step either verified or was consciously skipped, and a
    // model still downloading keeps the marker open so the next launch resumes.
    state.revision = BOOTSTRAP_REVISION;
    state.completedAt = Date.now();
    writeState(dataDir, state);
    s.done();
  }

  say({ t: "done", reason: "installed", state: publicState(state) });
}

/**
 * What the shell is allowed to see. The setup writes no secrets, and this
 * keeps it that way by construction.
 */
function publicState(state) {
  return {
    completedAt: state.completedAt,
    revision: state.revision,
    model: state.model ?? null,
    uiux: state.uiux ? { source: state.uiux.source, version: state.uiux.version ?? null, path: state.uiux.path ?? null } : null,
    localAi: state.localAi ?? null,
  };
}

async function pythonReady() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  for (const candidate of [process.env.WG_PYTHON, "python3", "python"].filter(Boolean)) {
    try {
      await run(candidate, ["--version"], { timeout: 5000, windowsHide: true });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    say({
      t: "failed",
      id: "setup",
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
    });
    process.exit(1);
  });
