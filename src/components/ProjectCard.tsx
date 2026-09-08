import Link from "next/link";
import type { Project } from "@/server/projects";
import { SITE_KINDS } from "@/lib/site";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString();
}

const STATUS: Record<Project["status"], { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-elevated text-muted" },
  generating: { label: "Generating", className: "bg-brand-soft text-brand" },
  ready: { label: "Ready", className: "bg-success/12 text-success" },
  failed: { label: "Needs attention", className: "bg-danger/12 text-danger" },
};

export function ProjectCard({ project }: { project: Project }) {
  const kind = SITE_KINDS.find((k) => k.id === project.site_kind);
  const status = STATUS[project.status];
  // A generating project must land on the progress screen, so the user picks
  // up exactly where they left off after locking their phone.
  const href =
    project.status === "generating"
      ? `/projects/${project.id}/generate`
      : `/projects/${project.id}`;

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-2xl leading-none">
          {kind?.emoji ?? "🌐"}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{project.business_name}</h2>
          <p className="truncate text-sm text-muted">
            {kind?.label ?? "Website"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-3 text-xs text-muted">
        Updated {relativeTime(project.updated_at)}
      </p>

      {/* Full-width tap target: the whole row is the action on a phone. */}
      <Link
        href={href}
        className="mt-3 flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center rounded-xl bg-brand px-4 font-semibold text-on-brand active:scale-[0.98]"
      >
        {project.status === "generating" ? "View progress" : "Open project"}
      </Link>
    </div>
  );
}
