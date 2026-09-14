import { localeDir, type Locale } from "./locales";

/**
 * The generated website as a JSON document (schema v2).
 *
 * v2 splits the document in two on purpose:
 *
 *   `sections`  structure only — what exists, in what order, with the
 *               locale-invariant bits (image ids, links, phone numbers,
 *               PRICES, tags). One copy, shared by every language.
 *
 *   `i18n`      a flat per-locale catalog of translatable strings, keyed by
 *               dotted paths like "sec_ab12.headline" or
 *               "sec_cd34.items.itm_ef56.name".
 *
 * That split is what makes requirements 12-18 and 30 hold by construction:
 * switching language can only ever change strings, never the design or the
 * structure; adding a language adds a catalog and touches nothing else;
 * removing one deletes a catalog; and prices, phone numbers and addresses
 * physically cannot be "translated" because they do not live in the catalog.
 */

export type SiteKind = "business" | "menu" | "portfolio" | "landing" | "booking";

export const SITE_KINDS: { id: SiteKind; label: string; blurb: string; emoji: string }[] = [
  { id: "business", label: "Full business website", blurb: "Services, about, contact", emoji: "🏢" },
  { id: "menu", label: "Digital menu", blurb: "QR-code menu for guests", emoji: "🍽️" },
  { id: "portfolio", label: "Portfolio", blurb: "Show work and gallery", emoji: "🎨" },
  { id: "landing", label: "Landing page", blurb: "One page, one action", emoji: "🚀" },
  { id: "booking", label: "Bookings", blurb: "Drive calls and reservations", emoji: "📅" },
];

export type LayoutDensity = "minimal" | "balanced" | "dense";

/**
 * The design system for one website.
 *
 * A palette swap is not a design. These tokens are the whole visual
 * language — type, rhythm, shape, weight, motion — derived deterministically
 * in lib/tokens.ts from the chosen architecture, the ui-ux-pro-max direction,
 * the business's own identity and what content it actually has.
 *
 * Optional on the theme: a document written before this existed renders from
 * its architecture exactly as it did, and gains tokens the next time it is
 * generated.
 */
export type DesignTokens = {
  type: {
    /** Multiplier on the fluid heading scale. */
    scale: number;
    /** Ratio between steps — a tight ratio reads calm, a wide one dramatic. */
    ratio: number;
    headingWeight: number;
    bodyWeight: number;
    headingTracking: string;
    bodyTracking: string;
    headingLeading: number;
    bodyLeading: number;
    headingCase: "none" | "upper";
    /** Body measure in characters. */
    measure: number;
  };
  space: {
    /** Base spacing step in rem; everything else is a multiple. */
    step: number;
    /** Vertical padding of a section, as a multiple of the step. */
    section: number;
    /** Gap inside a group, as a multiple of the step. */
    gap: number;
    /** Content container width in rem. */
    container: number;
  };
  shape: {
    /** Radii by role rather than one global number: reserving the round
        treatment for a few components is what stops a page reading as a
        sheet of pills. */
    card: number;
    button: number;
    image: number;
    input: number;
    border: number;
    /** Shadow language. "none" is a real choice. */
    shadow: "none" | "hairline" | "soft" | "lifted";
    buttonShape: "pill" | "rounded" | "square";
    buttonFill: "solid" | "outline" | "underline";
  };
  surface: {
    /** How a card is drawn — or whether cards are used at all. */
    card: "none" | "border" | "tint" | "raised";
    /** Section dividers. */
    divider: "none" | "rule" | "space";
    /** Whether alternating sections change background. */
    banding: boolean;
  };
  image: {
    treatment: "sharp" | "soft" | "arch" | "circle" | "duotone" | "framed";
    /** Default aspect for editorial images. */
    ratio: "square" | "portrait" | "landscape" | "wide";
  };
  motion: "none" | "subtle" | "expressive";
  density: LayoutDensity;
};

/**
 * How one section is composed.
 *
 * The same content can be a card grid, a list, an editorial column or a
 * numbered index — and choosing per business is what stops every generated
 * site sharing one silhouette. Chosen deterministically in server/layout.ts.
 */
export type SectionLayout =
  /* services / testimonials / about highlights */
  | "cards"       // the familiar grid — still right for some businesses
  | "list"        // rows with rules between them
  | "editorial"   // full-measure prose blocks, no boxes
  | "index"       // numbered index, typographic
  | "split"       // copy beside media
  | "statement"   // one large idea, no supporting furniture
  | "band"        // full-width tinted band
  | "inline"      // sits in the flow, no section chrome
  /* gallery */
  | "grid"
  | "mosaic"
  | "strip"
  /* hero */
  | "image-led"
  | "typographic"
  | "poster"
  | "editorial-hero";

export type Theme = {
  colors: { primary: string; secondary: string; accent: string; bg: string; text: string };
  /** Local stacks, always present — they are the fallback for `fontFamilies`. */
  fonts: { heading: string; body: string };
  /**
   * Web font pairing recommended by the ui-ux-pro-max skill, when one applies.
   * Null means "use the local stacks only", which is always the case for a
   * digital menu: a guest must not wait on a font download to read a price.
   */
  fontFamilies: { heading: string; body: string; url: string } | null;
  layout: LayoutDensity;
  radius: number;
  /** Chosen design architecture — see lib/architectures.ts. */
  architecture: string;
  /** The derived design system. Absent on documents generated before it existed. */
  tokens?: DesignTokens;
};

export type SectionType =
  | "hero" | "about" | "services" | "menu" | "gallery"
  | "hours" | "testimonials" | "cta" | "contact" | "footer";

/* -------------------------------------------------------------------------
   Structure. Nothing here is ever translated.
------------------------------------------------------------------------- */

/** A repeatable row. `id` anchors its translated strings in the catalog. */
export type ListRow = { id: string };
export type PricedRow = ListRow & { price: string };
export type MenuItemRow = PricedRow & {
  tags: string[];
  imageId?: string;
  /** From the sheet's "chefs choice" checkbox. Never translated. */
  chefsChoice?: boolean;
  /** Stable key from the menu source, so translations survive a re-sync. */
  sourceKey?: string;
};
export type MenuCategoryRow = ListRow & { items: MenuItemRow[]; sourceKey?: string };
export type HoursRow = ListRow & { hours: string };
export type LinkRow = ListRow & { href: string };

/**
 * A section, plus how it is composed.
 *
 * `layout` is intersected across the union so every section type carries it
 * while `type` still narrows the rest. Absent means "the renderer's default
 * for this type", which is what existing documents get.
 */
export type Section = ({ layout?: SectionLayout }) & (
  | { id: string; type: "hero"; visible: boolean;
      ctaHref: string; secondaryHref: string; imageId: string }
  | { id: string; type: "about"; visible: boolean;
      imageId: string; highlights: ListRow[] }
  | { id: string; type: "services"; visible: boolean; items: PricedRow[] }
  | { id: string; type: "menu"; visible: boolean; categories: MenuCategoryRow[] }
  | { id: string; type: "gallery"; visible: boolean; imageIds: string[] }
  | { id: string; type: "hours"; visible: boolean; rows: HoursRow[] }
  | { id: string; type: "testimonials"; visible: boolean; items: ListRow[] }
  | { id: string; type: "cta"; visible: boolean; ctaHref: string }
  | { id: string; type: "contact"; visible: boolean;
      phone: string; email: string; mapsUrl: string; bookingUrl: string }
  | { id: string; type: "footer"; visible: boolean; links: LinkRow[] }
);

/* -------------------------------------------------------------------------
   Localised content
------------------------------------------------------------------------- */

export type SeoMeta = {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  keywords: string[];
};

export type LocaleCatalog = {
  /** Flat dotted-path -> translated string. */
  strings: Record<string, string>;
  seo: SeoMeta;
};

/**
 * What a photograph is doing on the page.
 *
 * Decided in server/images.ts from the picture's own measurements, and read by
 * the renderer so the crop, the reserved space and the loading priority all
 * follow from the role rather than from one hardcoded box.
 */
export type ImageRole = "hero" | "section" | "gallery" | "showcase" | "menu" | "supporting";

export type ImagePlacement = {
  assetId: string;
  role: ImageRole;
  /** The real pixel size, so the page can reserve the right space. */
  width: number;
  height: number;
  /** Where the detail sits, 0–1. Becomes object-position. */
  focalX: number;
  focalY: number;
  ratio: { desktop: string; mobile: string };
  /** True only for the image at the top of the page. */
  priority: boolean;
};

/**
 * What the research established about the business, carried on the document.
 *
 * The renderer needs these to describe the business honestly in its structured
 * data long after generation — which type of business it is, where it is, and
 * crucially *which* of those the research actually confirmed. Anything absent
 * here is simply not claimed.
 */
export type BusinessFacts = {
  category: string;
  cuisineOrSpecialty: string;
  location: string;
  priceRange: string;
  services: string[];
  menuHighlights: { name: string; price: string }[];
  positioning: string;
  /** Field names the research confirmed with a source. */
  verifiedFields: string[];
  /**
   * The subset of `verifiedFields` whose evidence was the business's own
   * existing website — what it says about itself, rather than what a second
   * source confirmed. Optional: absent on every document generated before the
   * existing-website input, and on every project that did not supply one.
   */
  websiteFields?: string[];
};

export type Logo = {
  assetId: string;
  /** Rendered at this height in the header; the width follows the aspect ratio. */
  height: number;
  /** True when the source has transparency, so it can sit on any background. */
  transparent: boolean;
};

export type Site = {
  version: 2;
  meta: {
    /** Proper noun — never translated (requirement 14). */
    businessName: string;
    kind: SiteKind;
    defaultLocale: Locale;
    locales: Locale[];
    logo: Logo | null;
    stickyCta: { enabled: boolean; href: string };
    /** Verified research, for honest metadata after generation. */
    facts?: BusinessFacts;
    /**
     * Google Analytics for this one website.
     *
     * The measurement id is public — it is in the page source of every site
     * that uses Analytics — and it is per project, never a value baked into
     * the application. Absent means the generated website carries no tracking
     * code at all, which is the default and the common case.
     *
     * `consentAcknowledged` records that the creator has taken responsibility
     * for whether this may run where their visitors are. It is not a claim
     * that anything is lawful, and the application never makes one.
     */
    analytics?: {
      measurementId: string;
      consentAcknowledged: boolean;
    };
  };
  theme: Theme;
  sections: Section[];
  /** How each photograph is being used. Absent when there are none. */
  images?: ImagePlacement[];
  i18n: Record<Locale, LocaleCatalog>;
};

/* -------------------------------------------------------------------------
   String catalog access
------------------------------------------------------------------------- */

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero", about: "About", services: "Services", menu: "Menu",
  gallery: "Gallery", hours: "Opening hours", testimonials: "Testimonials",
  cta: "Call to action", contact: "Contact", footer: "Footer",
};

export const SECTION_EMOJI: Record<SectionType, string> = {
  hero: "✨", about: "📖", services: "🛠️", menu: "🍽️", gallery: "🖼️",
  hours: "🕒", testimonials: "💬", cta: "📣", contact: "📍", footer: "⚓",
};

/**
 * Reads a translated string, falling back to the default locale and then to
 * an empty string. A missing translation must degrade to the default
 * language, never to a visible key or a blank page (requirement 27).
 */
export function t(site: Site, locale: Locale, key: string): string {
  const primary = site.i18n[locale]?.strings[key];
  if (typeof primary === "string" && primary !== "") return primary;
  const fallback = site.i18n[site.meta.defaultLocale]?.strings[key];
  return typeof fallback === "string" ? fallback : "";
}

export function setString(site: Site, locale: Locale, key: string, value: string): Site {
  const catalog = site.i18n[locale] ?? emptyCatalog();
  return {
    ...site,
    i18n: {
      ...site.i18n,
      [locale]: { ...catalog, strings: { ...catalog.strings, [key]: value } },
    },
  };
}

export function emptyCatalog(): LocaleCatalog {
  return {
    strings: {},
    seo: { title: "", description: "", ogTitle: "", ogDescription: "", keywords: [] },
  };
}

/** Key helpers keep path construction in one place, so nothing drifts. */
export const key = {
  section: (sectionId: string, field: string) => `${sectionId}.${field}`,
  row: (sectionId: string, rowId: string, field: string) => `${sectionId}.rows.${rowId}.${field}`,
  menuItem: (sectionId: string, catId: string, itemId: string, field: string) =>
    `${sectionId}.cats.${catId}.items.${itemId}.${field}`,
  meta: (field: string) => `meta.${field}`,
};

/** Every string key a section needs, so coverage can be checked per locale. */
export function sectionKeys(section: Section): string[] {
  const k: string[] = [key.section(section.id, "title")];
  switch (section.type) {
    case "hero":
      k.push(
        key.section(section.id, "eyebrow"),
        key.section(section.id, "headline"),
        key.section(section.id, "subheadline"),
        key.section(section.id, "ctaLabel"),
        key.section(section.id, "secondaryLabel"),
      );
      break;
    case "about":
      k.push(key.section(section.id, "heading"), key.section(section.id, "body"));
      for (const h of section.highlights) k.push(key.row(section.id, h.id, "text"));
      break;
    case "services":
      k.push(key.section(section.id, "heading"), key.section(section.id, "intro"));
      for (const it of section.items) {
        k.push(key.row(section.id, it.id, "name"), key.row(section.id, it.id, "description"));
      }
      break;
    case "menu":
      k.push(key.section(section.id, "heading"), key.section(section.id, "note"));
      for (const c of section.categories) {
        k.push(key.row(section.id, c.id, "name"));
        for (const it of c.items) {
          k.push(
            key.menuItem(section.id, c.id, it.id, "name"),
            key.menuItem(section.id, c.id, it.id, "description"),
          );
          if (it.imageId) k.push(key.menuItem(section.id, c.id, it.id, "alt"));
        }
      }
      break;
    case "gallery":
      k.push(key.section(section.id, "heading"));
      // Alt text is per image and per language (requirements 13 and 22).
      for (const id of section.imageIds) k.push(key.row(section.id, id, "alt"));
      break;
    case "hours":
      k.push(key.section(section.id, "heading"), key.section(section.id, "note"));
      for (const r of section.rows) k.push(key.row(section.id, r.id, "day"));
      break;
    case "testimonials":
      k.push(key.section(section.id, "heading"));
      for (const it of section.items) {
        k.push(key.row(section.id, it.id, "quote"), key.row(section.id, it.id, "author"));
      }
      break;
    case "cta":
      k.push(
        key.section(section.id, "heading"),
        key.section(section.id, "body"),
        key.section(section.id, "ctaLabel"),
      );
      break;
    case "contact":
      k.push(
        key.section(section.id, "heading"),
        key.section(section.id, "address"),
        key.section(section.id, "bookingLabel"),
      );
      break;
    case "footer":
      k.push(key.section(section.id, "tagline"));
      for (const l of section.links) k.push(key.row(section.id, l.id, "label"));
      break;
  }
  return k;
}

export const META_KEYS = [
  "tagline", "stickyCtaLabel", "logoAlt", "skipToContent", "menuLabel",
  // The Chef's Choice badge is visitor-facing text, so it is translated like
  // any other string rather than hardcoded in the renderer.
  "chefsChoiceLabel",
];

export function allKeys(site: Site): string[] {
  return [
    ...META_KEYS.map(key.meta),
    ...site.sections.flatMap(sectionKeys),
  ];
}

/** Keys present in the default locale but missing or blank in `locale`. */
export function missingKeys(site: Site, locale: Locale): string[] {
  const catalog = site.i18n[locale];
  if (!catalog) return allKeys(site);
  return allKeys(site).filter((k) => {
    const v = catalog.strings[k];
    // Only count it missing if the default locale actually has something.
    return (!v || v.trim() === "") && Boolean(site.i18n[site.meta.defaultLocale]?.strings[k]);
  });
}

/* -------------------------------------------------------------------------
   Fonts
------------------------------------------------------------------------- */

export const FONT_CHOICES = [
  { id: "system", label: "System", stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` },
  { id: "serif", label: "Serif", stack: `ui-serif, Georgia, "Times New Roman", serif` },
  { id: "grotesk", label: "Grotesk", stack: `"Helvetica Neue", Helvetica, Arial, sans-serif` },
  { id: "rounded", label: "Rounded", stack: `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif` },
  { id: "mono", label: "Mono", stack: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` },
  { id: "display", label: "Display", stack: `"Didot", "Bodoni MT", "Playfair Display", ui-serif, Georgia, serif` },
  { id: "slab", label: "Slab", stack: `"Rockwell", "Roboto Slab", ui-serif, Georgia, serif` },
  { id: "humanist", label: "Humanist", stack: `"Optima", "Gill Sans", "Segoe UI", ui-sans-serif, sans-serif` },
] as const;

export function fontStack(id: string): string {
  return FONT_CHOICES.find((f) => f.id === id)?.stack ?? FONT_CHOICES[0].stack;
}

/* -------------------------------------------------------------------------
   Structural helpers
------------------------------------------------------------------------- */

export function newId(prefix = "s"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function moveSection(sections: Section[], id: string, dir: -1 | 1): Section[] {
  const i = sections.findIndex((s) => s.id === id);
  if (i < 0) return sections;
  const j = i + dir;
  if (j < 0 || j >= sections.length) return sections;
  const next = sections.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function reorderSections(sections: Section[], from: number, to: number): Section[] {
  if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) {
    return sections;
  }
  const next = sections.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * An empty section of a given type, structurally complete.
 *
 * "Structurally complete" is the whole point: a section is a tagged union, and
 * a `services` section without its `items` array is not a services section
 * that happens to be empty — it is a document the renderer and the validator
 * will disagree about. So every variant is spelled out rather than built by
 * spreading a shared blank, which is what would let a field quietly go
 * missing when the union changes.
 *
 * Nothing here is translated. The strings are added per locale by
 * `addSection`, which knows which languages the document has.
 */
export function blankSection(type: SectionType, id = newId()): Section {
  const base = { id, visible: true } as const;
  switch (type) {
    case "hero":
      return { ...base, type, ctaHref: "", secondaryHref: "", imageId: "" };
    case "about":
      return { ...base, type, imageId: "", highlights: [] };
    case "services":
      return { ...base, type, items: [] };
    case "menu":
      return { ...base, type, categories: [] };
    case "gallery":
      return { ...base, type, imageIds: [] };
    case "hours":
      return { ...base, type, rows: [] };
    case "testimonials":
      return { ...base, type, items: [] };
    case "cta":
      return { ...base, type, ctaHref: "" };
    case "contact":
      return { ...base, type, phone: "", email: "", mapsUrl: "", bookingUrl: "" };
    case "footer":
      return { ...base, type, links: [] };
  }
}

/**
 * A section from outside, made structurally sound.
 *
 * Anything arriving from a client or a model may be missing the arrays its
 * type requires — `{id, type: "services"}` with no `items` is the shape that
 * renders as a crash rather than as an empty list. Filling from a blank of the
 * same type guarantees every field the renderer reads exists, while keeping
 * whatever the caller genuinely sent. An array-shaped field that arrives as
 * something else is replaced rather than trusted.
 */
export function normaliseSection(candidate: Section): Section {
  const blank = blankSection(candidate.type, candidate.id) as Record<string, unknown>;
  const given = candidate as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...blank };

  for (const [field, fallback] of Object.entries(blank)) {
    const value = given[field];
    if (value === undefined) continue;
    if (Array.isArray(fallback) && !Array.isArray(value)) continue;
    if (typeof fallback === "string" && typeof value !== "string") continue;
    if (typeof fallback === "boolean" && typeof value !== "boolean") continue;
    out[field] = value;
  }
  // `layout` is optional and shared across the union, so it is not on the
  // blank; carry it when it is there.
  if (given.layout !== undefined) out.layout = given.layout;

  return out as unknown as Section;
}

/**
 * Section types a creator may add to this document.
 *
 * A page has one hero and one footer — they are the top and the bottom, not
 * content — so neither can be added twice. A hidden section already exists
 * and is offered as "show it again" rather than as a second copy, which is
 * the difference between a document that stays coherent and one that
 * accumulates duplicates nobody meant to create.
 */
export function addableSectionTypes(sections: Section[]): SectionType[] {
  const present = new Set(sections.map((s) => s.type));
  const singular: SectionType[] = ["hero", "footer", "contact", "about", "cta", "hours"];
  return (Object.keys(SECTION_LABELS) as SectionType[]).filter(
    (type) => !(singular.includes(type) && present.has(type)),
  );
}

/**
 * Add a section, with a readable title in every language the site has.
 *
 * It goes before the footer rather than at the end, because a section after
 * the footer is never what anyone meant. The title is the English label in
 * every locale: inventing a translation here would be fabricating content,
 * and an untranslated title a creator can see and edit is honest.
 */
export function addSection(site: Site, type: SectionType): Site {
  const section = blankSection(type);
  const footerAt = site.sections.findIndex((s) => s.type === "footer");
  const sections = site.sections.slice();
  sections.splice(footerAt >= 0 ? footerAt : sections.length, 0, section);

  const i18n = { ...site.i18n };
  for (const locale of site.meta.locales) {
    const catalog = i18n[locale];
    if (!catalog) continue;
    i18n[locale] = {
      ...catalog,
      strings: { ...catalog.strings, [key.section(section.id, "title")]: SECTION_LABELS[type] },
    };
  }

  return { ...site, sections, i18n };
}

/**
 * Remove a section and the strings that belonged to it.
 *
 * Leaving the strings behind would grow the document every time someone
 * changed their mind, and they can never be reached again — the key is
 * anchored to a section id that no longer exists.
 */
export function removeSection(site: Site, id: string): Site {
  const section = site.sections.find((s) => s.id === id);
  if (!section) return site;

  const prefix = `${id}.`;
  const i18n = { ...site.i18n };
  for (const locale of Object.keys(i18n) as Locale[]) {
    const catalog = i18n[locale];
    if (!catalog) continue;
    i18n[locale] = {
      ...catalog,
      strings: Object.fromEntries(
        Object.entries(catalog.strings).filter(([k]) => !k.startsWith(prefix)),
      ),
    };
  }

  return { ...site, sections: site.sections.filter((s) => s.id !== id), i18n };
}

export function sectionTitle(site: Site, locale: Locale, section: Section): string {
  return t(site, locale, key.section(section.id, "title")) || SECTION_LABELS[section.type];
}

export function sectionSummary(site: Site, locale: Locale, section: Section): string {
  const s = (field: string) => t(site, locale, key.section(section.id, field));
  switch (section.type) {
    case "hero": return s("headline");
    case "about": return s("heading");
    case "services": return `${section.items.length} service${section.items.length === 1 ? "" : "s"}`;
    case "menu": {
      const items = section.categories.reduce((n, c) => n + c.items.length, 0);
      return `${section.categories.length} categories · ${items} items`;
    }
    case "gallery": return `${section.imageIds.length} image${section.imageIds.length === 1 ? "" : "s"}`;
    case "hours": return `${section.rows.length} days`;
    case "testimonials": return `${section.items.length} quotes`;
    case "cta": return s("heading");
    case "contact": return s("address") || section.phone || "Contact details";
    case "footer": return s("tagline");
  }
}

export function siteDir(site: Site, locale: Locale): "ltr" | "rtl" {
  return localeDir(locale);
}

/**
 * The stages a creator sees while a website is generated.
 *
 * The order is the order the pipeline actually reports them in, which matters
 * more than it looks: progress is derived from a stage's position in this
 * list, so a list that disagrees with the pipeline makes the bar jump
 * backwards. Photographs have a stage of their own because placing them is
 * visibly separate work, and a creator who uploaded twelve pictures should be
 * able to see that they are being dealt with.
 *
 * Labels are what is happening, not implementation detail. Nobody needs to
 * read "token engine" or "critic pass" to trust that their site is being made.
 */
export const GENERATION_STEPS: { key: string; label: string }[] = [
  { key: "research", label: "Researching the business" },
  { key: "analysis", label: "Analysing the identity" },
  { key: "architecture", label: "Choosing the design direction" },
  { key: "content", label: "Writing the content" },
  { key: "design", label: "Building the layout" },
  { key: "images", label: "Optimising the photographs" },
  { key: "localize", label: "Preparing the languages" },
  { key: "seo", label: "Creating the SEO" },
  { key: "qa", label: "Checking every screen size" },
  { key: "build", label: "Building the website" },
  { key: "validate", label: "Running the quality checks" },
];
