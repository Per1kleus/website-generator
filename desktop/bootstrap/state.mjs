/**
 * The initialisation marker.
 *
 * Setup runs once. What makes that safe is that "once" is recorded properly:
 * a versioned JSON document in the Windows application-data directory,
 * alongside the database — not a temporary file, and not something a browser
 * cache clear can lose.
 *
 * Two rules follow from the requirements and are enforced here:
 *
 *   1. Nothing is marked complete until the component it describes verified.
 *      A half-finished setup leaves the marker absent, so the next launch
 *      resumes rather than trusting a lie.
 *   2. An application update must not redo the work. The marker carries a
 *      schema and a bootstrap revision; setup re-runs only when the revision
 *      genuinely changes what has to be installed, and even then it re-runs
 *      only the steps that changed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Bump only when a release needs an installed component to change. */
export const BOOTSTRAP_REVISION = 1;
const SCHEMA = 1;

export function statePath(dataDir) {
  return path.join(dataDir, "setup-state.json");
}

export function emptyState() {
  return {
    schema: SCHEMA,
    revision: BOOTSTRAP_REVISION,
    completedAt: null,
    hardware: null,
    /** { id, verifiedAt, pending } — pending survives an interrupted download. */
    model: null,
    localAi: null,
    uiux: null,
    steps: {},
  };
}

export function readState(dataDir) {
  const file = statePath(dataDir);
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.schema !== SCHEMA) return emptyState();
    return { ...emptyState(), ...parsed };
  } catch {
    // A corrupt marker means "not set up", which is recoverable. Treating it
    // as set up would leave the application permanently broken.
    return emptyState();
  }
}

/**
 * Write atomically. A power cut during setup should leave either the old
 * marker or the new one, never half a JSON document.
 */
export function writeState(dataDir, state) {
  mkdirSync(dataDir, { recursive: true });
  const file = statePath(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  return state;
}

/**
 * Does this launch need the setup screen?
 *
 * Deliberately cheap: a marker read and, at most, a look at whether recorded
 * files still exist. No hardware probing, no network calls, no daemon checks —
 * those are what make an application slow to start, and the application
 * already copes at runtime with a local model that has gone away.
 */
export function needsSetup(dataDir, state = readState(dataDir)) {
  // An unfinished download is the most specific answer, and the one the setup
  // screen should say out loud: "resuming" rather than "setting up", whether
  // the interruption happened during the first run or a later one.
  if (state.model?.pending) return { needed: true, reason: "resume-download" };
  if (!state.completedAt) return { needed: true, reason: "first-launch" };
  if (state.revision !== BOOTSTRAP_REVISION) return { needed: true, reason: "update" };
  if (state.uiux?.path && !existsSync(state.uiux.path)) {
    return { needed: true, reason: "uiux-missing" };
  }
  return { needed: false, reason: "ready" };
}

/** Record one step's outcome without touching the others. */
export function recordStep(state, id, outcome) {
  state.steps = { ...state.steps, [id]: outcome };
  return state;
}
