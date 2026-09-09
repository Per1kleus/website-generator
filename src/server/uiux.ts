import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ARCHITECTURE_IDS } from "@/lib/architectures";
import { contrastRatio, repairPalette } from "@/lib/contrast";
import type { SiteKind, Theme } from "@/lib/site";
import { generateJson, getState } from "./ollama";
import type { BusinessProfile } from "./research";

const execFileAsync = promisify(execFile);

/**
 * Bridge to the vendored ui-ux-pro-max skill.
 *
 * The skill supplies the design intelligence — palettes, font pairings,
 * landing patterns, section orders, anti-patterns and constraints, drawn from
 * its catalogues. This module's job is to ask it a *good* question and map the
 * answer onto the Site theme.
 *
 * Asking well matters more than it sounds: the skill's lookup is keyword
 * based, so "greek coffee shop digital menu" comes back as a dark
 * crypto/kiosk system, while "warm artisanal cafe" comes back as the correct
 * warm bakery palette with Playfair Display. The local model exists to close
 * exactly that gap.
 */

const SKILL_DIR = path.join(process.cwd(), "vendor", "ui-ux-pro-max");
const SEARCH = path.join(SKILL_DIR, "scripts", "search.py");

export type SkillDesignSystem = {
  project_name: string;
  category: string;
  pattern: {
    name: string;
    sections: string;
    cta_placement: string;
    color_strategy: string;
    conversion: string;
  };
  style: {
    id: string;
    name: string;
    type: string;
    effects: string;
    keywords: string;
    best_for: string;
    accessibility: string;
  };
  colors: Record<string, string>;
  typography: {
    heading: string;
    body: string;
    mood: string;
    best_for: string;
    google_fonts_url: string;
    css_import: string;
  };
  key_effects: string;
  anti_patterns: string;
  constraints?: unknown;
  activated_rules?: unknown;
  spacing_scale?: unknown;
  dials?: Record<string, number>;
};

export type SkillQuery = {
  query: string;
  /** 1 = centred/minimal … 10 = bold/asymmetric */
  variance: number;
  /** 1 = subtle … 10 = complex */
  motion: number;
  /** 1 = spacious … 10 = dense */
  density: number;
  /** Where the query came from, for the creator-facing explanation. */
  source: "local-model" | "heuristic";
};

let pythonChecked = false;
let pythonOk = false;

/** The skill needs Python. A deployment without it must still generate sites. */
async function havePython(): Promise<boolean> {
  if (pythonChecked) return pythonOk;
  pythonChecked = true;
  try {
    if (!existsSync(SEARCH)) {
      console.warn("[uiux] vendored skill not found at", SEARCH);
      pythonOk = false;
      return false;
    }
    await execFileAsync("python3", ["--version"], { timeout: 5000 });
    pythonOk = true;
  } catch {
    console.warn("[uiux] python3 unavailable — skipping the design-intelligence stage.");
    pythonOk = false;
  }
  return pythonOk;
}

export async function skillAvailable(): Promise<boolean> {
  return havePython();
}

/* -------------------------------------------------------------------------
   Query construction
------------------------------------------------------------------------- */

const QUERY_SYSTEM = `You convert a business description into a short search query for a design catalogue, plus three dials.

The catalogue is keyword-matched over UI styles, colour systems, font pairings and landing patterns. A good query names the BUSINESS CATEGORY and its MOOD in plain design words.

Rules:
- query: 2 to 5 lowercase words. Name the category (cafe, bakery, restaurant, barber, dentist, law firm, gym, salon, hotel, boutique, studio, clinic...) and its mood (warm, minimal, luxury, rustic, modern, playful, elegant, industrial, natural).
- Never put the business's own name, a town, or a language in the query. Those are not design words and they poison the match.
- Never use technology words (crypto, web3, blockchain, saas, dashboard, kiosk) unless the business is literally that.
- variance: 1-10. 1 for a traditional or formal business, 10 for a bold creative one.
- motion: 1-10. 1 for a menu or a clinic, 10 for entertainment. Keep it low; this is read on phones.
- density: 1-10. 1 for a spacious brand site, 10 for a menu or price list.

Answer with JSON only: {"query":"","variance":5,"motion":3,"density":5}`;

function heuristicQuery(args: {
  profile: BusinessProfile;
  businessType: string;
  description: string;
  kind: SiteKind;
  designNotes: string;
}): SkillQuery {
  const haystack = [
    args.businessType,
    args.profile.category,
    args.profile.cuisineOrSpecialty,
    args.profile.positioning,
    args.profile.atmosphere,
    args.description,
    args.designNotes,
  ]
    .join(" ")
    .toLowerCase();

  // A small, explicit category map. It is not clever, but it is predictable,
  // and it keeps the no-model path producing sensible design systems.
  const CATEGORIES: [RegExp, string][] = [
    [/bakery|patisserie|pastry|bread/, "bakery cafe"],
    [/caf[eé]|coffee|espresso|roaster/, "cafe coffee shop"],
    [/taverna|restaurant|bistro|trattoria|dining|kitchen|grill|pizzeria|sushi/, "restaurant dining"],
    [/bar\b|pub|cocktail|wine|brewery/, "bar cocktail lounge"],
    [/barber|salon|hair|nails|beauty/, "salon beauty"],
    [/spa|massage|wellness|yoga|pilates/, "spa wellness"],
    [/gym|fitness|crossfit|training/, "gym fitness"],
    [/dentist|clinic|doctor|medical|physio|health/, "medical clinic"],
    [/law|attorney|solicitor|legal|notary/, "law firm professional"],
    [/account|consult|advisor|agency|insurance/, "professional services"],
    [/hotel|guesthouse|bnb|rooms|villa|apartment/, "hotel hospitality"],
    [/architect|studio|design|interior/, "architecture studio"],
    [/photograph|artist|gallery|portfolio/, "creative portfolio"],
    [/boutique|shop|store|retail|florist/, "boutique retail"],
    [/garage|mechanic|plumb|electric|builder|contractor/, "trade services"],
  ];

  const MOODS: [RegExp, string][] = [
    [/luxur|premium|upscale|fine|refined|elegant/, "luxury elegant"],
    [/rustic|traditional|family|homely|authentic|heritage/, "rustic warm"],
    [/minimal|clean|simple|understated/, "minimal"],
    [/modern|contemporary|sleek/, "modern"],
    [/playful|fun|colou?rful|vibrant|lively/, "playful vibrant"],
    [/industrial|concrete|steel|raw|brutal/, "industrial"],
    [/natural|organic|green|eco|sustainab/, "natural organic"],
    [/warm|cosy|cozy|friendly|welcoming/, "warm"],
  ];

  const category = CATEGORIES.find(([re]) => re.test(haystack))?.[1] ?? "local business";
  const mood = MOODS.find(([re]) => re.test(haystack))?.[1] ?? "warm";

  return {
    query: `${mood} ${category}`.trim(),
    variance: /bold|creative|experimental/.test(haystack) ? 8 : 4,
    // Phones and menus want restraint; this is a floor, not a preference.
    motion: args.kind === "menu" ? 1 : 3,
    density: args.kind === "menu" ? 9 : 4,
    source: "heuristic",
  };
}

/**
 * Builds the skill query, preferring the local model and falling back to the
 * heuristic. The model's output is validated hard — a 0.5B model will
 * occasionally return something unusable, and a bad query is worse than the
 * heuristic one.
 */
export async function buildSkillQuery(args: {
  profile: BusinessProfile;
  businessName: string;
  businessType: string;
  description: string;
  kind: SiteKind;
  designNotes: string;
}): Promise<SkillQuery> {
  const fallback = heuristicQuery(args);
  if (!getState().modelReady) return fallback;

  const brief = [
    args.businessType && `Type: ${args.businessType}`,
    args.profile.category && `Category: ${args.profile.category}`,
    args.profile.cuisineOrSpecialty && `Specialty: ${args.profile.cuisineOrSpecialty}`,
    args.profile.atmosphere && `Atmosphere: ${args.profile.atmosphere}`,
    args.profile.positioning && `Positioning: ${args.profile.positioning}`,
    args.profile.priceRange && `Price range: ${args.profile.priceRange}`,
    args.description && `Owner says: ${args.description}`,
    args.designNotes && `Wants: ${args.designNotes}`,
    `Website kind: ${args.kind}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJson<{
    query?: unknown;
    variance?: unknown;
    motion?: unknown;
    density?: unknown;
  }>(QUERY_SYSTEM, brief);

  if (!raw || typeof raw.query !== "string") return fallback;

  const cleaned = raw.query
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // Guard against the model smuggling the business name or a place in.
    .filter((w) => !args.businessName.toLowerCase().split(/\s+/).includes(w))
    .slice(0, 5)
    .join(" ")
    .trim();

  if (cleaned.split(" ").length < 2) return fallback;

  const dial = (v: unknown, min: number, max: number, dflt: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };

  return {
    query: cleaned,
    variance: dial(raw.variance, 1, 10, fallback.variance),
    // A menu is capped regardless of what the model says: motion between a
    // guest and a price is never an improvement.
    motion: args.kind === "menu" ? 1 : dial(raw.motion, 1, 6, fallback.motion),
    density: args.kind === "menu" ? 9 : dial(raw.density, 1, 10, fallback.density),
    source: "local-model",
  };
}

/* -------------------------------------------------------------------------
   Running the skill
------------------------------------------------------------------------- */

export async function runSkill(q: SkillQuery): Promise<SkillDesignSystem | null> {
  if (!(await havePython())) return null;

  try {
    const { stdout } = await execFileAsync(
      "python3",
      [
        SEARCH,
        q.query,
        "--design-system",
        "--json",
        "--variance", String(q.variance),
        "--motion", String(q.motion),
        "--density", String(q.density),
      ],
      { cwd: SKILL_DIR, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as { design_system?: SkillDesignSystem };
    return parsed.design_system ?? null;
  } catch (err) {
    console.error("[uiux] skill query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/* -------------------------------------------------------------------------
   Mapping the skill's answer onto the site theme
------------------------------------------------------------------------- */

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string) =>
  typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;

/**
 * The skill names a visual style; this maps it onto one of our architectures,
 * which is what actually drives composition. Matching is on the style's own
 * keywords so a new upstream style still lands somewhere sensible.
 */
export function architectureForStyle(style: SkillDesignSystem["style"], kind: SiteKind): string {
  if (kind === "menu") return "menu-first";

  const haystack = `${style.id} ${style.name} ${style.keywords} ${style.type}`.toLowerCase();
  const RULES: [RegExp, string][] = [
    [/brutal|neo-?brutal|raw/, "brutalist"],
    [/luxur|elegan|glamour|opulent|couture/, "luxury"],
    [/editorial|magazine|swiss|typographic-poster/, "editorial"],
    [/minimal|flat|clean|simple/, "minimal"],
    [/organic|natural|hand|craft|soft|clay/, "organic"],
    [/industrial|technical|blueprint|engineering/, "industrial"],
    [/architect|grid|structur|bauhaus/, "architectural"],
    [/mediterran|rustic|warm|earthy|terracotta/, "mediterranean"],
    [/photo|image|cinematic|immersive|full-?bleed/, "image-first"],
    [/typograph|serif|display|letter/, "typography-first"],
    [/product|commerce|catalog|shop/, "product-first"],
    [/experiment|playful|memphis|maximal|vibrant|block/, "experimental"],
    [/glass|neumorph|gradient|aurora|modern|material/, "modern"],
  ];

  for (const [re, arch] of RULES) {
    if (re.test(haystack) && ARCHITECTURE_IDS.includes(arch)) return arch;
  }
  return "classic";
}

/**
 * Section order recommended by the skill's landing pattern, mapped onto the
 * sections this app can actually render. Anything unrecognised is dropped
 * rather than guessed at.
 */
export function sectionPlanFromPattern(sections: string, kind: SiteKind): string[] {
  const MAP: [RegExp, string][] = [
    [/hero|above the fold|full-?screen/, "hero"],
    [/about|story|who we are|problem/, "about"],
    [/service|feature|benefit|offering|solution|step/, "services"],
    [/menu|dishes|price list/, "menu"],
    [/gallery|portfolio|showcase|work/, "gallery"],
    [/hour|opening|schedule/, "hours"],
    [/testimonial|review|social proof|trust/, "testimonials"],
    [/cta|call to action|action|signup|book now|conversion/, "cta"],
    [/contact|location|find us|map/, "contact"],
  ];

  const out: string[] = [];
  for (const raw of sections.split(/[>·|,]/)) {
    const piece = raw.trim().toLowerCase();
    if (!piece) continue;
    const hit = MAP.find(([re]) => re.test(piece))?.[1];
    if (hit && !out.includes(hit)) out.push(hit);
  }

  if (!out.includes("hero")) out.unshift("hero");
  // A digital menu leads with the menu whatever the pattern says.
  if (kind === "menu") {
    const rest = out.filter((s) => s !== "menu" && s !== "hero");
    return ["hero", "menu", ...rest.filter((s) => s === "hours" || s === "contact"), "footer"];
  }
  if (!out.includes("contact")) out.push("contact");
  out.push("footer");
  return out;
}

export type SkillDesign = {
  theme: Theme;
  sectionPlan: string[];
  /** Human-readable, shown to the creator so the choice is not magic. */
  rationale: string;
  styleName: string;
  patternName: string;
  antiPatterns: string;
  query: SkillQuery;
};

export function designFromSkill(
  ds: SkillDesignSystem,
  q: SkillQuery,
  kind: SiteKind,
): SkillDesign {
  const architecture = architectureForStyle(ds.style, kind);
  const c = ds.colors ?? {};

  // The catalogue's rows are contrast-paired for their own token set
  // (primary/on-primary), but this app uses `primary` as small coloured text
  // too — the hero eyebrow — so it is repaired against the page background
  // before use. Dark rows are where this bites: a dark slate primary on a
  // near-black background is invisible otherwise.
  const raw = {
    primary: hex(c.primary, "#4338ca"),
    secondary: hex(c.secondary, "#1e1b4b"),
    accent: hex(c.accent ?? c.cta, "#f59e0b"),
    bg: hex(c.background, "#ffffff"),
    text: hex(c.foreground ?? c.text, "#16161d"),
  };

  // Dark catalogue rows often set `primary` as a surface colour close to the
  // background and carry the real call-to-action in `accent` (the row's own
  // `cta` field agrees). Swapping is a better answer than desaturating a
  // primary that was never meant to be a button: it keeps the palette vivid
  // and readable instead of merely readable.
  if (contrastRatio(raw.primary, raw.bg) < 4.5 && contrastRatio(raw.accent, raw.bg) >= 4.5) {
    [raw.primary, raw.accent] = [raw.accent, raw.primary];
  }

  const colors = repairPalette(raw);

  return {
    theme: {
      colors,
      // Google font families come from the skill; the renderer falls back to
      // its own stacks if they cannot be loaded.
      fonts: { heading: "system", body: "system" },
      fontFamilies:
        kind === "menu"
          ? null // a menu must not wait on a webfont before showing prices
          : {
              heading: ds.typography?.heading ?? "",
              body: ds.typography?.body ?? "",
              url: ds.typography?.google_fonts_url ?? "",
            },
      layout: q.density >= 7 ? "dense" : q.density <= 3 ? "minimal" : "balanced",
      radius: architecture === "brutalist" || architecture === "minimal" ? 2 : 12,
      architecture,
    },
    sectionPlan: sectionPlanFromPattern(ds.pattern?.sections ?? "", kind),
    rationale: `${ds.category} · ${ds.style?.name ?? "style"} · ${ds.pattern?.name ?? "pattern"}`,
    styleName: ds.style?.name ?? "",
    patternName: ds.pattern?.name ?? "",
    antiPatterns: ds.anti_patterns ?? "",
    query: q,
  };
}

/** One call: build the query, run the skill, map the result. Never throws. */
export async function analyseWithSkill(args: {
  profile: BusinessProfile;
  businessName: string;
  businessType: string;
  description: string;
  kind: SiteKind;
  designNotes: string;
}): Promise<SkillDesign | null> {
  if (!(await havePython())) return null;
  const query = await buildSkillQuery(args);
  const ds = await runSkill(query);
  if (!ds) return null;
  return designFromSkill(ds, query, args.kind);
}
