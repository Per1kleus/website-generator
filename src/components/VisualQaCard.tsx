import { Card } from "@/components/ui";
import { VIEWPORTS, type QaReport, type ViewportId } from "@/lib/visual-qa";

/**
 * The four-viewport check, shown to the creator.
 *
 * The point of showing it is that every line is actionable: a verdict per
 * width, a verdict per category, and for each issue the exact thing to do. A
 * score with nothing behind it would only be decoration.
 */

const VERDICT_STYLE: Record<"PASS" | "WARNING" | "FAIL", string> = {
  PASS: "bg-success/12 text-success",
  WARNING: "bg-warning/12 text-warning",
  FAIL: "bg-danger/12 text-danger",
};

function Verdict({ value }: { value: "PASS" | "WARNING" | "FAIL" }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${VERDICT_STYLE[value]}`}>
      {value}
    </span>
  );
}

export function VisualQaCard({
  report,
  corrections = [],
}: {
  report: QaReport;
  /** What the generator already fixed on its own, in the creator's language. */
  corrections?: { id: string; what: string }[];
}) {
  const errors = report.issues.filter((i) => i.level === "error");
  const warnings = report.issues.filter((i) => i.level === "warning");
  const tone = errors.length ? "FAIL" : warnings.length ? "WARNING" : "PASS";

  return (
    <Card className="my-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold">Visual check</h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          {report.score}/100 <Verdict value={tone} />
        </span>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VIEWPORTS.map((vp) => (
          <li
            key={vp.id}
            className="flex flex-col gap-1 rounded-xl border border-line px-3 py-2"
          >
            <span className="text-xs font-semibold">{vp.label}</span>
            <span className="text-[0.6875rem] text-muted">{vp.width}px</span>
            <Verdict value={report.viewports[vp.id as ViewportId]} />
          </li>
        ))}
      </ul>

      {corrections.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted">Fixed automatically</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">
            {corrections.map((c) => (
              <li key={c.id}>{c.what}</li>
            ))}
          </ul>
        </div>
      )}

      {report.issues.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted">
            {errors.length ? `${errors.length} to fix` : "To review"}
          </p>
          <ul className="mt-1 space-y-2">
            {[...errors, ...warnings].slice(0, 6).map((issue) => (
              <li key={`${issue.id}-${issue.location}`} className="text-xs">
                <span className={issue.level === "error" ? "font-semibold text-danger" : "font-semibold"}>
                  {issue.location}
                </span>
                {issue.viewports.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    ({issue.viewports.join(", ")})
                  </span>
                )}
                <span className="block text-muted">{issue.issue}</span>
                <span className="block text-muted">→ {issue.correction}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.issues.length === 0 && (
        <p className="mt-3 text-xs text-muted">
          Nothing to fix — the page holds together at every width checked.
        </p>
      )}
    </Card>
  );
}
