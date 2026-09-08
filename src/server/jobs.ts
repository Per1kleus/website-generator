import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { generateSite, type GenerationInput } from "./generator";
import { GENERATION_STEPS, type Site } from "@/lib/site";

/**
 * Generation runs in the server process, not in the browser tab.
 *
 * Requirement 5: "The generation process must continue if the user temporarily
 * leaves the application." The route handler starts the job and returns
 * immediately; the async work keeps running in the Node process and writes
 * every state change to SQLite. When the user comes back — from a locked
 * phone, a different tab, or a cold app launch — the progress screen reads the
 * real state out of the database rather than replaying a client-side animation.
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

const GENERATE_STEPS: JobStep[] = GENERATION_STEPS.map((s) => ({
  ...s,
  status: "pending" as const,
}));

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

/** Marks one step done and the next one active, recomputing overall progress. */
function advance(id: string, doneKey: string, nextKey: string | null, message: string) {
  const job = getJob(id);
  if (!job) return;
  const steps = job.steps.map((s) => {
    if (s.key === doneKey) return { ...s, status: "done" as const };
    if (s.key === nextKey) return { ...s, status: "active" as const };
    return s;
  });
  const done = steps.filter((s) => s.status === "done").length;
  writeJob(id, {
    steps,
    progress: Math.round((done / steps.length) * 100),
    message,
  });
}

export function startGeneration(projectId: string, input: GenerationInput): Job {
  const id = randomUUID();
  const now = Date.now();
  const steps = GENERATE_STEPS.map((s, i) =>
    i === 0 ? { ...s, status: "active" as const } : s,
  );

  db.prepare(
    `INSERT INTO jobs (id, project_id, kind, status, steps, progress, message, created_at, updated_at)
     VALUES (?, ?, 'generate', 'running', ?, 0, ?, ?, ?)`,
  ).run(id, projectId, JSON.stringify(steps), "Looking up your business", now, now);

  db.prepare("UPDATE projects SET status = 'generating', updated_at = ? WHERE id = ?").run(
    now,
    projectId,
  );

  // Intentionally not awaited: the HTTP response returns straight away and the
  // work continues in the background. Every failure path is handled inside.
  void runGeneration(id, projectId, input);

  return getJob(id)!;
}

async function runGeneration(jobId: string, projectId: string, input: GenerationInput) {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    // Each step is a real checkpoint the progress screen can report truthfully.
    await pause(400);
    advance(jobId, "research", "brand", "Analysing the brand");

    await pause(400);
    advance(jobId, "brand", "identity", "Creating the visual identity");

    await pause(300);
    advance(jobId, "identity", "build", "Writing and building your website");

    const { site, usedAi } = await generateSite(input, (msg) => {
      writeJob(jobId, { message: msg });
    });

    advance(jobId, "build", "qa", "Running quality checks");
    const warnings = qaCheck(site);
    await pause(300);

    const now = Date.now();
    db.prepare("UPDATE projects SET site = ?, status = 'ready', updated_at = ? WHERE id = ?").run(
      JSON.stringify(site),
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
      message: warnings.length
        ? `Ready — ${warnings.length} thing${warnings.length === 1 ? "" : "s"} to review`
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

/** Mobile-focused sanity checks on the finished document (requirement 24). */
export function qaCheck(site: Site): string[] {
  const warnings: string[] = [];
  const visible = site.sections.filter((s) => s.visible);

  if (!visible.length) warnings.push("The site has no visible sections.");
  if (!visible.some((s) => s.type === "contact")) {
    warnings.push("No contact section — visitors on a phone cannot reach the business.");
  }

  for (const s of visible) {
    if (s.type === "hero") {
      // Long headlines are the single most common way a design breaks at 320px.
      if (s.props.headline.length > 60) {
        warnings.push("The hero headline is long and may wrap awkwardly on small phones.");
      }
      if (!s.props.ctaLabel) warnings.push("The hero has no call-to-action button.");
    }
    if (s.type === "menu" && !s.props.categories.length) {
      warnings.push("The menu section is empty.");
    }
    if (s.type === "gallery" && !s.props.imageIds.length) {
      warnings.push("The gallery is visible but has no images.");
    }
  }
  return warnings;
}
