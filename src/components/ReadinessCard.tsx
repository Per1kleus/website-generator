"use client";

import { useState } from "react";
import { Card } from "./ui";
import { IconAlert, IconCheck } from "./icons";
import type { CategoryId, CategoryResult, ReadinessReport, Severity } from "@/lib/checklist";

/**
 * Client readiness, shown as a number someone can act on.
 *
 * A score on its own is a verdict without a reason, which is worse than no
 * score: it tells a person their work is 87% acceptable and nothing about
 * which 13% to go and fix. So every category is clickable and every deduction
 * inside it names what it took off and why.
 *
 * The status is not derived from the number alone. A critical failure sets
 * NOT READY whatever the score says, and the reason is printed directly under
 * it — a site that scores 96 and has no phone number on it is not 96% ready.
 */

const STATUS_STYLE: Record<ReadinessReport["status"], { ring: string; text: string }> = {
  READY: { ring: "border-success/40 bg-success/8", text: "text-success" },
  "READY WITH WARNINGS": { ring: "border-warning/40 bg-warning/8", text: "text-warning" },
  "NEEDS REVIEW": { ring: "border-warning/40 bg-warning/8", text: "text-warning" },
  "NOT READY": { ring: "border-danger/40 bg-danger/8", text: "text-danger" },
};

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: "text-danger",
  warning: "text-warning",
  info: "text-muted",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Must fix",
  warning: "Worth a look",
  info: "For information",
};

function Verdict({ value }: { value: CategoryResult["verdict"] }) {
  if (value === "PASS") {
    return (
      <span className="text-success" aria-label="passed">
        <IconCheck size={16} />
      </span>
    );
  }
  return (
    <span className={value === "FAIL" ? "text-danger" : "text-warning"} aria-label={value.toLowerCase()}>
      <IconAlert size={16} />
    </span>
  );
}

export function ReadinessCard({
  report,
  projectId,
}: {
  report: ReadinessReport;
  projectId: string;
}) {
  const [open, setOpen] = useState<CategoryId | null>(null);
  const style = STATUS_STYLE[report.status];
  const criticals = report.issues.filter((i) => i.severity === "critical").length;

  return (
    <Card className={`my-4 border ${style.ring}`}>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Client readiness
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums">
          {report.score}
          <span className="text-xl text-muted"> / 100</span>
        </p>
        <p className={`mt-1 text-sm font-bold ${style.text}`}>{report.status}</p>
        {report.overrideReason && (
          <p className="mx-auto mt-2 max-w-sm text-xs text-danger" data-readiness-override>
            {report.overrideReason}
          </p>
        )}
        <p className="mt-2 text-[0.6875rem] text-muted">
          This application&rsquo;s own deterministic score — not a Lighthouse result.
        </p>
      </div>

      <ul className="mt-4 space-y-1">
        {report.categories.map((category) => {
          const expanded = open === category.id;
          const actionable = category.issues.filter((i) => i.severity !== "info");
          return (
            <li key={category.id} className="rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : category.id)}
                aria-expanded={expanded}
                data-readiness-category={category.id}
                className="flex min-h-[var(--spacing-touch)] w-full items-center gap-3 px-3 text-left"
              >
                <Verdict value={category.verdict} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {category.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {category.score}/{category.max}
                </span>
                <span aria-hidden="true" className="shrink-0 text-xs text-muted">
                  {expanded ? "−" : "+"}
                </span>
              </button>

              {expanded && (
                <div className="border-t border-line px-3 py-2.5">
                  {category.issues.length === 0 ? (
                    <p className="text-xs text-muted">
                      Nothing to fix — full {category.max} points.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {category.issues.map((issue) => (
                        <li key={issue.id} className="text-xs">
                          <p className={`font-semibold ${SEVERITY_STYLE[issue.severity]}`}>
                            {SEVERITY_LABEL[issue.severity]}
                            {issue.cost > 0 && (
                              <span className="font-normal text-muted">
                                {" "}
                                · −{issue.cost} point{issue.cost === 1 ? "" : "s"}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-muted">{issue.issue}</p>
                          <p className="text-muted">
                            <span className="font-semibold">{issue.location}</span> →{" "}
                            {issue.correction}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {actionable.length === 0 && category.issues.length > 0 && (
                    <p className="mt-2 text-xs text-muted">
                      Nothing here costs points.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <a
          href={`/projects/${projectId}/deploy`}
          className={`inline-flex min-h-[var(--spacing-touch-lg)] flex-1 items-center justify-center rounded-xl px-6 text-base font-semibold ${
            criticals
              ? "border border-line bg-surface text-muted"
              : "bg-brand text-on-brand active:scale-[0.98]"
          }`}
          aria-disabled={criticals > 0}
        >
          {criticals ? "Fix the critical issues first" : "Publish"}
        </a>
      </div>
    </Card>
  );
}
