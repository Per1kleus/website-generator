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
 *   → {"t":"step","id":"skills","state":"running","title":"…"}
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
import { mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { inspect, describe } from "./hardware.mjs";
import { completionCheck, MANIFEST, requiredModel } from "./manifest.mjs";
import { recommend, options, findModel, diskCheck } from "./models.mjs";
import * as ai from "./localai.mjs";
import * as uiux from "./uiux.mjs";
import {
  BOOTSTRAP_REVISION, clearRepairRequest, inspectSkills, needsSetup, readState, recordStep,
  setComponent, writeState,
} from "./state.mjs";

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
  /* The launch decision.
     ------------------------------------------------------------------
     Cheap on purpose — a few file checks and, when a model is recorded as
     installed, one request to a daemon on this machine. That last part is what
     makes "completed" a claim about the computer rather than about a file: a
     model somebody deleted reopens setup instead of failing later, quietly, in
     the middle of generating a website. */
  const status = await needsSetup(dataDir, state, {
    probeModel: (id) => ai.modelPresent(id),
    resources,
  });

  if (!status.needed && !has("force")) {
    // Nothing to do: the fast path, every launch after the first.
    say({ t: "done", reason: "already-initialised", state: publicState(state) });
    return;
  }

  clearRepairRequest(state);
  state.status = "in_progress";
  writeState(dataDir, state);
  say({
    t: "begin",
    reason: status.reason,
    detail: status.detail ?? null,
    revision: BOOTSTRAP_REVISION,
  });

  /* 1. The application's own directories ---------------------------------- */
  {
    const s = step("application", "Preparing the application");
    for (const name of MANIFEST.application.directories) {
      mkdirSync(path.join(dataDir, name), { recursive: true });
    }
    setComponent(state, "application", "completed");
    writeState(dataDir, state);
    s.done([["Folders and settings", "Ready"]]);
  }

  /* 2. What is this computer? --------------------------------------------- */
  // Cached deliberately: re-probing GPUs on every launch is exactly the kind
  // of slow start the requirements rule out.
  let hardware = state.hardware;
  {
    const s = step("hardware", "Checking your computer");
    if (!hardware || has("reconfigure")) {
      hardware = await inspect(dataDir);
      state.hardware = hardware;
      writeState(dataDir, state);
    }
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

  /* 3. Runtimes ----------------------------------------------------------- */
  {
    const s = step("runtime", "Checking installed components");
    const python = await pythonReady();
    const detail = [
      ["Application runtime", `Node ${process.version} (included)`],
      [
        "Design search",
        python ? "Python found" : "Python not found — the catalogue will use built-in rules",
      ],
    ];
    state.runtime = { node: process.version, python };
    // Node ships with the application, so this cannot be missing; Python is
    // declared optional by the manifest and its absence is a note, not a fault.
    setComponent(state, "runtime", "completed", { version: process.version });
    writeState(dataDir, state);
    s.done(detail);
  }
  const python = state.runtime?.python || "python3";

  /* 4. The design skills -------------------------------------------------- */
  //
  // Every skill the manifest requires, and every file each one needs. A
  // directory existing proves nothing: an npm install killed halfway leaves one
  // behind with half its catalogue, which then fails at generation time.
  {
    let report = await uiux.verifyAll(dataDir, python, { resources, state });
    // "Good" means the copy this installation recorded is whole. A complete
    // bundled copy is a valid fallback, but it is not a reason to leave an
    // installed copy that has lost files unrepaired.
    const installedAndGood = Object.values(report).every(
      (r) => r.source === "installed" && r.complete && r.installedMissing.length === 0,
    );

    if (installedAndGood && !has("reconfigure")) {
      const s = step("skills", "Checking design skills");
      s.skipped(skillDetail(report));
    } else {
      const result = await attempt(
        "skills",
        "Installing design skills",
        async (s) => {
          for (const skill of uiux.REQUIRED) {
            const current = report[skill.id];
            if (current?.source === "installed" && current.complete && !current.installedMissing.length) {
              continue;
            }
            const lost = current?.installedMissing?.length ?? 0;
            s.note(
              lost
                ? `Repairing ${skill.label} — ${lost} of ${current.required} files are missing…`
                : `Installing ${skill.label}…`,
            );
            await uiux.install(dataDir, { resources, report: (m) => s.note(m.detail) });
          }
          s.note("Checking the catalogue answers…");
          report = await uiux.verifyAll(dataDir, python, { resources, state });
          const broken = Object.values(report).find((r) => !r.complete);
          if (broken) {
            throw new Error(`${broken.label} is missing part of its catalogue.`);
          }
          s.done(skillDetail(report));
          return report;
        },
        // The copy that ships inside the application is a complete catalogue in
        // its own right, so a failed download is recoverable rather than fatal.
        { optional: true },
      );
      if (!result.ok) {
        report = await uiux.verifyAll(dataDir, python, { resources, state });
      }
    }

    state.skills = Object.fromEntries(
      Object.entries(report).map(([id, r]) => [
        id,
        { path: r.path, source: r.source, required: r.required, installed: r.installed, verified: r.verified },
      ]),
    );
    state.uiux = firstSkillRecord(report);

    /* Files complete is the bar for this component, and verification is
       recorded beside it. Python is optional by manifest, so a catalogue that
       is entirely present on a machine with no interpreter is a complete
       installation using built-in rules — not a failed one. A catalogue that
       is present and refuses to answer *with* an interpreter is a real fault. */
    const complete = Object.values(report).every((r) => r.complete);
    const answered = Object.values(report).every((r) => r.verified);
    const brokenWithPython = Object.values(report).some(
      (r) => r.complete && !r.verified && !looksLikeMissingPython(r.reason),
    );
    setComponent(state, "skills", complete && !brokenWithPython ? "completed" : "failed", {
      error: complete
        ? brokenWithPython
          ? "The design catalogue did not answer."
          : null
        : "Part of the design catalogue is missing.",
      identifier: answered ? "verified" : complete ? "installed" : "incomplete",
    });
    recordStep(state, "skills", complete ? "done" : "failed");
    writeState(dataDir, state);
  }

  /* 5. Room on the disk, before anything large is fetched ----------------- */
  //
  // The whole job, not just the model: a check that passes on 400 MB and then
  // fails when Ollama unpacks 4.5 GB of CUDA libraries has wasted the user's
  // time rather than saved it.
  const ollamaAlready = (await ai.daemonUp()) || (await ai.binaryPresent());
  const skillsInstalled = Object.values(inspectSkills(dataDir, state, { resources })).every(
    (r) => r.complete,
  );
  const plannedModel = findModel(state.model?.id ?? requiredModel()) ?? null;
  {
    const s = step("disk", "Checking free space");
    const check = diskCheck(hardware, {
      model: plannedModel,
      needsOllama: !ollamaAlready,
      needsSkills: !skillsInstalled,
    });
    if (check.unknown) {
      s.done([["Free space", "Could not be measured — continuing"]]);
    } else if (check.ok) {
      s.done([
        ["Free space", `${check.freeGb} GB`],
        ["Setup needs", `about ${check.totalGb} GB`],
      ]);
    } else {
      // Refused rather than started: a download that cannot finish is worse
      // than one that never began, because the user waits for it first.
      say({
        t: "failed",
        id: "disk",
        message:
          `There is not enough free space to finish setting up. ` +
          `About ${check.totalGb} GB is needed and ${check.freeGb} GB is free. ` +
          `Free some space and try again.`,
        retryable: true,
        detail: check.parts.map(([label, gb]) => [label, `${gb} GB`]),
      });
      const answer = await ask({ step: "disk", kind: "retry", message: "Not enough free space.", canSkip: false });
      if (answer.cancel) process.exit(1);
      // A retry re-inspects the machine: the user has just been told to free
      // space, so reading the cached figure would be pointless.
      hardware = await inspect(dataDir);
      state.hardware = hardware;
      writeState(dataDir, state);
      const again = diskCheck(hardware, {
        model: plannedModel,
        needsOllama: !ollamaAlready,
        needsSkills: !skillsInstalled,
      });
      if (!again.ok && !again.unknown) {
        setComponent(state, "ollama", "failed", { error: "Not enough free disk space." });
        setComponent(state, "model", "failed", { error: "Not enough free disk space." });
        writeState(dataDir, state);
      } else {
        s.done([["Free space", `${again.freeGb} GB`]]);
      }
    }
  }

  const spaceBlocked = state.components?.model?.error === "Not enough free disk space.";

  /* 6. The local AI runtime ---------------------------------------------- */
  let aiReady = spaceBlocked ? false : await ai.daemonUp();
  if (!aiReady && !spaceBlocked) {
    const result = await attempt(
      "localai",
      "Preparing local AI",
      async (s) => {
        if (await ai.binaryPresent()) {
          s.note("Starting Ollama…");
          if (await ai.startDaemon({ onWait: () => s.note("Waiting for Ollama to answer…") })) {
            return true;
          }
          throw new Error(
            "Ollama is installed but did not start. It may still be starting up — try again.",
          );
        }
        if (process.platform !== "win32" || has("no-install")) {
          throw new Error("Ollama is not installed on this computer.");
        }
        // Nothing large is downloaded without a working connection: "no
        // internet" is a sentence a person can act on, and a failure twenty
        // seconds into a download is not.
        if (!(await ai.internetReachable())) {
          throw new Error(
            "An internet connection is needed to finish setting up. Connect and try again.",
          );
        }
        s.note("Ollama is not installed yet. This download is about 700 MB.");
        const install = await ai.installRuntime((m) => s.note(m.detail));
        if (!install.ok) throw new Error(installerMessage(install.reason));
        if (!(await ai.startDaemon({ onWait: () => s.note("Waiting for Ollama to answer…") }))) {
          throw new Error("Ollama installed but did not start. Try again.");
        }
        state.localAi = { installedBy: install.via, at: Date.now() };
        return true;
      },
      { optional: true },
    );
    aiReady = result.ok;
    setComponent(state, "ollama", result.ok ? "completed" : "skipped", {
      error: result.ok ? null : result.message ?? null,
    });
    recordStep(state, "localai", result.ok ? "done" : "skipped");
    writeState(dataDir, state);
  } else if (aiReady) {
    setComponent(state, "ollama", "completed");
    writeState(dataDir, state);
  }

  /* 7. The model --------------------------------------------------------- */
  if (aiReady) {
    const installed = await ai.installedModels();
    const configured = state.model?.id ?? requiredModel();
    const suggestion = recommend(hardware, {
      configured,
      needsOllama: false,
      needsSkills: !skillsInstalled,
    });

    let chosen = suggestion.model;
    if (suggestion.blocked) {
      say({ t: "failed", id: "model", message: suggestion.blocked, retryable: true });
      const answer = await ask({ step: "model", kind: "retry", message: suggestion.blocked, canSkip: true });
      if (answer.skip) chosen = null;
    }

    if (!chosen) {
      const s = step("model", "Local AI model");
      s.skipped([["Skipped", "You can install it later from the Profile screen."]]);
      setComponent(state, "model", "skipped", { error: suggestion.blocked ?? null });
      writeState(dataDir, state);
    }

    /* Already downloaded — but that is not the same as usable, so it is still
       asked to answer. A pull can finish against a corrupted blob, and a
       machine can be short of the memory needed to load the model at all.
       A model that is present and silent falls through to the download path
       below, which re-fetches and re-verifies it: that is the repair, and
       reporting "installed" would be the one thing worth not doing. */
    let alreadyUsable = false;
    if (chosen && ai.hasModel(installed, chosen.id) && !state.model?.pending) {
      const s = step("model", "Checking the local AI model");
      s.note("Checking the model answers…");
      alreadyUsable = await ai.verifyModel(chosen.id);
      if (alreadyUsable) {
        s.skipped([["Model", `${chosen.label} is already installed and answering`]]);
        state.model = { id: chosen.id, verifiedAt: Date.now(), pending: false };
        setComponent(state, "model", "completed", { identifier: chosen.id });
        writeState(dataDir, state);
      } else {
        s.note(`${chosen.label} is installed but did not answer — installing it again.`);
      }
    }

    if (!chosen || alreadyUsable) {
      // Handled above.
    } else {
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
        options: options(hardware, { needsOllama: false, needsSkills: !skillsInstalled }),
      });
      const picked = findModel(answer.answer?.model) ?? chosen;

      if (answer.skip) {
        const s = step("model", "Local AI model");
        s.skipped([["Skipped", "You can install it later from the Profile screen."]]);
        setComponent(state, "model", "skipped");
        recordStep(state, "model", "skipped");
        writeState(dataDir, state);
      } else {
        // Marked pending *before* the download starts: if the machine is
        // switched off mid-download, the next launch knows to resume.
        state.model = { id: picked.id, pending: true, startedAt: Date.now() };
        setComponent(state, "model", "in_progress", { identifier: picked.id });
        writeState(dataDir, state);

        const result = await attempt(
          "model",
          `Downloading ${picked.label}`,
          async (s) => {
            if (!(await ai.daemonUp())) {
              throw new Error("Ollama stopped responding. Make sure it is running and try again.");
            }
            await ai.pullModel(picked.id, (m) => {
              if (m.percent == null) s.note(m.detail);
              else s.progress(m.percent, m.detail);
            });
            // Present is not the same as usable, and only the second one is
            // worth reporting as a finished setup.
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
        setComponent(state, "model", result.ok ? "completed" : "skipped", {
          identifier: picked.id,
          error: result.ok ? null : result.message ?? null,
        });
        recordStep(state, "model", result.ok ? "done" : "incomplete");
        writeState(dataDir, state);
      }
    }
  } else {
    const s = step("model", "Local AI model");
    s.skipped([
      ["Not configured", "The application generates websites without it, and can set it up later."],
    ]);
    setComponent(state, "model", "skipped");
    writeState(dataDir, state);
  }

  /* 8. Finish ------------------------------------------------------------ */
  {
    const s = step("finish", "Finishing setup");
    /* The completion rule, and the only place it is decided.
       Every mandatory component must have verified; every optional one must
       have verified or have been declined by the user after they saw why. A
       model still downloading keeps the record open, so the next launch
       resumes rather than opening an application that is not ready. */
    const verdict = completionCheck(state.components);
    state.revision = BOOTSTRAP_REVISION;

    if (!verdict.complete) {
      state.status = "failed";
      state.completedAt = null;
      writeState(dataDir, state);
      s.failed("Setup did not finish.");
      say({
        t: "failed",
        id: "finish",
        message:
          "Setup could not finish. Nothing has been lost — reopening the application will carry on from here.",
        retryable: true,
      });
      say({ t: "done", reason: "incomplete", blocking: verdict.blocking, state: publicState(state) });
      process.exitCode = 1;
      return;
    }

    state.status = "completed";
    state.completedAt = Date.now();
    if (verdict.degraded) state.degraded = verdict.skipped;
    else delete state.degraded;
    writeState(dataDir, state);
    s.done(
      verdict.degraded
        ? [["Ready", "Set up, without the local AI you skipped"]]
        : [["Ready", "Everything checked and working"]],
    );
  }

  say({ t: "done", reason: "installed", state: publicState(state) });
}

/** "3 of 3 files · answering" per skill, rather than one hidden boolean. */
function skillDetail(report) {
  return Object.values(report).map((r) => [
    r.label,
    `${r.installed} of ${r.required} files${
      r.verified ? " · answering" : looksLikeMissingPython(r.reason) ? " · built-in rules (no Python)" : ""
    }`,
  ]);
}

function firstSkillRecord(report) {
  const first = Object.values(report)[0];
  if (!first) return null;
  return { source: first.source, path: first.path, verified: first.verified };
}

/** A missing interpreter is not a broken catalogue; the manifest allows it. */
function looksLikeMissingPython(reason) {
  return typeof reason === "string" && /ENOENT|not found|No such file/i.test(reason);
}

/** The installer's own reasons, in words a person can act on. */
function installerMessage(reason) {
  const text = String(reason ?? "");
  if (text.includes("incomplete")) {
    return "The Ollama download did not finish. Check your connection and try again.";
  }
  if (text.includes("checksum") || text.includes("not a Windows installer") || text.includes("expected size")) {
    return "The Ollama download could not be verified, so it was not run. Try again.";
  }
  if (text === "installer-not-finished") {
    return "The Ollama installer did not finish. Complete its prompts, then try again.";
  }
  if (text === "unsupported-platform") {
    return "Ollama can only be installed automatically on Windows.";
  }
  return `Ollama could not be installed (${text}).`;
}

/**
 * What the shell is allowed to see. The setup writes no secrets, and this
 * keeps it that way by construction.
 */
function publicState(state) {
  return {
    status: state.status ?? (state.completedAt ? "completed" : "not_started"),
    completedAt: state.completedAt,
    revision: state.revision,
    model: state.model ?? null,
    uiux: state.uiux ? { source: state.uiux.source, version: state.uiux.version ?? null, path: state.uiux.path ?? null } : null,
    localAi: state.localAi ?? null,
    /* Per-component, so the shell and the tests can see which part is which
       without reading the record from disk. No path, no credential — there are
       none in the record to begin with. */
    components: Object.fromEntries(
      Object.entries(state.components ?? {}).map(([id, c]) => [
        id,
        { status: c.status, lastChecked: c.lastChecked ?? 0, error: c.error ?? null, ...(c.identifier ? { identifier: c.identifier } : {}) },
      ]),
    ),
    skills: Object.fromEntries(
      Object.entries(state.skills ?? {}).map(([id, r]) => [
        id,
        { source: r.source, required: r.required, installed: r.installed, verified: Boolean(r.verified) },
      ]),
    ),
    ...(state.degraded ? { degraded: state.degraded } : {}),
  };
}

async function pythonReady() {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // The candidates the manifest names, after whatever the launcher was given.
  const candidates = [process.env.WG_PYTHON, ...MANIFEST.runtime.python.candidates].filter(Boolean);
  for (const candidate of candidates) {
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
