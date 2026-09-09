import "server-only";
import { randomUUID } from "node:crypto";
import { GENERATION_STEPS, type Site } from "@/lib/site";
import { db } from "./db";
import { runGeneration, type GenerationInput } from "./generator";
import { validateSite, type Finding } from "./validate";

/**
 * Generation runs in the server process, not in the browser tab.
 *
 * Requirement 5: generation must continue if the user temporarily leaves the
 * application. The route handler starts the job and returns immediately; the
 * async work keeps running and writes every state change to SQLite, so a user
 * returning from a locked phone reads real backend state rather than a
 * restarted animation.
 */

export type JobStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
};

export type Job = {
  id: string;
  project_id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  steps: JobStep[];
  progress: number;
  message: string;
  error: string | null;
  created_at: number;
  updated_at: number;
};

const GENERATE_STEPS: JobStep[] = GENERATION_STEPS.map((s) => ({ ...s, status: "pending" as const }));

type JobRow = Omit<Job, "steps"> & { steps: string };

function rowToJob(row: JobRow): Job {
  return { ...row, steps: JSON.parse(row.steps) as JobStep[] };
}

export function getJob(id: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function getLatestJob(projectId: string): Job | null {
  const row = db
    .prepare("SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

function writeJob(id: string, patch: Partial<Omit<Job, "id" | "steps">> & { steps?: JobStep[] }) {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    values.push(k === "steps" ? JSON.stringify(v) : v);
  }
  fields.push("updated_at = ?");
  values.push(Date.now(), id);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

/**
 * Marks every step before `stageKey` done, `stageKey` active, and recomputes
 * progress. Driving it from the stage name means the pipeline reports where it
 * genuinely is, even when a stage is skipped (a single-language site skips
 * translation, so that step completes immediately rather than lying).
 */
function reportStage(jobId: string, stageKey: string, message: string) {
  const job = getJob(jobId);
  if (!job) return;
  const index = job.steps.findIndex((s) => s.key === stageKey);
  if (index < 0) {
    writeJob(jobId, { message });
    return;
  }
  const steps = job.steps.map((s, i) => ({
    ...s,
    status: i < index ? ("done" as const) : i === index ? ("active" as const) : s.status,
  }));
  writeJob(jobId, {
    steps,
    progress: Math.round((index / steps.length) * 100),
    message,
  });
}

export function startGeneration(projectId: string, input: GenerationInput): Job {
  const id = randomUUID();
  const now = Date.now();
  const steps = GENERATE_STEPS.map((s, i) => (i === 0 ? { ...s, status: "active" as const } : s));

  db.prepare(
    `INSERT INTO jobs (id, project_id, kind, status, steps, progress, message, created_at, updated_at)
     VALUES (?, ?, 'generate', 'running', ?, 0, ?, ?, ?)`,
  ).run(id, projectId, JSON.stringify(steps), "Looking up your business", now, now);

  db.prepare("UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ?").run(now, projectId);

  // Intentionally not awaited: the HTTP response returns straight away and the
  // work continues in the background. Every failure path is handled inside.
  void run(id, projectId, input);

  return getJob(id)!;
}

async function run(jobId: string, projectId: string, input: GenerationInput) {
  try {
    const { site, profile, identity, usedAi } = await runGeneration(input, (stage, message) => {
      reportStage(jobId, stage, message);
    });

    reportStage(jobId, "validate", "Running validation");
    const findings = validateSite(site, profile);
    const errors = findings.filter((f) => f.level === "error");

    const now = Date.now();
    db.prepare(
      `UPDATE projects
          SET site = ?, status = 'ready', business_profile = ?, design_system = ?,
              default_locale = ?, locales = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      JSON.stringify(site),
      JSON.stringify(profile),
      JSON.stringify(identity),
      site.meta.defaultLocale,
      JSON.stringify(site.meta.locales),
      now,
      projectId,
    );
    db.prepare(
      "INSERT INTO versions (id, project_id, label, site, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), projectId, "Generated", JSON.stringify(site), now);

    const job = getJob(jobId);
    writeJob(jobId, {
      status: "done",
      progress: 100,
      steps: (job?.steps ?? []).map((s) => ({ ...s, status: "done" as const })),
      message: errors.length
        ? `Ready — ${errors.length} thing${errors.length === 1 ? "" : "s"} need attention`
        : usedAi
          ? "Your website is ready"
          : "Your website is ready (starter content)",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    const job = getJob(jobId);
    writeJob(jobId, {
      status: "failed",
      error: message,
      message: "Generation failed",
      steps: (job?.steps ?? []).map((s) =>
        s.status === "active" ? { ...s, status: "failed" as const } : s,
      ),
    });
    db.prepare("UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ?").run(
      Date.now(),
      projectId,
    );
  }
}

/** Kept as the shared entry point used by API routes and the project screen. */
export function qaCheck(site: Site): string[] {
  return validateSite(site).map((f) => f.message);
}

export type { Finding };
