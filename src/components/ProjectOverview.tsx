import { relativeTime, type StateInfo } from "@/lib/project-status";

/**
 * The professional summary at the top of a project.
 *
 * Everything here is something a person about to hand a website over needs to
 * know at a glance and currently has to go looking for in four places: what
 * state it is in, whether it passes its checks, how fast it is, and whether
 * it is live. Each figure comes from the system that owns it — readiness from
 * the checklist, layout from visual QA, speed from the performance engine,
 * the address from the deployment record — so none of it can disagree with
 * the screens those systems have of their own.
 */

const TONE: Record<StateInfo["tone"], string> = {
  neutral: "bg-elevated text-muted",
  progress: "bg-brand-soft text-brand",
  good: "bg-success/12 text-success",
  warn: "bg-warning/12 text-warning",
  bad: "bg-danger/12 text-danger",
};

export type Figure = {
  label: string;
  value: string;
  /** Colour role, matching the state chips. */
  tone: StateInfo["tone"];
};

export function ProjectOverview({
  state,
  figures,
  updatedAt,
  publishedUrl,
}: {
  state: StateInfo;
  figures: Figure[];
  updatedAt: number;
  publishedUrl: string | null;
}) {
  return (
    <section
      aria-label="Project status"
      data-project-overview
      className="my-4 rounded-card border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${TONE[state.tone]}`}
          data-project-state={state.id}
        >
          {state.label}
        </span>
        <span className="text-xs text-muted">Updated {relativeTime(updatedAt)}</span>
      </div>

      <p className="mt-1.5 text-xs text-muted">{state.hint}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {figures.map((figure) => (
          <div key={figure.label} className="rounded-xl border border-line px-3 py-2">
            <dt className="text-[0.6875rem] uppercase tracking-wide text-muted">
              {figure.label}
            </dt>
            <dd className={`mt-0.5 text-sm font-bold ${TONE[figure.tone]} bg-transparent`}>
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>

      {publishedUrl && (
        <p className="mt-3 truncate text-xs">
          <span className="text-muted">Live at </span>
          <a
            href={publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand underline"
          >
            {publishedUrl.replace(/^https?:\/\//, "")}
          </a>
        </p>
      )}
    </section>
  );
}
