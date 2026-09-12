import Link from "next/link";
import { relativeTime, stateInfo, type ProjectState } from "@/lib/project-status";
import type { Project } from "@/server/projects";
import { SITE_KINDS } from "@/lib/site";

/**
 * One project, as it appears in the list.
 *
 * The list is where someone with six clients decides what to work on next, so
 * the card answers that and nothing else: what it is, what state it is in,
 * whether it passes its checks, and when it last moved. The readiness score
 * comes from the checklist rather than being recomputed here — one number,
 * one source.
 */

const TONE: Record<ReturnType<typeof stateInfo>["tone"], string> = {
  neutral: "bg-elevated text-muted",
  progress: "bg-brand-soft text-brand",
  good: "bg-success/12 text-success",
  warn: "bg-warning/12 text-warning",
  bad: "bg-danger/12 text-danger",
};

export type ProjectSummary = {
  state: ProjectState;
  /** Readiness score, or null when there is no site to score. */
  score: number | null;
  /** Number of things that must be fixed before this can be sent. */
  criticals: number;
  publishedUrl: string | null;
};

export function ProjectCard({
  project,
  summary,
}: {
  project: Project;
  summary: ProjectSummary;
}) {
  const kind = SITE_KINDS.find((k) => k.id === project.site_kind);
  const state = stateInfo(summary.state);
  // A generating project must land on the progress screen, so the user picks
  // up exactly where they left off after closing the window.
  const href =
    summary.state === "generating"
      ? `/projects/${project.id}/generate`
      : `/projects/${project.id}`;

  return (
    <div className="rounded-card border border-line bg-surface p-4" data-project-card>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-2xl leading-none">
          {kind?.emoji ?? "🌐"}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{project.business_name}</h2>
          <p className="truncate text-sm text-muted">{kind?.label ?? "Website"}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[state.tone]}`}
          data-project-state={state.id}
        >
          {state.label}
        </span>
      </div>

      {summary.score !== null && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold tabular-nums">
            Readiness {summary.score}/100
          </span>
          {summary.criticals > 0 && (
            <span className="font-semibold text-danger">
              {summary.criticals} to fix
            </span>
          )}
          {summary.publishedUrl && <span className="text-success">Live</span>}
        </p>
      )}

      <p className="mt-2 text-xs text-muted">Updated {relativeTime(project.updated_at)}</p>

      {/* Full-width tap target: the whole row is the action on a phone. */}
      <Link
        href={href}
        className="mt-3 flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-on-brand active:scale-[0.98]"
      >
        {summary.state === "generating" ? "View progress" : "Open project"}
      </Link>
    </div>
  );
}
