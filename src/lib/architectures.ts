/**
 * Design architectures.
 *
 * A template restyled with different colours is still the same website. An
 * architecture changes the things a visitor actually perceives as "a different
 * kind of site": how the page is composed, how type is scaled and set, how
 * images are cropped and treated, how navigation behaves, how dense it is,
 * and how much it moves.
 *
 * Each entry below is a complete set of those decisions. The renderer reads
 * them; it does not hardcode a look of its own.
 */

export type NavStyle =
  | "classic"      // logo left, links right
  | "centered"     // centred wordmark, links beneath
  | "minimal"      // wordmark + menu affordance only
  | "sidebarish"   // oversized wordmark, links stacked on wide screens
  | "none";        // no site nav at all (digital menus)

export type HeroStyle =
  | "split"        // copy beside image on wide screens
  | "stacked"      // copy over full-bleed image
  | "typographic"  // giant type, image secondary or absent
  | "editorial"    // eyebrow rule + measured column
  | "poster";      // centred, symmetrical, image as backdrop

export type ImageTreatment =
  | "sharp"        // square corners, no filter
  | "soft"         // generous radius
  | "arch"         // arched top — organic / Mediterranean
  | "circle"
  | "duotone"      // tinted toward the brand colour
  | "framed";      // inset border

export type SectionRhythm = "airy" | "measured" | "tight";

export type DesignArchitecture = {
  id: string;
  label: string;
  /** Shown to the creator so the chosen direction is legible, not magic. */
  rationale: string;
  nav: NavStyle;
  hero: HeroStyle;
  images: ImageTreatment;
  rhythm: SectionRhythm;
  /** Multiplier applied to the fluid heading scale. */
  typeScale: number;
  /** Heading case treatment. */
  headingCase: "none" | "upper";
  headingTracking: string;
  /** Body measure in characters — controls line length, the core readability lever. */
  measure: number;
  /** Corner radius in px; architectures own this, not the palette. */
  radius: number;
  /** Rule/border weight in px. */
  ruleWeight: number;
  /** Whether section headings get a leading rule or number. */
  headingOrnament: "none" | "rule" | "number";
  /** Motion budget. "none" is a real choice, not a fallback. */
  motion: "none" | "subtle" | "expressive";
  /** Buttons. */
  buttonShape: "pill" | "rounded" | "square";
  buttonFill: "solid" | "outline" | "underline";
  /** Default font pairing; the identity analysis may override it. */
  fonts: { heading: string; body: string };
  /** Preferred section order weighting — lower sorts earlier. */
  emphasis: Partial<Record<string, number>>;
};

export const ARCHITECTURES: DesignArchitecture[] = [
  {
    id: "editorial",
    label: "Editorial",
    rationale: "Reads like a magazine feature: strong headline hierarchy, generous measure, restrained ornament.",
    nav: "classic", hero: "editorial", images: "sharp", rhythm: "airy",
    typeScale: 1.1, headingCase: "none", headingTracking: "-0.02em", measure: 68,
    radius: 0, ruleWeight: 1, headingOrnament: "rule", motion: "subtle",
    buttonShape: "square", buttonFill: "underline",
    fonts: { heading: "serif", body: "system" },
    emphasis: { about: 1, services: 2, gallery: 3 },
  },
  {
    id: "luxury",
    label: "Luxury",
    rationale: "Quiet confidence: wide letter-spacing, deep whitespace, almost no colour, nothing rushed.",
    nav: "centered", hero: "poster", images: "framed", rhythm: "airy",
    typeScale: 1.05, headingCase: "upper", headingTracking: "0.16em", measure: 60,
    radius: 0, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "square", buttonFill: "outline",
    fonts: { heading: "display", body: "serif" },
    emphasis: { gallery: 1, about: 2 },
  },
  {
    id: "minimal",
    label: "Minimal",
    rationale: "Everything unnecessary removed. One accent, one type family, a lot of air.",
    nav: "minimal", hero: "typographic", images: "sharp", rhythm: "airy",
    typeScale: 1.0, headingCase: "none", headingTracking: "-0.01em", measure: 64,
    radius: 2, ruleWeight: 1, headingOrnament: "none", motion: "none",
    buttonShape: "square", buttonFill: "outline",
    fonts: { heading: "grotesk", body: "grotesk" },
    emphasis: {},
  },
  {
    id: "mediterranean",
    label: "Mediterranean",
    rationale: "Warm, sunlit and hospitable: arched imagery, soft edges, relaxed rhythm.",
    nav: "classic", hero: "stacked", images: "arch", rhythm: "measured",
    typeScale: 1.05, headingCase: "none", headingTracking: "0em", measure: 62,
    radius: 18, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "pill", buttonFill: "solid",
    fonts: { heading: "humanist", body: "system" },
    emphasis: { menu: 1, gallery: 2, hours: 3 },
  },
  {
    id: "industrial",
    label: "Industrial",
    rationale: "Utilitarian and structural: hard rules, mono accents, numbered sections, no decoration.",
    nav: "classic", hero: "typographic", images: "sharp", rhythm: "tight",
    typeScale: 1.15, headingCase: "upper", headingTracking: "-0.01em", measure: 66,
    radius: 0, ruleWeight: 2, headingOrnament: "number", motion: "none",
    buttonShape: "square", buttonFill: "solid",
    fonts: { heading: "grotesk", body: "mono" },
    emphasis: { services: 1, about: 2 },
  },
  {
    id: "organic",
    label: "Organic",
    rationale: "Soft and natural: rounded forms, gentle contrast, unhurried spacing.",
    nav: "classic", hero: "split", images: "soft", rhythm: "measured",
    typeScale: 1.0, headingCase: "none", headingTracking: "-0.01em", measure: 62,
    radius: 24, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "pill", buttonFill: "solid",
    fonts: { heading: "rounded", body: "system" },
    emphasis: { about: 1, gallery: 2 },
  },
  {
    id: "brutalist",
    label: "Brutalist",
    rationale: "Raw and loud: oversized type, heavy rules, deliberate asymmetry, zero softness.",
    nav: "minimal", hero: "typographic", images: "sharp", rhythm: "tight",
    typeScale: 1.35, headingCase: "upper", headingTracking: "-0.03em", measure: 70,
    radius: 0, ruleWeight: 3, headingOrnament: "rule", motion: "none",
    buttonShape: "square", buttonFill: "solid",
    fonts: { heading: "grotesk", body: "mono" },
    emphasis: {},
  },
  {
    id: "architectural",
    label: "Architectural",
    rationale: "Grid-led and precise: strict alignment, thin rules, images as plans and elevations.",
    nav: "sidebarish", hero: "split", images: "sharp", rhythm: "measured",
    typeScale: 1.05, headingCase: "upper", headingTracking: "0.08em", measure: 64,
    radius: 0, ruleWeight: 1, headingOrnament: "number", motion: "subtle",
    buttonShape: "square", buttonFill: "outline",
    fonts: { heading: "grotesk", body: "system" },
    emphasis: { gallery: 1, services: 2 },
  },
  {
    id: "classic",
    label: "Classic",
    rationale: "Familiar and trustworthy: clear hierarchy, conventional layout, nothing to decode.",
    nav: "classic", hero: "split", images: "soft", rhythm: "measured",
    typeScale: 1.0, headingCase: "none", headingTracking: "-0.01em", measure: 64,
    radius: 12, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "rounded", buttonFill: "solid",
    fonts: { heading: "system", body: "system" },
    emphasis: {},
  },
  {
    id: "modern",
    label: "Modern",
    rationale: "Contemporary product-site feel: tight type, confident colour, crisp cards.",
    nav: "classic", hero: "split", images: "soft", rhythm: "measured",
    typeScale: 1.1, headingCase: "none", headingTracking: "-0.03em", measure: 62,
    radius: 14, ruleWeight: 1, headingOrnament: "none", motion: "expressive",
    buttonShape: "rounded", buttonFill: "solid",
    fonts: { heading: "grotesk", body: "system" },
    emphasis: { services: 1 },
  },
  {
    id: "experimental",
    label: "Experimental",
    rationale: "Playful and unexpected: mixed scale, offset rhythm, colour used structurally.",
    nav: "minimal", hero: "poster", images: "circle", rhythm: "tight",
    typeScale: 1.25, headingCase: "none", headingTracking: "-0.04em", measure: 58,
    radius: 28, ruleWeight: 2, headingOrnament: "rule", motion: "expressive",
    buttonShape: "pill", buttonFill: "solid",
    fonts: { heading: "display", body: "grotesk" },
    emphasis: { gallery: 1 },
  },
  {
    id: "image-first",
    label: "Image-first",
    rationale: "The photography carries the site: full-bleed imagery, minimal copy over it.",
    nav: "minimal", hero: "stacked", images: "sharp", rhythm: "airy",
    typeScale: 1.05, headingCase: "none", headingTracking: "-0.01em", measure: 58,
    radius: 4, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "square", buttonFill: "outline",
    fonts: { heading: "grotesk", body: "system" },
    emphasis: { gallery: 0, hero: 0 },
  },
  {
    id: "typography-first",
    label: "Typography-first",
    rationale: "Words do the work: dramatic scale contrast, few images, immaculate rhythm.",
    nav: "centered", hero: "typographic", images: "sharp", rhythm: "airy",
    typeScale: 1.3, headingCase: "none", headingTracking: "-0.03em", measure: 60,
    radius: 0, ruleWeight: 1, headingOrnament: "rule", motion: "none",
    buttonShape: "square", buttonFill: "underline",
    fonts: { heading: "display", body: "serif" },
    emphasis: { about: 1 },
  },
  {
    id: "menu-first",
    label: "Menu-first",
    rationale: "Built for a phone at a table: the menu is the page, everything else is a footnote.",
    nav: "none", hero: "typographic", images: "soft", rhythm: "tight",
    typeScale: 0.95, headingCase: "none", headingTracking: "0em", measure: 60,
    radius: 10, ruleWeight: 1, headingOrnament: "none", motion: "none",
    buttonShape: "rounded", buttonFill: "solid",
    fonts: { heading: "system", body: "system" },
    emphasis: { menu: 0, hours: 1, contact: 2 },
  },
  {
    id: "product-first",
    label: "Product-first",
    rationale: "What is sold comes first: offerings up top, priced and scannable.",
    nav: "classic", hero: "split", images: "soft", rhythm: "measured",
    typeScale: 1.05, headingCase: "none", headingTracking: "-0.02em", measure: 62,
    radius: 12, ruleWeight: 1, headingOrnament: "none", motion: "subtle",
    buttonShape: "rounded", buttonFill: "solid",
    fonts: { heading: "grotesk", body: "system" },
    emphasis: { services: 0, menu: 0 },
  },
];

const BY_ID = new Map(ARCHITECTURES.map((a) => [a.id, a]));

export function architecture(id: string): DesignArchitecture {
  return BY_ID.get(id) ?? BY_ID.get("classic")!;
}

export const ARCHITECTURE_IDS = ARCHITECTURES.map((a) => a.id);

/** Rhythm -> concrete vertical spacing. Kept here so the renderer stays dumb. */
export const RHYTHM_SPACING: Record<SectionRhythm, { block: string; gap: string }> = {
  airy: { block: "clamp(4rem, 9vw, 8rem)", gap: "1.75rem" },
  measured: { block: "clamp(3rem, 7vw, 5.5rem)", gap: "1.25rem" },
  tight: { block: "clamp(2rem, 5vw, 3.5rem)", gap: "0.875rem" },
};
