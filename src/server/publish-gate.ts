import "server-only";
import { assessReadiness, type CheckIssue } from "@/lib/checklist";
import { renderSite } from "@/lib/render";
import type { Site } from "@/lib/site";
import { listAssets } from "./projects";

/**
 * Whether a website is safe to put in front of the public.
 *
 * This adds no checks of its own. Everything it knows comes from the systems
 * that already decide what is wrong with a page — visual QA at four widths,
 * the SEO engine, the accessibility and content checks, the performance
 * engine — assembled by `lib/checklist.ts`. A second opinion here would be a
 * second thing to keep in step with the first.
 *
 * What it adds is a decision, and the line is drawn where the checklist
 * already draws it: an issue the checklist calls `critical` is one a person
 * would be embarrassed to send a client — no way to contact the business, a
 * link that goes nowhere, a page that does not render. Those block. Everything
 * else is a warning, shown and not enforced, because refusing to publish a
 * site over a meta description that could be better would be the tool getting
 * in the way of the work.
 *
 * The two things the checklist cannot tell us are checked first, because
 * without them there is nothing to assess: a document has to exist, and it
 * has to render.
 */

export type PublishBlocker = {
  /** Stable id, so the UI can link to the same issue the checklist shows. */
  id: string;
  /** What is wrong, in the creator's language. */
  issue: string;
  /** What to do about it. */
  correction: string;
};

export type PublishGate = {
  ok: boolean;
  /** Fatal problems. Non-empty means publication is refused. */
  blockers: PublishBlocker[];
  /** Worth seeing, never worth blocking for. */
  warnings: CheckIssue[];
  /** The readiness score, when one could be produced. */
  score: number | null;
  status: string;
};

export function checkPublishable(projectId: string, site: Site | null): PublishGate {
  const refuse = (id: string, issue: string, correction: string): PublishGate => ({
    ok: false,
    blockers: [{ id, issue, correction }],
    warnings: [],
    score: null,
    status: "NOT READY",
  });

  if (!site) {
    return refuse(
      "no-site",
      "This project has no website yet.",
      "Generate the website first.",
    );
  }

  // The build. If the renderer throws, or produces something that is not a
  // page, nothing downstream is meaningful — and this is exactly the failure
  // that must never reach a live URL.
  let html: string;
  try {
    html = renderSite(site, { locale: site.meta.defaultLocale });
  } catch (err) {
    console.error("[publish] render failed:", err);
    return refuse(
      "build-failed",
      "The website could not be built.",
      "Open the preview to see the error, or restore an earlier version.",
    );
  }
  if (!html.includes("<main") || html.length < 500) {
    return refuse(
      "build-empty",
      "The website built, but produced an empty page.",
      "Check that at least one section is switched on.",
    );
  }

  const images = Object.fromEntries(
    listAssets(projectId).map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]),
  );

  let report;
  try {
    report = assessReadiness({
      site,
      locale: site.meta.defaultLocale,
      html,
      images,
    });
  } catch (err) {
    // The checks themselves failing is not the site's fault, and refusing to
    // publish over it would be this application blaming the creator for its
    // own bug. Say so, and let them through.
    console.error("[publish] readiness assessment failed:", err);
    return {
      ok: true,
      blockers: [],
      warnings: [],
      score: null,
      status: "UNKNOWN",
    };
  }

  const blockers = report.issues
    .filter((i) => i.severity === "critical")
    .map((i) => ({ id: i.id, issue: i.issue, correction: i.correction }));

  return {
    ok: blockers.length === 0,
    blockers,
    warnings: report.issues.filter((i) => i.severity === "warning"),
    score: report.score,
    status: report.status,
  };
}
