/**
 * The setup manifest, and the questions asked of it.
 *
 * `setup-manifest.json` is the data; this is the only place that interprets it.
 * Both exist so that "what does a working installation consist of?" has exactly
 * one answer, rather than one answer per file that happens to need it.
 *
 * Read from disk rather than imported as a JSON module so the same file works
 * under every Node version this application has shipped with, and so a packaged
 * build can be inspected — and, if it ever has to be, corrected — without
 * rebuilding anything.
 *
 * It sits at the repository root rather than beside this file, and that is not
 * cosmetic: the running server imports it too, and Next's output tracing
 * follows an import outside `src/` by carrying its directory into the
 * standalone build. With the manifest under `desktop/`, that swept the Rust
 * build directory into the bundle and produced a 7.5 GB server. At the root it
 * is one file with nothing around it to sweep.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two layouts, one file.
 *
 *   repository   <root>/setup-manifest.json, two levels up from here
 *   packaged     <resources>/setup-manifest.json, one level up from
 *                <resources>/bootstrap/
 */
function manifestPath() {
  const candidates = [
    path.join(here, "..", "..", "setup-manifest.json"),
    path.join(here, "..", "setup-manifest.json"),
  ];
  const found = candidates.find((file) => existsSync(file));
  if (!found) {
    throw new Error("setup-manifest.json is missing. The installation is incomplete.");
  }
  return found;
}

export const MANIFEST = JSON.parse(readFileSync(manifestPath(), "utf8"));

/** Bump `revision` in the manifest to make every installation re-provision. */
export const BOOTSTRAP_REVISION = MANIFEST.revision;
export const SCHEMA = MANIFEST.schema;

/**
 * The model this application requires.
 *
 * One value, from one place. `WG_OLLAMA_MODEL` overrides it for an operator
 * who has a reason to; nothing in the code may carry a second default.
 */
export function requiredModel() {
  return process.env.WG_OLLAMA_MODEL || MANIFEST.ai.requiredModel;
}

export function models() {
  return MANIFEST.ai.models;
}

export function skills() {
  return MANIFEST.skills;
}

export function ollamaHost() {
  return (process.env.OLLAMA_HOST || MANIFEST.ai.host).replace(/\/+$/, "");
}

export function readiness() {
  return MANIFEST.ai.readiness;
}

export function installerSpec() {
  return MANIFEST.ai.installer;
}

/**
 * Is every component accounted for?
 *
 * The completion rule, in one place. A mandatory component must have verified;
 * an optional one must have verified or have been consciously skipped after the
 * user saw the failure. Anything else and setup is not complete, whatever the
 * screen managed to show.
 */
export function completionCheck(components = {}) {
  const { mandatory, optionalWithConsent } = MANIFEST.completion;
  const statusOf = (id) => components[id]?.status ?? "not_started";

  const blocking = mandatory.filter((id) => statusOf(id) !== "completed");
  const unresolved = optionalWithConsent.filter(
    (id) => !["completed", "skipped"].includes(statusOf(id)),
  );
  const skipped = optionalWithConsent.filter((id) => statusOf(id) === "skipped");

  return {
    complete: blocking.length === 0 && unresolved.length === 0,
    blocking: [...blocking, ...unresolved],
    /** Complete, but without something optional the user declined. */
    degraded: skipped.length > 0,
    skipped,
  };
}

export function mandatoryComponents() {
  return MANIFEST.completion.mandatory;
}

/**
 * How much room the first launch needs, in gigabytes.
 *
 * Deliberately the whole job rather than just the model: a check that passes
 * because 1 GB is free, and then fails because Ollama unpacks 4.5 GB of CUDA
 * libraries, is worse than no check at all — the user has already waited.
 *
 * Components that are already installed are excluded, because they are not
 * going to be downloaded again.
 */
export function diskBudgetGb({ model = null, needsOllama = true, needsSkills = true } = {}) {
  const d = MANIFEST.disk;
  const parts = [];
  if (needsOllama) {
    parts.push(["Ollama", d.ollamaInstallGb + d.ollamaDownloadGb]);
  }
  if (model) {
    parts.push([model.label ?? model.id, model.downloadGb]);
  }
  if (needsSkills) {
    parts.push(["Design catalogue", d.skillsGb]);
  }
  parts.push(["Temporary download space", d.temporaryGb]);
  parts.push(["Working space", d.marginGb]);

  const totalGb = Number(parts.reduce((sum, [, gb]) => sum + gb, 0).toFixed(1));
  return { totalGb, parts };
}
