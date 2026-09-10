import "server-only";
import { designScore, reviewDesign, type Finding } from "@/lib/heuristics";
import type { Section, SectionLayout, Site } from "@/lib/site";
import type { DesignSignals } from "@/lib/tokens";
import { describeError, generateText, hasApiKey } from "./gemini";

/**
 * The design critic.
 *
 * Everything upstream of this is deterministic: the catalogue chooses a
 * direction, the layout engine chooses compositions from real content, the
 * token engine executes them consistently. This is the one place where a
 * second opinion is worth asking for — whether the finished page still reads
 * as generated rather than designed is a judgement, and that is what a model
 * is actually good at.
 *
 * Three rules keep it a critic rather than a second designer:
 *
 *   It never writes the site. It answers with corrections chosen from a fixed
 *   vocabulary, and each one is applied here in code. The model cannot invent
 *   a section, rewrite copy, or return a document.
 *
 *   It is asked once, and only when there is something to ask about. The
 *   deterministic heuristics run first; if they find nothing meaningful, no
 *   request is made at all.
 *
 *   Its corrections are bounded. At most a handful, each one a change a
 *   designer would recognise, and the result is the same shape of document it
 *   was given.
 */

/**
 * The corrections the critic may ask for.
 *
 * A closed vocabulary is what makes this safe: an answer outside this list is
 * discarded rather than interpreted, so no model output ever reaches the
 * document unchecked.
 */
export const CORRECTIONS = [
  "vary-section-composition",
  "reduce-card-usage",
  "reduce-rounding",
  "reduce-motion",
  "tighten-spacing",
  "open-spacing",
  "strengthen-hierarchy",
  "image-led-hero",
  "typographic-hero",
  "remove-filler-section",
  "flatten-elevation",
] as const;

export type CorrectionId = (typeof CORRECTIONS)[number];

export type Critique = {
  /** What the model was asked about, for the record. */
  findings: Finding[];
  /** Corrections it asked for, filtered to the known vocabulary. */
  applied: CorrectionId[];
  /** Whether a model was consulted at all. */
  consulted: boolean;
  /** One line per applied change, shown to the creator. */
  notes: string[];
};

/**
 * Below this the page has nothing worth a second opinion, and the critic does
 * nothing. Deliberately generous: a page with one low-severity finding is not
 * worth a network round trip.
 */
const ASK_BELOW_SCORE = 90;

const SYSTEM = `You are a senior art director reviewing one finished website.

You are NOT redesigning it. You are deciding which of a fixed list of corrections would most improve it, and saying nothing when it is already good.

Judge whether the design reads as intentional for THIS business, not whether it follows a rule. Large whitespace is right for a luxury hotel and wrong for a busy menu. Heavy type is right for a gym and wrong for a law firm. Cards are right for genuinely comparable items and wrong for prose.

Look for the marks of a generated page:
- the same composition repeated in every section
- card grids used for things that are not comparable items
- everything rounded, everything shadowed, everything animated
- a centred hero with two buttons where the business has real photography
- headings and calls to action that could belong to any business
- sections that exist because a template has them, not because there is content
- spacing that never varies, so nothing has more weight than anything else

Choose ONLY from these correction ids:
vary-section-composition, reduce-card-usage, reduce-rounding, reduce-motion, tighten-spacing, open-spacing, strengthen-hierarchy, image-led-hero, typographic-hero, remove-filler-section, flatten-elevation

Rules:
- At most 3 corrections. Fewer is better. An empty list is the right answer for a design that already works.
- Only ask for a correction that makes a real difference to how the page reads.
- Never ask for a change merely to make the site different.
- Give one short reason per correction, naming what you saw.

Output ONLY JSON.`;

/** A compact, factual description of the page — never the copy itself. */
function describeSite(site: Site, signals: DesignSignals | null): string {
  const tokens = site.theme.tokens;
  const strings = site.i18n[site.meta.defaultLocale]?.strings ?? {};
  const sections = site.sections
    .filter((s) => s.visible)
    .map((s) => {
      const bits: string[] = [`${s.type}`];
      if (s.layout) bits.push(`layout=${s.layout}`);
      switch (s.type) {
        case "services":
          bits.push(`items=${s.items.length}`);
          break;
        case "testimonials":
          bits.push(`quotes=${s.items.length}`);
          break;
        case "gallery":
          bits.push(`images=${s.imageIds.length}`);
          break;
        case "menu":
          bits.push(`categories=${s.categories.length}`);
          break;
        case "about":
          bits.push(`highlights=${s.highlights.length}`, s.imageId ? "image=yes" : "image=no");
          break;
        case "hero":
          bits.push(s.imageId ? "image=yes" : "image=no");
          break;
        default:
          break;
      }
      const heading = strings[`${s.id}.heading`] ?? strings[`${s.id}.headline`] ?? "";
      const cta = strings[`${s.id}.ctaLabel`] ?? "";
      if (heading) bits.push(`heading="${heading.slice(0, 60)}"`);
      if (cta) bits.push(`cta="${cta.slice(0, 40)}"`);
      return `- ${bits.join(" ")}`;
    })
    .join("\n");

  const design = tokens
    ? [
        `architecture=${site.theme.architecture}`,
        `density=${tokens.density}`,
        `sectionSpacing=${tokens.space.section}rem`,
        `measure=${tokens.type.measure}ch`,
        `headingScale=${tokens.type.scale} weight=${tokens.type.headingWeight}`,
        `cardSurface=${tokens.surface.card} cardRadius=${tokens.shape.card}px`,
        `buttonShape=${tokens.shape.buttonShape} shadow=${tokens.shape.shadow}`,
        `motion=${tokens.motion} banding=${tokens.surface.banding}`,
      ].join("\n")
    : `architecture=${site.theme.architecture}`;

  const business = signals
    ? `formality=${signals.formality} energy=${signals.energy} information=${signals.informationDensity} visual=${signals.visualWeight} warmth=${signals.warmth}`
    : "not analysed";

  return `Business: ${site.meta.businessName} (${site.meta.kind})
Business character (0-1): ${business}

Design system:
${design}

Sections in order:
${sections}`;
}

/**
 * Run the critic.
 *
 * Returns the corrections that were actually applied and the site with them
 * applied. When the heuristics are content, or no key is configured, this is a
 * no-op that costs nothing.
 */
export async function critique(
  site: Site,
  signals: DesignSignals | null,
): Promise<{ site: Site; critique: Critique }> {
  const findings = reviewDesign(site, signals ? { signals } : {});
  const score = designScore(findings);

  // Deterministic first: anything the rules can see is already fixed by the
  // corrections below, whether or not a model is available.
  const fromRules = correctionsFromFindings(findings);

  if (score >= ASK_BELOW_SCORE || !hasApiKey()) {
    const applied = applyCorrections(site, fromRules, findings);
    return {
      site: applied.site,
      critique: { findings, applied: applied.applied, consulted: false, notes: applied.notes },
    };
  }

  let asked: CorrectionId[] = [];
  const notes: string[] = [];
  try {
    const { text, refused } = await generateText({
      system: SYSTEM,
      maxOutputTokens: 2000,
      content: `${describeSite(site, signals)}

What the automated review already flagged:
${findings.map((f) => `- ${f.issue}`).join("\n") || "- nothing"}

Output ONLY: {"corrections":[{"id":"","reason":""}]}`,
    });
    if (!refused) {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1)) as {
          corrections?: { id?: string; reason?: string }[];
        };
        for (const c of (parsed.corrections ?? []).slice(0, 3)) {
          // Anything outside the vocabulary is discarded, not interpreted.
          if (!CORRECTIONS.includes(c.id as CorrectionId)) continue;
          asked.push(c.id as CorrectionId);
          if (c.reason) notes.push(`${c.id}: ${String(c.reason).slice(0, 160)}`);
        }
      }
    }
  } catch (err) {
    // A critic that cannot be reached is not a failed generation: the
    // deterministic corrections still apply.
    console.error("[critic] review failed:", describeError(err));
  }

  const merged = [...new Set([...fromRules, ...asked])].slice(0, 4);
  const applied = applyCorrections(site, merged, findings);
  return {
    site: applied.site,
    critique: {
      findings,
      applied: applied.applied,
      consulted: true,
      notes: [...notes, ...applied.notes],
    },
  };
}

/* -------------------------------------------------------------------------
   Corrections. Every one of these is code, not model output.
------------------------------------------------------------------------- */

/** What the rules alone would change, with no model involved. */
export function correctionsFromFindings(findings: Finding[]): CorrectionId[] {
  const map: Record<string, CorrectionId> = {
    "card-repetition": "vary-section-composition",
    "card-dominance": "reduce-card-usage",
    "uniform-structure": "vary-section-composition",
    "over-rounded": "reduce-rounding",
    "over-animation": "reduce-motion",
    "unearned-whitespace": "tighten-spacing",
    cramped: "open-spacing",
    "flat-hierarchy": "strengthen-hierarchy",
    "filler-cta": "remove-filler-section",
    "empty-sections": "remove-filler-section",
    "unearned-elevation": "flatten-elevation",
  };
  const out: CorrectionId[] = [];
  for (const f of findings) {
    const id = map[f.id];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The alternative composition for a section that is currently a card grid. */
function alternativeFor(section: Section): SectionLayout {
  switch (section.type) {
    case "services":
      return section.items.length >= 5 ? "index" : section.items.length <= 2 ? "statement" : "list";
    case "testimonials":
      return section.items.length <= 1 ? "statement" : "list";
    case "about":
      return "editorial";
    default:
      return "list";
  }
}

export function applyCorrections(
  site: Site,
  corrections: CorrectionId[],
  findings: Finding[] = [],
): { site: Site; applied: CorrectionId[]; notes: string[] } {
  let next: Site = { ...site, sections: site.sections.map((s) => ({ ...s })) };
  const applied: CorrectionId[] = [];
  const notes: string[] = [];
  const tokens = next.theme.tokens;

  for (const correction of corrections) {
    switch (correction) {
      case "vary-section-composition":
      case "reduce-card-usage": {
        // Keep the first card grid — comparable items genuinely scan well as
        // cards — and recompose the rest. This is the single change that most
        // reliably stops a page reading as a template.
        const carded = next.sections.filter((s) => s.visible && (s.layout ?? "cards") === "cards" && s.type !== "hero");
        if (carded.length < 2) break;
        for (const section of carded.slice(1)) {
          section.layout = alternativeFor(section);
        }
        applied.push(correction);
        notes.push(
          `Recomposed ${carded.length - 1} section${carded.length - 1 === 1 ? "" : "s"} away from the card grid.`,
        );
        break;
      }

      case "reduce-rounding": {
        if (!tokens) break;
        next.theme = {
          ...next.theme,
          tokens: {
            ...tokens,
            shape: {
              ...tokens.shape,
              card: Math.min(tokens.shape.card, 4),
              image: Math.min(tokens.shape.image, 4),
              input: Math.min(tokens.shape.input, 6),
            },
          },
        };
        applied.push(correction);
        notes.push("Reduced the card and image radius; the rounded treatment stays on buttons only.");
        break;
      }

      case "reduce-motion": {
        if (!tokens || tokens.motion === "none") break;
        next.theme = {
          ...next.theme,
          tokens: { ...tokens, motion: tokens.motion === "expressive" ? "subtle" : "none" },
        };
        applied.push(correction);
        notes.push("Reduced the motion budget.");
        break;
      }

      case "flatten-elevation": {
        if (!tokens || tokens.shape.shadow === "none") break;
        next.theme = {
          ...next.theme,
          tokens: { ...tokens, shape: { ...tokens.shape, shadow: "hairline" } },
        };
        applied.push(correction);
        notes.push("Replaced raised shadows with a hairline edge.");
        break;
      }

      case "tighten-spacing":
      case "open-spacing": {
        if (!tokens) break;
        const factor = correction === "tighten-spacing" ? 0.8 : 1.25;
        const section = Number((tokens.space.section * factor).toFixed(2));
        next.theme = {
          ...next.theme,
          tokens: {
            ...tokens,
            space: {
              ...tokens.space,
              section: Math.min(7, Math.max(2.4, section)),
              gap: Number(Math.min(2, Math.max(0.75, tokens.space.gap * factor)).toFixed(2)),
            },
          },
        };
        applied.push(correction);
        notes.push(correction === "tighten-spacing" ? "Tightened section spacing." : "Opened section spacing.");
        break;
      }

      case "strengthen-hierarchy": {
        if (!tokens) break;
        next.theme = {
          ...next.theme,
          tokens: {
            ...tokens,
            type: {
              ...tokens.type,
              scale: Number(Math.min(1.45, tokens.type.scale * 1.12).toFixed(2)),
              ratio: Number(Math.min(1.36, tokens.type.ratio * 1.06).toFixed(3)),
            },
          },
        };
        applied.push(correction);
        notes.push("Raised the heading scale so the hierarchy is legible at a glance.");
        break;
      }

      case "image-led-hero": {
        const hero = next.sections.find((s) => s.type === "hero");
        // Only where there is a photograph to lead with. Asking for an
        // image-led hero on a site with no images would be a worse design.
        if (!hero || hero.type !== "hero" || !hero.imageId) break;
        hero.layout = "image-led";
        applied.push(correction);
        notes.push("Rebuilt the hero around its photograph rather than centring the copy.");
        break;
      }

      case "typographic-hero": {
        const hero = next.sections.find((s) => s.type === "hero");
        if (!hero) break;
        hero.layout = "typographic";
        applied.push(correction);
        notes.push("Set the hero typographically.");
        break;
      }

      case "remove-filler-section": {
        // Only sections the rules already identified as empty or filler, so
        // nothing with real content can be removed by a critique.
        const ids = new Set(
          findings
            .filter((f) => f.id === "filler-cta" || f.id === "empty-sections")
            .flatMap((f) => f.sections ?? []),
        );
        if (!ids.size) break;
        let removed = 0;
        for (const section of next.sections) {
          if (ids.has(section.id) && section.visible) {
            section.visible = false;
            removed++;
          }
        }
        if (!removed) break;
        applied.push(correction);
        notes.push(`Switched off ${removed} section${removed === 1 ? "" : "s"} with nothing to show.`);
        break;
      }
    }
  }

  return { site: next, applied, notes };
}
