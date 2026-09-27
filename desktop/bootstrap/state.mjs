/**
 * The initialisation record.
 *
 * Setup runs once. What makes that safe is that "once" is recorded properly:
 * a versioned JSON document in the Windows application-data directory,
 * alongside the database — not a temporary file, and not something a browser
 * cache clear can lose. One file, `setup-state.json`, named by the manifest.
 *
 * Three rules, all from the requirements, are enforced here.
 *
 *   1. Nothing is marked complete until the component it describes verified.
 *      A half-finished setup leaves the record incomplete, so the next launch
 *      resumes rather than trusting a lie.
 *   2. "Complete" is a claim about the machine, not about this file. A record
 *      saying the model is installed, on a machine where somebody deleted it,
 *      is wrong — so a later launch checks cheaply and repairs what is missing.
 *   3. An application update must not redo work that is still good. The record
 *      carries a schema and a revision; provisioning re-runs only when the
 *      revision genuinely changes what has to be installed, and even then only
 *      the steps that changed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BOOTSTRAP_REVISION, MANIFEST, SCHEMA, skills } from "./manifest.mjs";

export { BOOTSTRAP_REVISION };

/** The components a complete installation consists of. */
export const COMPONENTS = ["runtime", "skills", "ollama", "model", "application"];

export function statePath(dataDir) {
  return path.join(dataDir, MANIFEST.application.stateFile);
}

/** One component's record. `status` is the only field always present. */
function emptyComponent() {
  return { status: "not_started", lastChecked: 0, error: null };
}

export function emptyState() {
  return {
    schema: SCHEMA,
    revision: BOOTSTRAP_REVISION,
    /** not_started | in_progress | completed | failed */
    status: "not_started",
    completedAt: null,
    hardware: null,
    /** { id, verifiedAt, pending } — pending survives an interrupted download. */
    model: null,
    localAi: null,
    uiux: null,
    /** Per-skill: required, installed, verified. */
    skills: {},
    components: Object.fromEntries(COMPONENTS.map((id) => [id, emptyComponent()])),
    steps: {},
  };
}

/**
 * Bring an older record forward.
 *
 * An installation from before per-component tracking existed carries a
 * `completedAt` and nothing else, and forcing it to reinstall everything would
 * be exactly the wrong answer: its model and its design catalogue are on disk
 * and working. So the old fields are read for what they prove, the new ones are
 * derived from them, and the readiness check below decides the rest by looking
 * at the machine rather than at the file.
 */
function migrate(parsed) {
  const state = { ...emptyState(), ...parsed };
  state.schema = SCHEMA;
  state.components = { ...emptyState().components, ...(parsed.components ?? {}) };
  state.skills = parsed.skills ?? {};

  if (!parsed.components) {
    const at = parsed.completedAt ?? 0;
    const mark = (id, ok) => {
      state.components[id] = {
        status: ok ? "completed" : "not_started",
        lastChecked: ok ? at : 0,
        error: null,
        migrated: true,
      };
    };
    mark("application", Boolean(parsed.completedAt));
    mark("runtime", Boolean(parsed.runtime));
    mark("skills", Boolean(parsed.uiux));
    mark("ollama", Boolean(parsed.localAi) || Boolean(parsed.model?.verifiedAt));
    mark("model", Boolean(parsed.model?.verifiedAt) && parsed.model?.pending === false);
  }

  // An older record kept the skill's location under `uiux`. Carry it across so
  // a non-default install location is still honoured after the upgrade.
  if (!parsed.skills && parsed.uiux?.path) {
    const [first] = skills();
    if (first) {
      state.skills = {
        [first.id]: { path: parsed.uiux.path, verified: Boolean(parsed.uiux.verified) },
      };
    }
  }

  if (!parsed.status) {
    state.status = parsed.completedAt ? "completed" : "not_started";
  }
  return state;
}

export function readState(dataDir) {
  const file = statePath(dataDir);
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return emptyState();
    // A record from a newer schema is not something this build can interpret.
    if (typeof parsed.schema === "number" && parsed.schema > SCHEMA) return emptyState();
    return migrate(parsed);
  } catch {
    // A corrupt record means "not set up", which is recoverable. Treating it
    // as set up would leave the application permanently broken.
    return emptyState();
  }
}

/**
 * Write atomically. A power cut during setup should leave either the old
 * record or the new one, never half a JSON document.
 */
export function writeState(dataDir, state) {
  mkdirSync(dataDir, { recursive: true });
  const file = statePath(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  return state;
}

/** Record one component's outcome without touching the others. */
export function setComponent(state, id, status, extra = {}) {
  state.components = {
    ...state.components,
    [id]: {
      ...(state.components?.[id] ?? emptyComponent()),
      status,
      lastChecked: Date.now(),
      error: extra.error ?? null,
      ...(extra.version ? { version: extra.version } : {}),
      ...(extra.identifier ? { identifier: extra.identifier } : {}),
    },
  };
  return state;
}

/** Record one step's outcome without touching the others. */
export function recordStep(state, id, outcome) {
  state.steps = { ...state.steps, [id]: outcome };
  return state;
}

/**
 * Every required file of every required skill, and whether it is there.
 *
 * Cheap — a stat per file — and the only honest way to answer "are the skills
 * installed?" A directory that exists proves nothing: an npm install killed
 * halfway leaves one behind with half its catalogue.
 */
export function inspectSkills(dataDir, state = null, { resources = null } = {}) {
  const out = {};
  for (const skill of skills()) {
    /* Two copies are legitimate and both count.
       ------------------------------------------------------------------
       installed  what the skill's own CLI put in the application data during
                  setup — the current release.
       bundled    the copy that ships inside the application, so a fresh
                  installation and an offline machine both have a complete
                  design catalogue on day one.

       The installed copy is preferred; the bundled one is the floor. Treating
       a missing installed copy as a broken installation would reopen setup on
       every launch of a perfectly working application. */
    const candidates = [
      ["installed", state?.skills?.[skill.id]?.path ?? defaultSkillDir(dataDir, skill)],
      ["bundled", bundledSkillDir(resources, skill)],
    ].filter(([, dir]) => Boolean(dir));

    let best = null;
    const bySource = {};
    for (const [source, dir] of candidates) {
      const missing = skill.requiredFiles.filter((relative) => !readableFile(path.join(dir, relative)));
      const found = { source, path: dir, missing, complete: missing.length === 0 };
      bySource[source] = found;
      if (!best || found.missing.length < best.missing.length) best = found;
    }

    /* What the record says this installation *has*, as opposed to what it can
       fall back on. The distinction decides whether a launch repairs:

         recorded "installed", installed copy now incomplete → something deleted
           files from a working installation, and that is worth putting back.
         recorded "bundled" → setup already fell back, and the bundled copy
           being the one in use is the steady state, not damage. */
    const recordedSource = state?.skills?.[skill.id]?.source ?? null;
    const installedDamaged =
      recordedSource === "installed" && bySource.installed && !bySource.installed.complete;

    out[skill.id] = {
      id: skill.id,
      label: skill.label,
      path: best.path,
      source: best.source,
      recordedSource,
      required: skill.requiredFiles.length,
      installed: skill.requiredFiles.length - best.missing.length,
      missing: best.missing,
      complete: best.complete,
      /** True when the copy this installation recorded has lost files. */
      damaged: Boolean(installedDamaged),
      missingFromRecorded: installedDamaged ? bySource.installed.missing : [],
      verified: Boolean(state?.skills?.[skill.id]?.verified),
    };
  }
  return out;
}

/** Present, a real file, and not empty. An empty file is a failed download. */
function readableFile(file) {
  try {
    const info = statSync(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export function defaultSkillDir(dataDir, skill) {
  return path.join(dataDir, "uiux", `.${skill.assistant}`, "skills", skill.id);
}

/**
 * The copy that ships with the application.
 *
 * `resources` is what Tauri hands the bootstrap; the Next standalone server is
 * staged under it, and the catalogue is traced into that build. Without
 * `resources` — a developer running the bootstrap from the repository — the
 * checkout's own vendored copy is the right answer.
 */
export function bundledSkillDir(resources, skill) {
  const candidates = resources
    ? [
        // The packaged layout: the standalone server is staged under resources.
        path.join(resources, "server", "vendor", skill.id),
        // A caller that passed a repository root rather than a resources dir.
        path.join(resources, "vendor", skill.id),
      ]
    : [path.join(process.cwd(), "vendor", skill.id)];
  // The first that looks like the catalogue wins; otherwise the first, so the
  // caller gets a path to report rather than null.
  return (
    candidates.find((dir) => readableFile(path.join(dir, "scripts", "search.py"))) ?? candidates[0]
  );
}

/**
 * Does this launch need the setup screen?
 *
 * Deliberately cheap. The expensive parts of setup — hardware probing, npm,
 * a model download — are what make an application slow to start, so none of
 * them happen here. What does happen is a handful of `stat` calls and, when a
 * model is supposed to be installed, one request to a daemon on this machine.
 * That is milliseconds, and it is the difference between "the record says the
 * model is there" and "the model is there".
 *
 * `probeModel` is injectable so this stays testable, and so a caller that has
 * already asked can pass its answer instead of asking again.
 */
export async function needsSetup(
  dataDir,
  state = readState(dataDir),
  { probeModel = null, resources = null } = {},
) {
  // An unfinished download is the most specific answer, and the one the setup
  // screen should say out loud: "resuming" rather than "setting up".
  if (state.model?.pending) return { needed: true, reason: "resume-download" };
  if (state.repairRequested) return { needed: true, reason: "repair" };
  if (!state.completedAt) return { needed: true, reason: "first-launch" };
  if (state.revision !== BOOTSTRAP_REVISION) return { needed: true, reason: "update" };

  // The design catalogue, file by file. A missing catalogue is a repair, not a
  // reinstall: only what is absent gets fetched.
  const inspected = inspectSkills(dataDir, state, { resources });
  // Either no complete copy exists at all, or the copy this installation
  // recorded has lost files. Both are repairs; neither is a reinstall.
  const brokenSkill = Object.values(inspected).find((s) => !s.complete || s.damaged);
  if (brokenSkill) {
    return { needed: true, reason: "skills-missing", detail: brokenSkill.id };
  }

  /* The model, if this installation has one. A record that says a model is
     installed, on a machine where it was deleted from Ollama, is a record that
     has to be corrected — that is the whole reason "completed" cannot mean
     "this file says so". */
  if (state.model?.id && state.model.pending === false && probeModel) {
    const present = await probeModel(state.model.id);
    // `null` means the daemon could not be reached at all, which is not the
    // same as the model being gone: Ollama may simply not be running yet, and
    // the application works without it. Only a definite "not installed"
    // reopens setup.
    if (present === false) return { needed: true, reason: "model-missing" };
  }

  return { needed: false, reason: "ready" };
}

/**
 * Ask for setup to run again on the next launch.
 *
 * What "Repair Installation" writes. A flag rather than deleting the record,
 * because the record is what tells the repair which components are already
 * good — throwing it away would turn a repair into a reinstall.
 */
export function requestRepair(dataDir, state = readState(dataDir)) {
  state.repairRequested = Date.now();
  return writeState(dataDir, state);
}

export function clearRepairRequest(state) {
  delete state.repairRequested;
  return state;
}
