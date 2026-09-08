/**
 * The generated website is a JSON document, not a blob of HTML.
 *
 * Everything downstream depends on this: the section editor lists `sections`,
 * reordering swaps array entries, the AI editor returns a patched document,
 * versioning snapshots it, and the renderer turns it into a standalone
 * mobile-first site. Keeping HTML out of the model is what makes editing from
 * a phone possible at all.
 */

export type SiteKind = "business" | "menu" | "portfolio" | "landing" | "booking";

export const SITE_KINDS: { id: SiteKind; label: string; blurb: string; emoji: string }[] = [
  { id: "business", label: "Business website", blurb: "Services, about, contact", emoji: "🏢" },
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
};

export type SectionType =
  | "hero"
  | "about"
  | "services"
  | "menu"
  | "gallery"
  | "hours"
  | "testimonials"
  | "cta"
  | "contact"
  | "footer";

export type MenuItem = { name: string; description: string; price: string; tags: string[] };
export type MenuCategory = { name: string; items: MenuItem[] };

/** Section props are a union keyed by `type` so the editor can render the right form. */
export type Section =
  | { id: string; type: "hero"; title: string; visible: boolean; props: {
      headline: string; subheadline: string; ctaLabel: string; ctaHref: string;
      secondaryLabel: string; secondaryHref: string; imageId: string; eyebrow: string } }
  | { id: string; type: "about"; title: string; visible: boolean; props: {
      heading: string; body: string; highlights: string[]; imageId: string } }
  | { id: string; type: "services"; title: string; visible: boolean; props: {
      heading: string; intro: string;
      items: { name: string; description: string; price: string }[] } }
  | { id: string; type: "menu"; title: string; visible: boolean; props: {
      heading: string; note: string; categories: MenuCategory[] } }
  | { id: string; type: "gallery"; title: string; visible: boolean; props: {
      heading: string; imageIds: string[] } }
  | { id: string; type: "hours"; title: string; visible: boolean; props: {
      heading: string; rows: { day: string; hours: string }[]; note: string } }
  | { id: string; type: "testimonials"; title: string; visible: boolean; props: {
      heading: string; items: { quote: string; author: string }[] } }
  | { id: string; type: "cta"; title: string; visible: boolean; props: {
      heading: string; body: string; ctaLabel: string; ctaHref: string } }
  | { id: string; type: "contact"; title: string; visible: boolean; props: {
      heading: string; address: string; phone: string; email: string;
      mapsUrl: string; bookingUrl: string } }
  | { id: string; type: "footer"; title: string; visible: boolean; props: {
      businessName: string; tagline: string; links: { label: string; href: string }[] } };

export type Site = {
  version: 1;
  meta: {
    businessName: string;
    tagline: string;
    description: string;
    kind: SiteKind;
    language: string;
    /** Sticky bottom call-to-action on phones (section 15: mobile CTA placement). */
    stickyCta: { enabled: boolean; label: string; href: string };
  };
  theme: Theme;
  sections: Section[];
};

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  about: "About",
  services: "Services",
  menu: "Menu",
  gallery: "Gallery",
  hours: "Opening hours",
  testimonials: "Testimonials",
  cta: "Call to action",
  contact: "Contact",
  footer: "Footer",
};

export const SECTION_EMOJI: Record<SectionType, string> = {
  hero: "✨", about: "📖", services: "🛠️", menu: "🍽️", gallery: "🖼️",
  hours: "🕒", testimonials: "💬", cta: "📣", contact: "📍", footer: "⚓",
};

export const FONT_CHOICES = [
  { id: "system", label: "System", stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` },
  { id: "serif", label: "Serif", stack: `ui-serif, Georgia, "Times New Roman", serif` },
  { id: "grotesk", label: "Grotesk", stack: `"Helvetica Neue", Helvetica, Arial, sans-serif` },
  { id: "rounded", label: "Rounded", stack: `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif` },
  { id: "mono", label: "Mono", stack: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` },
] as const;

export function fontStack(id: string): string {
  return FONT_CHOICES.find((f) => f.id === id)?.stack ?? FONT_CHOICES[0].stack;
}

export function newId(prefix = "s"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Moves a section by one position; returns a new array (never mutates). */
export function moveSection(sections: Section[], id: string, dir: -1 | 1): Section[] {
  const i = sections.findIndex((s) => s.id === id);
  if (i < 0) return sections;
  const j = i + dir;
  if (j < 0 || j >= sections.length) return sections;
  const next = sections.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Reorders by absolute index — used by the touch drag-and-drop handler. */
export function reorderSections(sections: Section[], from: number, to: number): Section[] {
  if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) {
    return sections;
  }
  const next = sections.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function sectionSummary(section: Section): string {
  switch (section.type) {
    case "hero": return section.props.headline;
    case "about": return section.props.heading;
    case "services": return `${section.props.items.length} service${section.props.items.length === 1 ? "" : "s"}`;
    case "menu": {
      const items = section.props.categories.reduce((n, c) => n + c.items.length, 0);
      return `${section.props.categories.length} categories · ${items} items`;
    }
    case "gallery": return `${section.props.imageIds.length} image${section.props.imageIds.length === 1 ? "" : "s"}`;
    case "hours": return `${section.props.rows.length} days`;
    case "testimonials": return `${section.props.items.length} quotes`;
    case "cta": return section.props.heading;
    case "contact": return section.props.address || section.props.phone || "Contact details";
    case "footer": return section.props.tagline;
  }
}

/**
 * The generation pipeline's steps, shared by the server job runner and the
 * progress screen. The screen renders these immediately on first paint, so a
 * phone on a slow connection sees the real checklist rather than a blank
 * screen while the job record is still being created.
 */
export const GENERATION_STEPS: { key: string; label: string }[] = [
  { key: "research", label: "Business researched" },
  { key: "brand", label: "Brand analysed" },
  { key: "identity", label: "Visual identity created" },
  { key: "build", label: "Website built" },
  { key: "qa", label: "Quality checks passed" },
];
