import "server-only";
import manifest from "../../desktop/bootstrap/manifest.json";

/**
 * The setup manifest, as the running server sees it.
 *
 * The same `desktop/bootstrap/manifest.json` the first-launch bootstrap reads,
 * imported statically so the bundler inlines it — which means this works
 * identically in development, in the standalone production server and inside
 * the packaged desktop application, with no path to resolve at runtime.
 *
 * The reason for sharing it rather than restating it: the required model used
 * to be written out twice, once here and once in the bootstrap's model ladder.
 * Two copies of a value that must agree is a bug with a delay on it.
 */

export type ManifestSkill = {
  id: string;
  label: string;
  package: string;
  assistant: string;
  requiredFiles: string[];
  verify: { script: string; args: string[]; expectKey: string; timeoutMs: number };
  approximateMb: number;
};

export type ManifestModel = {
  id: string;
  label: string;
  downloadGb: number;
  runtimeGb: number;
  needs: { ramGb: number };
  summary: string;
};

export const SETUP_REVISION: number = manifest.revision;
export const SETUP_SCHEMA: number = manifest.schema;

/** Every skill a complete installation has, with the files that prove it. */
export const REQUIRED_SKILLS: ManifestSkill[] = manifest.skills as ManifestSkill[];

export const MODEL_LADDER: ManifestModel[] = manifest.ai.models as ManifestModel[];

/**
 * The one model identifier this application requires.
 *
 * `WG_OLLAMA_MODEL` overrides it, which is how the desktop hands over the model
 * the user actually chose during setup; with nothing set, the manifest decides.
 */
export function requiredModel(): string {
  return process.env.WG_OLLAMA_MODEL || manifest.ai.requiredModel;
}

export function modelInfo(id: string): ManifestModel | null {
  return MODEL_LADDER.find((m) => m.id === id) ?? null;
}

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST || manifest.ai.host).replace(/\/+$/, "");
}

export const READINESS = manifest.ai.readiness;
export const DISK_BUDGET = manifest.disk;
export const APPLICATION_DIRS: string[] = manifest.application.directories;
export const STATE_FILE: string = manifest.application.stateFile;
