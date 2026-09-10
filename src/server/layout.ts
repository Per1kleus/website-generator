import "server-only";
import { architecture } from "@/lib/architectures";
import { deriveTokens, readSignals, type DesignSignals } from "@/lib/tokens";
import type { Section, SectionLayout, Site } from "@/lib/site";
import type { BusinessProfile } from "./research";
import type { VisualIdentity } from "./identity";
import type { SkillDesign } from "./uiux";

/**
 * The content-aware layout engine.
 *
 * Most generated websites look alike because the layout is decided before
 * anyone knows what the business has: every site gets a hero, three cards, a
 * gallery and a testimonial row whether or not there are three services, any
 * photographs or a single review. This module decides afterwards, from the
 * document that was actually assembled and the research that produced it.
 *
 * It is deterministic and makes no model calls of its own. The understanding
 * it works from — the research profile and the identity analysis — was already
 * produced upstream; this turns that understanding into structure.
 *
 * The rule it never breaks: a section that has nothing real to show is
 * switched off, not filled. Inventing three services so the grid looks right
 * is exactly the failure the research rules exist to prevent.
 */

/** What this business actually has, counted from the assembled document. */
export type ContentProfile = {
  services: number;
  menuItems: number;
  menuCategories: number;
  images: number;
  testimonials: number;
  highlights: number;
  hours: number;
  /** Words of real prose, which decides whether a page needs chapters. */
  words: number;
  hasContact: boolean;
  hasLocation: boolean;
  /** Set when the research verified something, so trust can be shown. */
  verifiedFacts: number;
};

export function contentProfile(
  site: Site,
  profile: BusinessProfile,
  extraImages = 0,
): ContentProfile {
  let services = 0;
  let menuItems = 0;
  let menuCategories = 0;
  let images = extraImages;
  let testimonials = 0;
  let highlights = 0;
  let hours = 0;
  let words = 0;
  let hasContact = false;

  const strings = site.i18n[site.meta.defaultLocale]?.strings ?? {};
  for (const value of Object.values(strings)) {
    if (typeof value === "string" && value.length > 40) {
      words += value.split(/\s+/).length;
    }
  }

  for (const section of site.sections) {
    if (!section.visible) continue;
    switch (section.type) {
      case "services":
        services += section.items.length;
        break;
      case "menu":
        menuCategories += section.categories.length;
        for (const category of section.categories) {
          menuItems += category.items.length;
          images += category.items.filter((i) => i.imageId).length;
        }
        break;
      case "gallery":
        images += section.imageIds.length;
        break;
      case "testimonials":
        testimonials += section.items.length;
        break;
      case "about":
        highlights += section.highlights.length;
        if (section.imageId) images += 1;
        break;
      case "hero":
        if (section.imageId) images += 1;
        break;
      case "hours":
        hours += section.rows.length;
        break;
      case "contact":
        hasContact = Boolean(section.phone || section.email || section.mapsUrl);
        break;
      default:
        break;
    }
  }

  return {
    services,
    menuItems,
    menuCategories,
    images,
    testimonials,
    highlights,
    hours,
    words,
    hasContact,
    hasLocation: Boolean(profile.address || profile.location),
    verifiedFacts: profile.verifiedFields.length,
  };
}

/**
 * Everything the design decisions are made from, in one place so the same
 * inputs always produce the same design.
 */
export type LayoutContext = {
  site: Site;
  profile: BusinessProfile;
  identity: VisualIdentity | null;
  skill: SkillDesign | null;
  businessType: string;
  description: string;
  /** Images uploaded to the project but not yet placed in a section. */
  libraryImages?: number;
};

export type LayoutPlan = {
  signals: DesignSignals;
  content: ContentProfile;
  /** The catalogue's style vocabulary, so its direction reaches the tokens. */
  styleKeywords: string;
  /** Per section id: how it should be composed. */
  layouts: Record<string, SectionLayout>;
  /** Section ids switched off because they have nothing to show. */
  hidden: string[];
  /** Short, readable reasons — shown to the creator, never invented. */
  notes: string[];
};

/**
 * The text the signals are read from.
 *
 * Deliberately the business's own vocabulary — what the creator typed, what
 * the research established, what the identity analysis saw in the place — and
 * *not* the catalogue's category names. The catalogue describes a design
 * family ("Bakery/Cafe", "Digital Signage"), and letting that vocabulary into
 * the personality signals made every business read as the same one. Its
 * keywords still reach the tokens, where they belong: they decide shape, not
 * character.
 */
function signalText(ctx: LayoutContext): string {
  const identity = ctx.identity;
  return [
    ctx.businessType,
    ctx.description,
    ctx.profile.category,
    ctx.profile.cuisineOrSpecialty,
    ctx.profile.positioning,
    ctx.profile.atmosphere,
    ctx.profile.priceRange,
    identity?.atmosphere,
    identity?.interiorStyle,
    identity?.typographyPersonality,
    identity?.brandPersonality?.join(" "),
    identity?.materials?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

/* -------------------------------------------------------------------------
   Choosing how each section is composed
------------------------------------------------------------------------- */

/**
 * Services.
 *
 * The card grid is the default everywhere on the web, which is exactly why it
 * reads as a template. It is right when there are several comparable things a
 * visitor will scan; it is wrong for two services, for a business whose
 * services are really one considered offer, and for anything that wants to be
 * read rather than scanned.
 */
function servicesLayout(count: number, s: DesignSignals): SectionLayout {
  if (count === 0) return "editorial";
  if (count <= 2) return "statement";
  if (s.formality > 0.7 && s.visualWeight < 0.5) return count >= 5 ? "index" : "list";
  if (s.informationDensity > 0.7) return "list";
  if (s.visualWeight > 0.7) return "split";
  if (s.warmth > 0.7) return "editorial";
  return "cards";
}

/** Testimonials. One review is a quote, not a grid of one. */
function testimonialsLayout(count: number, s: DesignSignals): SectionLayout {
  if (count <= 1) return "statement";
  if (s.formality > 0.7) return "list";
  if (s.energy > 0.7) return "band";
  return count >= 4 ? "cards" : "inline";
}

/** About. Prose in a box is the clearest sign nobody designed the page. */
function aboutLayout(content: ContentProfile, s: DesignSignals): SectionLayout {
  if (content.images > 0 && s.visualWeight > 0.55) return "split";
  if (s.informationDensity > 0.7) return "editorial";
  if (s.formality > 0.75) return "statement";
  return "editorial";
}

function galleryLayout(count: number, s: DesignSignals): SectionLayout {
  if (count <= 2) return "strip";
  if (s.visualWeight > 0.75) return "mosaic";
  return "grid";
}

/**
 * Hero.
 *
 * The centred hero with a headline, a subheadline and two buttons is the
 * single most recognisable AI-generated composition. It stays available —
 * some businesses genuinely want the poster — but it has to be earned.
 */
function heroLayout(content: ContentProfile, s: DesignSignals, archId: string): SectionLayout {
  const a = architecture(archId);
  if (content.images > 0 && s.visualWeight > 0.6) return "image-led";
  if (s.informationDensity > 0.7 && content.images === 0) return "editorial-hero";
  if (s.energy > 0.75) return "poster";
  if (a.hero === "typographic" || content.images === 0) return "typographic";
  return a.hero === "poster" ? "poster" : "editorial-hero";
}

/* -------------------------------------------------------------------------
   The plan
------------------------------------------------------------------------- */

export function planLayout(ctx: LayoutContext): LayoutPlan {
  const content = contentProfile(ctx.site, ctx.profile, ctx.libraryImages ?? 0);
  const signals = readSignals({
    text: signalText(ctx),
    content: {
      services: content.services,
      menuItems: content.menuItems,
      images: content.images,
      testimonials: content.testimonials,
      words: content.words,
    },
  });

  const layouts: Record<string, SectionLayout> = {};
  const hidden: string[] = [];
  const notes: string[] = [];
  const isMenu = ctx.site.meta.kind === "menu";

  for (const section of ctx.site.sections) {
    switch (section.type) {
      case "hero":
        layouts[section.id] = isMenu
          ? "typographic"
          : heroLayout(content, signals, ctx.site.theme.architecture);
        break;

      case "services": {
        if (section.items.length === 0) {
          hidden.push(section.id);
          notes.push("No services were established, so that section is switched off.");
          break;
        }
        layouts[section.id] = servicesLayout(section.items.length, signals);
        break;
      }

      case "testimonials": {
        // Reviews are a fact about the business. Without them the section is
        // an empty promise, and filling it would be inventing praise.
        if (section.items.length === 0) {
          hidden.push(section.id);
          notes.push("No reviews were verified, so no testimonials section.");
          break;
        }
        layouts[section.id] = testimonialsLayout(section.items.length, signals);
        break;
      }

      case "gallery": {
        if (section.imageIds.length === 0) {
          hidden.push(section.id);
          notes.push("No photographs yet, so the gallery is off until you add some.");
          break;
        }
        layouts[section.id] = galleryLayout(section.imageIds.length, signals);
        break;
      }

      case "about":
        layouts[section.id] = aboutLayout(content, signals);
        break;

      case "hours":
        if (section.rows.length === 0) {
          hidden.push(section.id);
          notes.push("Opening hours were not verified, so they are not shown.");
        } else {
          layouts[section.id] = "list";
        }
        break;

      case "menu":
        layouts[section.id] = content.menuCategories > 1 ? "index" : "list";
        if (content.menuItems === 0 && !isMenu) {
          hidden.push(section.id);
          notes.push("No menu items were verified, so that section is off.");
        }
        break;

      case "cta":
        // A call-to-action band between every section is filler. It earns a
        // place when the page is long enough to need a second invitation and
        // there is somewhere real to send the visitor.
        if (!content.hasContact || content.words < 120) {
          hidden.push(section.id);
          notes.push("The contact section already carries the invitation, so no extra call-to-action band.");
        } else {
          layouts[section.id] = signals.energy > 0.65 ? "band" : "inline";
        }
        break;

      case "contact":
        layouts[section.id] = content.hasLocation ? "split" : "list";
        break;

      default:
        break;
    }
  }

  return {
    signals,
    content,
    styleKeywords: [ctx.skill?.styleName, ctx.skill?.antiPatterns].filter(Boolean).join(" "),
    layouts,
    hidden,
    notes,
  };
}

/**
 * Apply the plan: tokens onto the theme, a layout onto each section, and
 * sections with nothing to show switched off.
 *
 * Switched off rather than deleted, so the creator can turn one back on from
 * the editor once they have the content for it.
 */
export function applyLayoutPlan(site: Site, plan: LayoutPlan): Site {
  const hidden = new Set(plan.hidden);
  const sections: Section[] = site.sections.map((section) => {
    const layout = plan.layouts[section.id];
    const next = { ...section } as Section;
    if (layout) next.layout = layout;
    if (hidden.has(section.id)) next.visible = false;
    return next;
  });

  const tokens = deriveTokens({
    architectureId: site.theme.architecture,
    kind: site.meta.kind,
    signals: plan.signals,
    styleKeywords: plan.styleKeywords,
  });

  return {
    ...site,
    theme: {
      ...site.theme,
      tokens,
      // Density is part of the design system now; the existing field is kept
      // in step so anything still reading it sees the same decision.
      layout: tokens.density,
    },
    sections,
  };
}
