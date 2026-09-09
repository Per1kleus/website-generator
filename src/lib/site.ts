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

export type Theme = {
  colors: { primary: string; secondary: string; accent: string; bg: string; text: string };
  fonts: { heading: string; body: string };
  layout: LayoutDensity;
  radius: number;
  /** Chosen design architecture — see lib/architectures.ts. */
  architecture: string;
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
export type MenuItemRow = PricedRow & { tags: string[]; imageId?: string };
export type MenuCategoryRow = ListRow & { items: MenuItemRow[] };
export type HoursRow = ListRow & { hours: string };
export type LinkRow = ListRow & { href: string };

export type Section =
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
  | { id: string; type: "footer"; visible: boolean; links: LinkRow[] };

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
  };
  theme: Theme;
  sections: Section[];
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

export const META_KEYS = ["tagline", "stickyCtaLabel", "logoAlt", "skipToContent", "menuLabel"];

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

export const GENERATION_STEPS: { key: string; label: string }[] = [
  { key: "research", label: "Business researched" },
  { key: "analysis", label: "Identity analysed" },
  { key: "architecture", label: "Design architecture chosen" },
  { key: "content", label: "Content written" },
  { key: "localize", label: "Languages prepared" },
  { key: "build", label: "Website built" },
  { key: "seo", label: "SEO generated" },
  { key: "validate", label: "Validation passed" },
];
