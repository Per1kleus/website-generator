import { architecture } from "./architectures";
import type { DesignTokens, Section, Site } from "./site";
import { tokensForArchitecture } from "./tokens";

/**
 * Human design heuristics.
 *
 * A set of deterministic checks against the patterns that make a website look
 * generated rather than designed: the same three-card grid in every section,
 * everything rounded, everything centred, everything fading in, a call-to-action
 * band that says "Get started today", spacing that never varies.
 *
 * The question each check asks is **not** "is this technique allowed?" — every
 * technique here is right somewhere. It is "is this choice intentional for
 * *this* website?". Large whitespace is intentional for a luxury hotel and
 * arbitrary for a busy taverna menu; heavy motion is intentional for a gym and
 * wrong for a law firm. So each finding carries the design context that would
 * excuse it, and is only raised when that context is absent.
 *
 * No AI. No network. These are rules, and they run in microseconds.
 */

export type FindingSeverity = "high" | "medium" | "low";

export type Finding = {
  /** Stable id, so a correction can be attached to it. */
  id: string;
  severity: FindingSeverity;
  /** What is wrong, in one sentence a designer would recognise. */
  issue: string;
  /** What to do about it — specific, not "add more contrast". */
  correction: string;
  /** Section ids involved, when the finding is about particular sections. */
  sections?: string[];
};

export type ReviewContext = {
  /** Everything known about the business, for judging intent. */
  signals?: {
    formality: number;
    energy: number;
    informationDensity: number;
    visualWeight: number;
    warmth: number;
  };
};

const CARD_LAYOUTS = new Set(["cards"]);

/** The layout each section is actually rendered with. */
function layoutOf(section: Section): string {
  if (section.layout) return section.layout;
  // Defaults, matching the renderer's own fallbacks.
  switch (section.type) {
    case "services":
    case "testimonials":
      return "cards";
    case "gallery":
      return "grid";
    case "hero":
      return "editorial-hero";
    default:
      return "list";
  }
}

function visibleBody(site: Site): Section[] {
  return site.sections.filter(
    (s) => s.visible && s.type !== "footer" && s.type !== "hero",
  );
}

function tokensOf(site: Site): DesignTokens {
  return site.theme.tokens ?? tokensForArchitecture(site.theme.architecture, site.meta.kind);
}

/** Generic call-to-action language, the kind every generated page shares. */
const GENERIC_CTA =
  /^(get started|learn more|contact us today|book now|find out more|discover more|read more|get in touch today|sign up now|click here)\.?$/i;

const GENERIC_HEADING =
  /^(our services|what we offer|why choose us|our story|about us|testimonials|what our clients say|get in touch|ready to get started)\.?$/i;

/**
 * Review a finished document.
 *
 * Returns findings ordered by how much they matter. An empty array means the
 * page reads as designed — and in that case nothing downstream should touch it.
 */
export function reviewDesign(site: Site, ctx: ReviewContext = {}): Finding[] {
  const findings: Finding[] = [];
  const s = ctx.signals;
  const tokens = tokensOf(site);
  const arch = architecture(site.theme.architecture);
  const body = visibleBody(site);
  const strings = site.i18n[site.meta.defaultLocale]?.strings ?? {};

  /* ---- Repeated composition ------------------------------------------- */

  const layouts = body.map(layoutOf);
  const cardSections = body.filter((sec) => CARD_LAYOUTS.has(layoutOf(sec)));

  if (cardSections.length >= 3) {
    findings.push({
      id: "card-repetition",
      severity: "high",
      issue: `${cardSections.length} sections are built from the same card grid, so the page has one silhouette repeated down its length.`,
      correction:
        "Give at least two of them a different composition — a ruled list, an editorial column or a numbered index — and keep cards for the one set of genuinely comparable items.",
      sections: cardSections.map((sec) => sec.id),
    });
  } else if (cardSections.length === 2 && body.length <= 3) {
    findings.push({
      id: "card-dominance",
      severity: "medium",
      issue: "Almost every section on a short page is a card grid.",
      correction: "Convert the less scannable of the two into a vertical editorial layout.",
      sections: cardSections.map((sec) => sec.id),
    });
  }

  // Every section composed identically, whatever that composition is.
  const distinct = new Set(layouts);
  if (body.length >= 3 && distinct.size === 1) {
    findings.push({
      id: "uniform-structure",
      severity: "high",
      issue: `All ${body.length} sections use the same structure, so nothing on the page has more weight than anything else.`,
      correction:
        "Vary the composition by role: the most important section should not be shaped like the least important one.",
      sections: body.map((sec) => sec.id),
    });
  }

  /* ---- The template silhouette ---------------------------------------- */

  const shape = body.map((sec) => sec.type).join(">");
  if (/services>testimonials>cta/.test(shape) && cardSections.length >= 2) {
    findings.push({
      id: "template-silhouette",
      severity: "medium",
      issue:
        "The page follows the hero → feature cards → testimonials → call-to-action shape that most generated sites share.",
      correction:
        "Reorder around what this business leads with, and drop whichever of those sections has the least real content behind it.",
    });
  }

  /* ---- Shape ----------------------------------------------------------- */

  // Rounded everything. Legitimate for a friendly, informal brand; arbitrary
  // for a formal one, and always arbitrary when every role shares one radius.
  const radii = [tokens.shape.card, tokens.shape.image, tokens.shape.input];
  const allRound = radii.every((r) => r >= 12);
  if (allRound && (s?.formality ?? 0.5) > 0.6) {
    findings.push({
      id: "over-rounded",
      severity: "medium",
      issue:
        "Cards, images and inputs all carry a large radius, which reads soft and generic against this business's formality.",
      correction:
        "Reduce the card and image radius toward square and reserve the rounded treatment for buttons only.",
    });
  }

  // Shadows on everything, with no depth story.
  if (tokens.shape.shadow === "lifted" && (s?.energy ?? 0.5) < 0.55) {
    findings.push({
      id: "unearned-elevation",
      severity: "low",
      issue: "Raised shadows are used throughout without a layered interface to justify them.",
      correction: "Drop to a hairline border, or no shadow, and let spacing carry the separation.",
    });
  }

  /* ---- Motion ---------------------------------------------------------- */

  if (tokens.motion === "expressive" && (s?.energy ?? 0.5) < 0.6) {
    findings.push({
      id: "over-animation",
      severity: "medium",
      issue:
        "Everything animates, which reads as decoration rather than as a response to what the visitor did.",
      correction:
        "Reduce motion to subtle and keep it for state changes — a page that fades in every section is slower, not richer.",
    });
  }

  /* ---- Rhythm ---------------------------------------------------------- */

  // Whitespace that serves nothing: a very airy page with a lot to read.
  if (tokens.space.section > 5.5 && (s?.informationDensity ?? 0.5) > 0.65) {
    findings.push({
      id: "unearned-whitespace",
      severity: "medium",
      issue:
        "Sections are spaced very generously on a page that has a lot to read, so the content is pushed apart rather than organised.",
      correction: "Tighten section spacing and use rules or a change of background to separate ideas instead.",
    });
  }

  // The opposite: a spare page crammed together.
  if (tokens.space.section < 3.2 && (s?.informationDensity ?? 0.5) < 0.4) {
    findings.push({
      id: "cramped",
      severity: "low",
      issue: "A page with little content is set tightly, which makes it look thin rather than considered.",
      correction: "Open the section spacing so the few things on the page carry weight.",
    });
  }

  /* ---- Language -------------------------------------------------------- */

  const ctaLabels: { id: string; text: string }[] = [];
  const headings: { id: string; text: string }[] = [];
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (/\.ctaLabel$/.test(key)) ctaLabels.push({ id: key, text: value.trim() });
    if (/\.(heading|headline)$/.test(key)) headings.push({ id: key, text: value.trim() });
  }

  const genericCtas = ctaLabels.filter((c) => GENERIC_CTA.test(c.text));
  if (genericCtas.length) {
    findings.push({
      id: "generic-cta",
      severity: "medium",
      issue: `The call${genericCtas.length > 1 ? "s" : ""} to action read as boilerplate: ${genericCtas
        .map((c) => `"${c.text}"`)
        .join(", ")}.`,
      correction:
        "Say what actually happens next in this business's own words — booking a table, requesting a quote, calling the workshop.",
    });
  }

  const genericHeadings = headings.filter((h) => GENERIC_HEADING.test(h.text));
  if (genericHeadings.length >= 2) {
    findings.push({
      id: "generic-headings",
      severity: "low",
      issue: `${genericHeadings.length} section headings are the stock ones ("${genericHeadings[0].text}", "${genericHeadings[1].text}").`,
      correction: "Replace them with headings that could only belong to this business.",
    });
  }

  /* ---- Sections that are not earning their place ----------------------- */

  const cta = body.find((sec) => sec.type === "cta");
  if (cta && body.length <= 3) {
    findings.push({
      id: "filler-cta",
      severity: "low",
      issue: "A short page still carries a separate call-to-action band on top of its contact section.",
      correction: "Remove the band and let the contact section carry the invitation.",
      sections: [cta.id],
    });
  }

  const empty = site.sections.filter(
    (sec) =>
      sec.visible &&
      ((sec.type === "gallery" && sec.imageIds.length === 0) ||
        (sec.type === "testimonials" && sec.items.length === 0) ||
        (sec.type === "services" && sec.items.length === 0) ||
        (sec.type === "hours" && sec.rows.length === 0)),
  );
  if (empty.length) {
    findings.push({
      id: "empty-sections",
      severity: "high",
      issue: `${empty.length} section${empty.length > 1 ? "s are" : " is"} visible with nothing in ${
        empty.length > 1 ? "them" : "it"
      }.`,
      correction: "Switch them off until there is real content for them.",
      sections: empty.map((sec) => sec.id),
    });
  }

  /* ---- Hierarchy ------------------------------------------------------- */

  // A type scale that barely separates a heading from body text leaves the
  // page flat, whatever else is right about it.
  if (tokens.type.scale < 0.95 && tokens.type.ratio < 1.2) {
    findings.push({
      id: "flat-hierarchy",
      severity: "medium",
      issue: "Headings are barely larger than body text, so the page has no visible hierarchy.",
      correction: "Raise the heading scale, or the step between levels, until the structure is legible at a glance.",
    });
  }

  // The architecture asked for one thing and the tokens do another — the
  // clearest sign the design system is not internally consistent.
  if (arch.buttonShape !== tokens.shape.buttonShape) {
    findings.push({
      id: "token-drift",
      severity: "low",
      issue: "Button shape does not match the chosen architecture, so the design system is inconsistent with itself.",
      correction: "Bring the button tokens back in line with the architecture.",
    });
  }

  const order: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * One number for "how designed does this look", 0–100.
 *
 * Used only to decide whether a second opinion is worth asking for; it is not
 * shown as a score anywhere, because a number would invite optimising for it.
 */
export function designScore(findings: Finding[]): number {
  const cost = { high: 22, medium: 11, low: 4 };
  return Math.max(0, 100 - findings.reduce((sum, f) => sum + cost[f.severity], 0));
}
