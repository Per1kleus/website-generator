"use client";

import { Card } from "./ui";
import { IconCheck, IconAlert } from "./icons";
import type { PerfReport } from "@/lib/performance";

/**
 * The performance score, and where every part of it came from.
 *
 * Two kinds of number live here and they are not the same kind of claim, so
 * they are labelled separately rather than averaged into one reassuring
 * figure:
 *
 *   Measured    bytes on disk, bytes of generated markup and CSS, image
 *               dimensions recorded at upload, the loading attributes the
 *               renderer emitted. Facts about the files.
 *
 *   Predicted   what a phone would download, derived from those facts and
 *               from the widths the page offers. Static analysis. No page was
 *               loaded, no browser was involved, and nothing here is a
 *               Lighthouse result.
 *
 * A tool that blurred the two would be claiming to have measured something it
 * never ran.
 */

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export function PerformanceCard({ report }: { report: PerfReport }) {
  const m = report.measured;
  const applicable = report.categories.filter((c) => !c.notApplicable);
  const warnings = report.findings.filter((f) => f.level === "warning");

  return (
    <section data-performance-card data-performance-score={report.score}>
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold">Performance</h2>
          <p className="text-2xl font-bold tabular-nums">
            {report.score}
            <span className="text-sm font-normal text-muted"> / 100</span>
          </p>
        </div>

        <ul className="mt-3 space-y-1">
          {applicable.map((category) => {
            const clean = category.score === category.max;
            return (
              <li
                key={category.id}
                className="flex items-center gap-2 text-sm"
                data-performance-category={category.id}
              >
                <span className={clean ? "text-success" : "text-warning"}>
                  {clean ? <IconCheck size={16} /> : <IconAlert size={16} />}
                </span>
                <span className="flex-1">{category.label}</span>
                <span className="tabular-nums text-muted">
                  {category.score}/{category.max}
                </span>
              </li>
            );
          })}
        </ul>

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {warnings.slice(0, 4).map((finding) => (
              <li key={finding.id} className="text-xs text-muted">
                <span className="text-warning">⚠</span> {finding.issue}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Measured</h3>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" data-performance-measured>
            <dt className="text-muted">Page document</dt>
            <dd className="text-right tabular-nums">{kb(m.htmlBytes)}</dd>
            <dt className="text-muted">Stylesheet</dt>
            <dd className="text-right tabular-nums">{kb(m.cssBytes)}</dd>
            <dt className="text-muted">Photographs</dt>
            <dd className="text-right tabular-nums">
              {m.imageCount ? `${kb(m.imageBytes)} · ${m.imageCount}` : "none"}
            </dd>
            <dt className="text-muted">Lazy-loaded</dt>
            <dd className="text-right tabular-nums">{m.lazyImages}</dd>
            <dt className="text-muted">Offering several widths</dt>
            <dd className="text-right tabular-nums">{m.responsiveImages}</dd>
            <dt className="text-muted">Font weights requested</dt>
            <dd className="text-right tabular-nums">{m.fontWeights}</dd>
          </dl>

          <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">
            Predicted
          </h3>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" data-performance-predicted>
            <dt className="text-muted">Phone downloads (390px)</dt>
            <dd className="text-right tabular-nums">
              {m.imageCount ? kb(m.mobileImageBytes) : "no photographs"}
            </dd>
          </dl>

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted">
            Measured values are the real files this website is made of. The
            predicted value is worked out from them and from the widths each
            image offers — no page was loaded and no browser was involved, so
            this is not a Lighthouse score and does not claim to be.
          </p>
        </div>
      </Card>
    </section>
  );
}
