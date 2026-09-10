import { contrastRatio, ensureContrast } from "./contrast";
import { auditSite, contentWidth, headingPx, longestRunEm, type QaIssue, type QaReport } from "./visual-qa";
import { key, t, type DesignTokens, type Site } from "./site";
import type { Locale } from "./locales";

/**
 * Targeted, safe corrections for what visual QA found.
 *
 * Two rules govern everything here, and they are the reason this is a separate
 * module from the audit:
 *
 *  1. A correction may only change *design* decisions — a scale, a spacing
 *     step, a measure, a crop, whether an empty section renders. It may never
 *     write, shorten, translate or invent a word of the business's content. A
 *     headline that does not fit is a type problem before it is a copy
 *     problem, and the person who wrote the headline is the only one allowed
 *     to change it.
 *
 *  2. It is bounded. Two passes, no more. A correction loop that keeps going
 *     until everything is green ends up chasing its own tail — shrinking type
 *     to fix an overflow, then raising it to fix the hierarchy it just broke.
 *     Anything still failing after two passes is reported to the creator with
 *     the specific thing to do, which is more honest than a page quietly
 *     nudged out of shape.
 *
 * Nothing here calls a model. The design critic keeps its own separate,
 * controlled hosted pass; this is arithmetic against the same CSS the audit
 * evaluates.
 */

export const MAX_PASSES = 2;

/** What was changed, in the creator's language. */
export type QaCorrection = {
  id: string;
  what: string;
};

export type QaOutcome = {
  site: Site;
  /** The audit as it stands after the corrections. */
  report: QaReport;
  /** The audit before anything was corrected, for the record. */
  before: QaReport;
  applied: QaCorrection[];
  passes: number;
  /** Issues that survived, i.e. the ones the creator has to decide about. */
  remaining: QaIssue[];
};

type Fixer = (site: Site, issue: QaIssue, locale: Locale) => { site: Site; what: string } | null;

const withTokens = (site: Site, tokens: DesignTokens): Site => ({
  ...site,
  theme: { ...site.theme, tokens },
});

const round2 = (n: number) => Number(n.toFixed(2));

/* -------------------------------------------------------------------------
   The individual corrections
------------------------------------------------------------------------- */

/**
 * A heading that does not fit is fixed by making the type smaller — never by
 * making the words shorter. The factor is computed from the actual overflow at
 * the width it happens, so one pass is normally enough.
 */
const shrinkHeading: Fixer = (site, _issue, locale) => {
  const tokens = site.theme.tokens;
  if (!tokens) return null;

  const hero = site.sections.find((s) => s.visible && s.type === "hero");
  const headline = hero
    ? t(site, locale, key.section(hero.id, "headline")) || site.meta.businessName
    : site.meta.businessName;
  const run = longestRunEm(headline, tokens);
  if (!run) return null;

  // Find the tightest requirement across every viewport, not just the one the
  // issue named: fixing 320px while leaving 390px broken is not a fix.
  let factor = 1;
  for (const width of [1440, 834, 390, 320]) {
    const available = contentWidth(site, width);
    const current = headingPx(site, width, 1);
    // 2% of the width kept back: a heading that fits to the last pixel is one
    // font-substitution away from not fitting.
    const needed = (available * 0.98) / run;
    if (current > needed) factor = Math.min(factor, needed / current);
  }
  if (factor >= 0.995) return null;

  // 0.72 is the floor: below that the hero stops being a hero, and a page that
  // needs it is telling us the headline itself is the problem. Rounded *down*
  // to two places — rounding up would land a hair over the width it was just
  // computed to fit inside.
  const scale = Math.max(0.72, Math.floor(tokens.type.scale * factor * 100) / 100);
  if (scale >= tokens.type.scale) return null;

  return {
    site: withTokens(site, { ...tokens, type: { ...tokens.type, scale } }),
    what: `reduced the heading scale to ${scale} so the headline fits at 320px`,
  };
};

/** Section headings that barely clear body text get the scale back. */
const strengthenHeadings: Fixer = (site) => {
  const tokens = site.theme.tokens;
  if (!tokens) return null;
  const scale = round2(Math.min(1.35, tokens.type.scale * 1.12));
  if (scale <= tokens.type.scale) return null;
  return {
    site: withTokens(site, { ...tokens, type: { ...tokens.type, scale } }),
    what: `raised the heading scale to ${scale} so section headings separate from body text`,
  };
};

const narrowMeasure: Fixer = (site) => {
  const tokens = site.theme.tokens;
  if (!tokens) return null;
  const measure = Math.max(52, Math.floor(contentWidth(site, 1440) / 8));
  if (measure >= tokens.type.measure) return null;
  return {
    site: withTokens(site, { ...tokens, type: { ...tokens.type, measure } }),
    what: `set the text measure to ${measure}ch so lines stop running the full width`,
  };
};

const widenMeasure: Fixer = (site) => {
  const tokens = site.theme.tokens;
  if (!tokens) return null;
  const measure = Math.min(78, tokens.type.measure + 8);
  if (measure <= tokens.type.measure) return null;
  return {
    site: withTokens(site, { ...tokens, type: { ...tokens.type, measure } }),
    what: `widened the text measure to ${measure}ch`,
  };
};

const tightenRhythm: Fixer = (site) => {
  const tokens = site.theme.tokens;
  if (!tokens) return null;
  const section = round2(Math.max(3.5, tokens.space.section * 0.75));
  if (section >= tokens.space.section) return null;
  return {
    site: withTokens(site, { ...tokens, space: { ...tokens.space, section } }),
    what: `tightened section spacing to ${section}rem for a short page`,
  };
};

/**
 * A photograph that cannot lead the page stops leading it.
 *
 * The picture is not deleted and nothing is generated to replace it: it moves
 * into the gallery, where its shape is an asset rather than a problem, and the
 * hero becomes typographic — which is a real design, not a fallback.
 */
const demoteHeroImage: Fixer = (site) => {
  const placements = site.images ?? [];
  const hero = placements.find((p) => p.role === "hero");
  if (!hero) return null;

  const gallery = site.sections.find((s) => s.type === "gallery");
  const images = placements.map((p) =>
    p.assetId === hero.assetId
      ? { ...p, role: gallery ? ("gallery" as const) : ("section" as const), priority: false }
      : p,
  );

  const sections = site.sections.map((s) => {
    if (s.type === "hero") return { ...s, imageId: "", layout: "typographic" as const };
    if (s.type === "gallery" && gallery) {
      const ids = s.imageIds.includes(hero.assetId) ? s.imageIds : [...s.imageIds, hero.assetId];
      return { ...s, imageIds: ids, visible: ids.length > 0 };
    }
    if (s.type === "about" && !gallery && !s.imageId) return { ...s, imageId: hero.assetId };
    return s;
  });

  return {
    site: { ...site, sections, images },
    what: gallery
      ? "moved the hero photograph into the gallery and made the hero typographic"
      : "moved the hero photograph beside the about copy and made the hero typographic",
  };
};

/** Only the picture at the top of the page is worth blocking on. */
const singlePriorityImage: Fixer = (site) => {
  const placements = site.images ?? [];
  if (placements.filter((p) => p.priority).length <= 1) return null;
  let kept = false;
  const images = placements.map((p) => {
    if (p.priority && !kept && p.role === "hero") {
      kept = true;
      return p;
    }
    return p.priority ? { ...p, priority: false } : p;
  });
  return {
    site: { ...site, images },
    what: "left the loading priority on the hero photograph only",
  };
};

/** An empty section is switched off, never filled with invented content. */
const hideEmptySection: Fixer = (site, issue) => {
  const id = issue.location.match(/\(([^)]+)\)/)?.[1];
  if (!id) return null;
  const target = site.sections.find((s) => s.id === id);
  if (!target || !target.visible) return null;
  return {
    site: {
      ...site,
      sections: site.sections.map((s) => (s.id === id ? { ...s, visible: false } : s)),
    },
    what: `switched off the empty ${target.type} section until there is content for it`,
  };
};

/** Readability wins over the palette, every time. */
const repairBodyContrast: Fixer = (site) => {
  const { text, bg } = site.theme.colors;
  const fixed = ensureContrast(text, bg, 4.5);
  if (fixed.toLowerCase() === text.toLowerCase()) return null;
  if (contrastRatio(fixed, bg) < 4.5) return null;
  return {
    site: { ...site, theme: { ...site.theme, colors: { ...site.theme.colors, text: fixed } } },
    what: `darkened the body text to ${fixed} to clear 4.5:1`,
  };
};

/**
 * Which issues have a safe correction.
 *
 * Everything absent from this table is deliberate: long button labels,
 * placeholder copy, dead links, missing alt text and a thin menu are all
 * content the creator owns, and a page that silently rewrote them would be
 * lying about what it contains.
 */
const FIXERS: Record<string, Fixer> = {
  "heading-overflow": shrinkHeading,
  "weak-hierarchy": strengthenHeadings,
  "measure-too-wide": narrowMeasure,
  "measure-too-narrow": widenMeasure,
  "excess-whitespace": tightenRhythm,
  "hero-image-portrait": demoteHeroImage,
  "hero-image-small": demoteHeroImage,
  "image-priority": singlePriorityImage,
  "empty-section": hideEmptySection,
  "contrast-body": repairBodyContrast,
};

export function isCorrectable(id: string): boolean {
  return id in FIXERS;
}

/* -------------------------------------------------------------------------
   The bounded loop
------------------------------------------------------------------------- */

/**
 * Audit, correct, re-audit — at most `MAX_PASSES` times.
 *
 * A pass that changes nothing stops the loop immediately, and a pass that
 * makes the score worse is thrown away: the previous document is kept and the
 * remaining issues are reported instead. That is the safety property that
 * matters, because a correction that fixes one viewport by breaking another is
 * indistinguishable from a bug at the point where it happens.
 */
export function correctSite(
  input: { site: Site; locale: Locale; images?: Record<string, { width: number; height: number; bytes: number }> },
  maxPasses = MAX_PASSES,
): QaOutcome {
  const audit = (site: Site) => auditSite({ site, locale: input.locale, images: input.images });

  const before = audit(input.site);
  let site = input.site;
  let report = before;
  const applied: QaCorrection[] = [];
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const fixable = report.issues.filter((i) => isCorrectable(i.id));
    if (!fixable.length) break;

    let next = site;
    const passApplied: QaCorrection[] = [];
    const done = new Set<string>();

    for (const issue of fixable) {
      // One correction per kind per pass: applying `shrinkHeading` twice in a
      // row for four viewport-specific issues would compound the reduction.
      if (done.has(issue.id)) continue;
      const result = FIXERS[issue.id](next, issue, input.locale);
      if (!result) continue;
      next = result.site;
      done.add(issue.id);
      passApplied.push({ id: issue.id, what: result.what });
    }

    if (!passApplied.length) break;

    const nextReport = audit(next);
    passes += 1;
    if (nextReport.score < report.score) {
      // Worse than where we started. Keep the document we had.
      break;
    }
    site = next;
    report = nextReport;
    applied.push(...passApplied);
  }

  return {
    site,
    report,
    before,
    applied,
    passes,
    remaining: report.issues,
  };
}

/** The lines the progress screen and the report show. */
export function summariseOutcome(outcome: QaOutcome): string[] {
  const lines = outcome.applied.map((c) => `Fixed: ${c.what}`);
  for (const issue of outcome.remaining.filter((i) => i.level === "error").slice(0, 5)) {
    lines.push(`Needs you: ${issue.issue} ${issue.correction}`);
  }
  return lines;
}
