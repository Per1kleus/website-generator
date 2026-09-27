import "server-only";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  APPLICATION_DIRS, REQUIRED_SKILLS, STATE_FILE, requiredModel,
  type ManifestSkill,
} from "./setup-manifest";
import { probe, pullModel } from "./ollama";
import { runSkill, skillRoots } from "./uiux";
import { pythonBin } from "./runtime";

const execFileAsync = promisify(execFile);

/**
 * What a working installation consists of, checked against this machine.
 *
 * The first-launch bootstrap provisions these components; this is the running
 * application's own view of the same list, for two jobs the bootstrap cannot do:
 * telling the user what is currently true, and repairing what has gone missing
 * without making them reinstall the application.
 *
 * Both read the same `setup-manifest.json`, so there is one
 * definition of "required" and not two that drift.
 *
 * Deliberately not an import of the bootstrap's own modules: those are plain
 * scripts the packaged application runs with the bundled Node runtime, outside
 * this server's module graph. Sharing the manifest is the part that matters;
 * sharing the file-stat loop would buy nothing and would tie the production
 * server's build to the desktop layout.
 */

export type ComponentStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "skipped"
  | "failed";

export type ComponentReport = {
  id: string;
  label: string;
  status: ComponentStatus;
  /** One sentence, for a person. Never a path and never a stack trace. */
  detail: string;
  /** True when this component alone stops the application being fully ready. */
  blocking: boolean;
};

export type SkillReport = {
  id: string;
  label: string;
  required: number;
  installed: number;
  verified: boolean;
  source: "installed" | "bundled" | "missing";
};

export type ReadinessReport = {
  /** Where the record says setup got to, if there is a record at all. */
  recorded: { status: string; completedAt: number | null; degraded: string[] } | null;
  components: ComponentReport[];
  skills: SkillReport[];
  model: { required: string; installed: boolean; verified: boolean };
  /** True when every mandatory component is complete. */
  ready: boolean;
};

/* ------------------------------------------------------------------ record */

function dataDir(): string {
  return process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data");
}

function statePath(): string {
  return path.join(dataDir(), STATE_FILE);
}

type StoredState = {
  status?: string;
  completedAt?: number | null;
  degraded?: string[];
  skills?: Record<string, { path?: string; source?: string; verified?: boolean }>;
  model?: { id?: string; pending?: boolean };
  repairRequested?: number;
};

export function readSetupState(): StoredState | null {
  try {
    const file = statePath();
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredState;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Ask the next launch to repair the installation.
 *
 * A flag rather than deleting the record: the record is what tells the repair
 * which components are already good, so throwing it away would turn a repair
 * into a reinstall. Written atomically, and only ever this one field.
 *
 * Meaningful on the desktop, where a launcher reads it. On a hosted deployment
 * there is no launcher, and the caller is told so rather than being left to
 * wonder why nothing happened.
 */
export function requestRestartRepair(): boolean {
  try {
    const file = statePath();
    if (!existsSync(file)) return false;
    const state = (JSON.parse(readFileSync(file, "utf8")) ?? {}) as StoredState;
    state.repairRequested = Date.now();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ skills */

function readableFile(file: string): boolean {
  try {
    const info = statSync(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function missingFiles(dir: string, skill: ManifestSkill): string[] {
  return skill.requiredFiles.filter((relative) => !readableFile(path.join(dir, relative)));
}

/**
 * Every required skill, file by file, then actually used.
 *
 * Two copies are legitimate: the release the setup installed, and the one that
 * ships inside the application. Whichever is complete answers; a skill is
 * `verified` only once the application's own loader has run it and got a design
 * system back, because a directory of files is not a working catalogue.
 */
export async function inspectSkills(): Promise<SkillReport[]> {
  const roots = skillRoots();
  const state = readSetupState();
  const out: SkillReport[] = [];

  for (const skill of REQUIRED_SKILLS) {
    const recorded = state?.skills?.[skill.id]?.path ?? null;
    const candidates: [SkillReport["source"], string][] = [];
    if (recorded) candidates.push(["installed", recorded]);
    if (roots.installed && roots.installed !== recorded) candidates.push(["installed", roots.installed]);
    candidates.push(["bundled", roots.bundled]);

    let best: { source: SkillReport["source"]; missing: string[] } = {
      source: "missing",
      missing: skill.requiredFiles,
    };
    for (const [source, dir] of candidates) {
      const missing = missingFiles(dir, skill);
      if (missing.length < best.missing.length) best = { source, missing };
      if (missing.length === 0) break;
    }

    out.push({
      id: skill.id,
      label: skill.label,
      required: skill.requiredFiles.length,
      installed: skill.requiredFiles.length - best.missing.length,
      // Only asked when the files are all there; running the loader against a
      // half-installed catalogue would produce a confusing failure rather than
      // the plain "files are missing" the user needs to hear.
      verified: best.missing.length === 0 ? await skillAnswers() : false,
      source: best.missing.length === 0 ? best.source : "missing",
    });
  }
  return out;
}

/**
 * Does the catalogue answer?
 *
 * Through `runSkill` — the application's own loader, with its own resolution
 * order — so "verified" means what the generator will experience rather than
 * what a separate check believes.
 */
async function skillAnswers(): Promise<boolean> {
  const result = await runSkill({
    query: "warm artisanal cafe",
    variance: 4,
    motion: 2,
    density: 4,
    source: "heuristic",
  });
  return Boolean(result?.style?.id);
}

/* ----------------------------------------------------------------- runtime */

async function pythonPresent(): Promise<boolean> {
  try {
    await execFileAsync(pythonBin(), ["--version"], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- the model */

/**
 * Is the required model installed, and does it answer?
 *
 * `verify` loads the model, which takes a few seconds, so it is opt-in: the
 * status card asks without it, and a repair asks with it.
 */
export async function inspectModel(
  { verify = false } = {},
): Promise<{ required: string; installed: boolean; verified: boolean; daemon: boolean }> {
  const state = await probe();
  const required = requiredModel();
  if (!state.available || !state.modelReady) {
    return { required, installed: false, verified: false, daemon: state.available };
  }
  if (!verify) return { required, installed: true, verified: false, daemon: true };
  return { required, installed: true, verified: await modelAnswers(required), daemon: true };
}

/**
 * A minimal health check against the model.
 *
 * Fixed instruction, temperature zero, a tight token ceiling — and nothing
 * about anybody's business. It exists to prove the model loads and replies, not
 * to generate anything.
 */
async function modelAnswers(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${process.env.OLLAMA_HOST || "http://127.0.0.1:11434"}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 32 },
        messages: [
          { role: "system", content: 'Reply with JSON only: {"ok":true}' },
          { role: "user", content: "Say ok." },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { message?: { content?: string } };
    return typeof data.message?.content === "string" && data.message.content.includes("{");
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- report */

export async function readiness({ verifyModel = false } = {}): Promise<ReadinessReport> {
  const state = readSetupState();
  const [skills, model, python] = await Promise.all([
    inspectSkills(),
    inspectModel({ verify: verifyModel }),
    pythonPresent(),
  ]);

  /* The application's own folders.
     Created rather than complained about: they are this application's to
     maintain, `mkdir -p` is idempotent and costs nothing, and reporting a
     failure for something fixable in a microsecond would be theatre. What is
     worth reporting is a volume that cannot be written to at all, which is
     what a throw here means. */
  let dirsPresent = true;
  try {
    for (const name of APPLICATION_DIRS) {
      mkdirSync(path.join(dataDir(), name), { recursive: true });
    }
  } catch {
    dirsPresent = false;
  }

  const skillsComplete = skills.every((s) => s.source !== "missing");
  const skillsVerified = skills.every((s) => s.verified);

  const components: ComponentReport[] = [
    {
      id: "application",
      label: "Application",
      status: dirsPresent ? "completed" : "failed",
      detail: dirsPresent
        ? "Folders and settings are in place."
        : "The application cannot write to its data folder.",
      blocking: !dirsPresent,
    },
    {
      id: "runtime",
      label: "Runtime",
      status: "completed",
      detail: python
        ? `Node ${process.version} and Python are available.`
        : `Node ${process.version}. Python was not found, so the design catalogue uses built-in rules.`,
      blocking: false,
    },
    {
      id: "skills",
      label: "Design skills",
      status: skillsComplete ? "completed" : "failed",
      detail: !skillsComplete
        ? "Part of the design catalogue is missing. Repair will install it again."
        : skillsVerified
          ? `${skills.length} of ${skills.length} installed and answering.`
          : "Installed, but not answering — Python may be missing on this computer.",
      blocking: !skillsComplete,
    },
    {
      id: "ollama",
      label: "Local AI runtime",
      status: model.daemon ? "completed" : "skipped",
      detail: model.daemon
        ? "Ollama is running on this computer."
        : "Ollama is not running. Websites are still generated without it.",
      blocking: false,
    },
    {
      id: "model",
      label: "Local AI model",
      status: model.installed ? (verifyModel && !model.verified ? "failed" : "completed") : "skipped",
      detail: !model.daemon
        ? "Waiting for the local AI runtime."
        : !model.installed
          ? `${model.required} is not installed yet.`
          : verifyModel
            ? model.verified
              ? `${model.required} is installed and answering.`
              : `${model.required} is installed but did not answer.`
            : `${model.required} is installed.`,
      blocking: false,
    },
  ];

  return {
    recorded: state
      ? {
          status: state.status ?? (state.completedAt ? "completed" : "not_started"),
          completedAt: state.completedAt ?? null,
          degraded: state.degraded ?? [],
        }
      : null,
    components,
    skills,
    model: { required: model.required, installed: model.installed, verified: model.verified },
    ready: components.every((c) => !c.blocking),
  };
}

/* ----------------------------------------------------------------- repair */

export type RepairResult = {
  ok: boolean;
  /** What was actually done, in the order it happened. */
  actions: string[];
  /** What this application cannot do from here, and what to do instead. */
  advice: string[];
  report: ReadinessReport;
};

/**
 * Install what is missing, and only what is missing.
 *
 * The rule from the requirements is the whole design: nothing working is
 * deleted, nothing already present is downloaded again. What the running server
 * can genuinely fix, it fixes — a missing model is pulled. What needs the
 * desktop launcher or an administrator, it says plainly and, where a launcher
 * exists, asks the next launch to do.
 */
export async function repair(): Promise<RepairResult> {
  const actions: string[] = [];
  const advice: string[] = [];

  const before = await readiness();

  // The model: the one large thing this server can provision by itself.
  if (before.model.installed) {
    actions.push(`${before.model.required} is already installed — nothing was downloaded.`);
  } else if (!before.components.find((c) => c.id === "ollama")?.status.startsWith("comp")) {
    advice.push(
      "Ollama is not running on this computer. Start it, or let the application install it the next time it opens.",
    );
  } else {
    void pullModel();
    actions.push(`Started downloading ${before.model.required}.`);
  }

  // The skills: repaired by the launcher, which has npm beside it.
  const brokenSkills = before.skills.filter((s) => s.source === "missing");
  if (brokenSkills.length) {
    advice.push(
      "Part of the design catalogue is missing. Reopen the application to install it again.",
    );
  } else {
    actions.push("The design catalogue is complete.");
  }

  const needsLauncher = advice.length > 0;
  if (needsLauncher && requestRestartRepair()) {
    actions.push("The next launch will finish the repair.");
  }

  return { ok: !needsLauncher, actions, advice, report: await readiness() };
}
