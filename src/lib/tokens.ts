import { architecture, type DesignArchitecture } from "./architectures";
import type { DesignTokens, LayoutDensity, SiteKind } from "./site";

/**
 * The design system engine.
 *
 * One website, one coherent visual language. This turns the design direction
 * already chosen — the architecture from lib/architectures.ts, the
 * ui-ux-pro-max catalogue's style, the identity analysis's reading of the real
 * place, and what content the business actually has — into the full set of
 * decisions a designer would make once and then apply everywhere: how type is
 * scaled and weighted, how the page breathes, what is round and what is not,
 * whether there are cards at all, how much the page moves.
 *
 * Two rules govern everything here:
 *
 *   It is deterministic. The same inputs always produce the same design. There
 *   is no randomness, because "different" is not the goal — *intentional* is.
 *   Two similar businesses with similar content should look similar; that is
 *   correct, not a bug.
 *
 *   It is not AI. Every value below is a rule you can read, argue with and
 *   test. The hosted model's job was understanding the business; executing
 *   that understanding consistently is what code is for.
 */

/** What the business is like, in the few dimensions that change a design. */
export type DesignSignals = {
  /** Formal and understated at one end, loud and energetic at the other. */
  formality: number; // 0..1, 1 = most formal
  energy: number; // 0..1, 1 = most energetic
  /** How much there is to read. Information-heavy pages need tighter rhythm. */
  informationDensity: number; // 0..1
  /** How much of the story is carried by pictures. */
  visualWeight: number; // 0..1
  /** Craft, heritage, hand-made — as against corporate or technical. */
  warmth: number; // 0..1
};

export const NEUTRAL_SIGNALS: DesignSignals = {
  formality: 0.5,
  energy: 0.5,
  informationDensity: 0.5,
  visualWeight: 0.5,
  warmth: 0.5,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, places = 2) => Number(value.toFixed(places));

/* -------------------------------------------------------------------------
   Reading the business
------------------------------------------------------------------------- */

/**
 * Words that genuinely move a design decision, drawn from the business type,
 * the identity analysis and the catalogue's own style vocabulary.
 *
 * This is a lookup, not a language model: it turns text the pipeline already
 * produced into five numbers, and anything it does not recognise leaves the
 * neutral value alone.
 */
/**
 * Words that genuinely move a design decision, drawn from the business type,
 * the identity analysis and the research.
 *
 * Every alternative is anchored with a word boundary. Without it short tokens
 * match inside ordinary words — "ai" inside "tr**ai**ning" read a gym as a
 * technology company, and quietly halved its energy — so the boundary is not
 * tidiness, it is the difference between a signal and a coincidence. Trailing
 * truncation ("luxur", "consultan") is deliberate, to catch inflections.
 *
 * This is a lookup, not a language model: it turns text the pipeline already
 * produced into five numbers, and anything it does not recognise leaves the
 * neutral value alone.
 */
const LEXICON: { words: RegExp; signal: Partial<DesignSignals> }[] = [
  {
    words: /\b(luxur|premium|fine dining|boutique|couture|bespoke|exclusive|gilded|elegant|refined|michelin)/i,
    signal: { formality: 0.9, energy: 0.25, visualWeight: 0.7 },
  },
  {
    words: /\b(law|legal|solicitor|advocate|litigation|accountan|accountancy|audit|tax|notary|insurance|consultan|advisory|financ|bookkeep)/i,
    signal: { formality: 0.9, energy: 0.2, informationDensity: 0.85, visualWeight: 0.2 },
  },
  {
    words: /\b(gym|fitness|crossfit|training|bootcamp|martial|boxing|athletic|performance|barbell|strength)/i,
    signal: { formality: 0.3, energy: 0.95, visualWeight: 0.7 },
  },
  {
    words: /\b(taverna|trattoria|bistro|family|traditional|heritage|artisan|handmade|bakery|farm|village|kafeneio)/i,
    signal: { warmth: 0.9, formality: 0.4, energy: 0.4 },
  },
  {
    words: /\b(detailing|studio|gallery|photograph|architect|interior|portfolio|atelier|showcase|ceramic coating)/i,
    signal: { visualWeight: 0.9, formality: 0.65, informationDensity: 0.3 },
  },
  {
    words: /\b(software|saas|tech|technology|digital|platform|data|cyber|startup|engineer)\b/i,
    signal: { formality: 0.6, energy: 0.6, informationDensity: 0.7, visualWeight: 0.3, warmth: 0.2 },
  },
  {
    words: /\b(clinic|dental|medical|doctor|physio|therap|care|veterinar)\b/i,
    signal: { formality: 0.75, energy: 0.3, informationDensity: 0.7, warmth: 0.6 },
  },
  {
    words: /\b(hotel|resort|spa|retreat|villa|suites)\b/i,
    signal: { formality: 0.85, energy: 0.25, visualWeight: 0.85 },
  },
  {
    words: /\b(barber|salon|tattoo|nail|beauty|hair)\b/i,
    signal: { energy: 0.65, visualWeight: 0.7, formality: 0.4 },
  },
  {
    words: /\b(cafe|coffee|roaster|espresso|patisserie|deli)\b/i,
    signal: { warmth: 0.8, energy: 0.45, visualWeight: 0.65 },
  },
];

/**
 * Turn everything the pipeline knows about a business into design signals.
 *
 * `text` is whatever describes it — type, description, atmosphere, brand
 * personality, the catalogue's style keywords. `content` is what the business
 * actually has, which matters as much as what it is: an image-led design for a
 * business with no photographs is a worse design, not a braver one.
 */
export function readSignals(args: {
  text: string;
  /** Counts of the real material available. */
  content?: {
    services: number;
    menuItems: number;
    images: number;
    testimonials: number;
    words: number;
  };
}): DesignSignals {
  const signals = { ...NEUTRAL_SIGNALS };
  const text = args.text ?? "";

  // Each match moves the signal most of the way toward its value rather than
  // averaging with the neutral start — a law firm should come out genuinely
  // formal on one match — while a second match still pulls it back, so
  // "traditional family taverna" keeps both its warmth and its calm.
  for (const entry of LEXICON) {
    if (!entry.words.test(text)) continue;
    for (const [k, v] of Object.entries(entry.signal) as [keyof DesignSignals, number][]) {
      signals[k] = round(signals[k] + (v - signals[k]) * 0.75, 3);
    }
  }

  const c = args.content;
  if (c) {
    // What exists outweighs what the words suggest: these are facts.
    if (c.images >= 6) signals.visualWeight = Math.max(signals.visualWeight, 0.8);
    else if (c.images === 0) signals.visualWeight = Math.min(signals.visualWeight, 0.3);

    const items = c.services + c.menuItems;
    if (items >= 12) signals.informationDensity = Math.max(signals.informationDensity, 0.8);
    else if (items <= 2) signals.informationDensity = Math.min(signals.informationDensity, 0.35);

    if (c.words >= 600) signals.informationDensity = Math.max(signals.informationDensity, 0.7);
  }

  return signals;
}

/* -------------------------------------------------------------------------
   Deriving the system
------------------------------------------------------------------------- */

/**
 * Build the design system.
 *
 * The architecture is the spine — it already encodes a composed point of view,
 * and nothing here overrides it wholesale. The signals bend it: the same
 * "editorial" architecture is set tighter and heavier for a gym than for a
 * law firm, while staying recognisably editorial.
 */
export function deriveTokens(args: {
  architectureId: string;
  kind: SiteKind;
  signals: DesignSignals;
  /** Density the layout engine asked for, when it has an opinion. */
  density?: LayoutDensity;
  /** The catalogue's style keywords, so its direction reaches the tokens. */
  styleKeywords?: string;
}): DesignTokens {
  const a: DesignArchitecture = architecture(args.architectureId);
  const s = args.signals;
  const keywords = (args.styleKeywords ?? "").toLowerCase();

  // A digital menu is read standing up, at a table, one-handed. Its design
  // system is decided by that, not by the business's personality.
  const isMenu = args.kind === "menu";

  const density: LayoutDensity =
    args.density ??
    (isMenu
      ? "dense"
      : s.informationDensity > 0.7
        ? "dense"
        : s.informationDensity < 0.4 && s.formality > 0.6
          ? "minimal"
          : "balanced");

  /* ---- Type. Formality lowers weight and opens tracking; energy does the
     opposite. The architecture's own scale is the anchor. ---- */
  const headingWeight = Math.round(
    clamp(500 + s.energy * 350 - s.formality * 120, 400, 900) / 50,
  ) * 50;
  // Body weight stays regular: legibility at small sizes is not a place to
  // express personality, and every architecture agrees on that.
  const bodyWeight = 400;

  const scale = round(
    clamp(a.typeScale * (1 + (s.energy - 0.5) * 0.18 - (s.informationDensity - 0.5) * 0.12), 0.85, 1.45),
  );

  const ratio = round(clamp(1.18 + s.energy * 0.16 - s.informationDensity * 0.08, 1.12, 1.36), 3);

  const headingTracking = s.formality > 0.75 && a.headingCase !== "upper"
    ? "-0.015em"
    : a.headingTracking;

  const measure = Math.round(
    clamp(a.measure + (s.informationDensity - 0.5) * 12 - (s.visualWeight - 0.5) * 6, 52, 78),
  );

  /* ---- Rhythm. Whitespace is a decision: generous when the design is
     carried by a few strong things, tighter when there is a lot to read. ---- */
  const rhythmBase = { airy: 5.5, measured: 4.25, tight: 3.25 }[a.rhythm];
  const densityFactor = { minimal: 1.15, balanced: 1, dense: 0.82 }[density];
  const section = round(
    clamp(rhythmBase * densityFactor * (1 + (s.formality - 0.5) * 0.2), 2.4, 7),
  );
  const gap = round(clamp(section / (density === "dense" ? 4.2 : 3.2), 0.75, 2), 2);
  const container = isMenu ? 46 : Math.round(clamp(72 - s.visualWeight * 8 + s.informationDensity * 4, 58, 78));

  /* ---- Shape. Radius is per role, never one global number: reserving the
     round treatment is what keeps a page from reading as a sheet of pills. ---- */
  const base = a.radius;
  const rounded = /round|friendly|playful|soft|bubbl/.test(keywords);
  const sharp = /brutal|editorial|architect|swiss|industrial|luxur|minimal/.test(keywords);
  const cardRadius = Math.round(
    clamp(base * (rounded ? 1.4 : sharp ? 0.3 : 1) - s.formality * 4, 0, 20),
  );
  const buttonRadius =
    a.buttonShape === "pill" ? 999 : a.buttonShape === "square" ? 0 : Math.max(cardRadius, 6);
  const imageRadius = a.images === "sharp" ? 0 : a.images === "circle" ? 999 : cardRadius;

  const shadow: DesignTokens["shape"]["shadow"] =
    s.formality > 0.7 || sharp
      ? cardRadius === 0
        ? "none"
        : "hairline"
      : s.energy > 0.7
        ? "lifted"
        : "soft";

  /* ---- Surfaces. Whether this business gets cards at all. A card is a
     container for things that are genuinely alike and countable; prose and
     single statements are not that, and boxing them is the single clearest
     sign of a template. ---- */
  const card: DesignTokens["surface"]["card"] =
    s.formality > 0.75 && s.energy < 0.4
      ? "none"
      : sharp
        ? "border"
        : s.energy > 0.7
          ? "raised"
          : "tint";

  const divider: DesignTokens["surface"]["divider"] =
    a.headingOrnament === "rule" || s.informationDensity > 0.7 ? "rule" : "space";

  /* ---- Motion. The architecture's budget, damped by formality and lifted by
     energy, and always none for a menu. ---- */
  const motion: DesignTokens["motion"] = isMenu
    ? "none"
    : a.motion === "none"
      ? "none"
      : s.energy > 0.72
        ? "expressive"
        : s.formality > 0.72
          ? "subtle"
          : a.motion;

  const ratioName: DesignTokens["image"]["ratio"] =
    s.visualWeight > 0.75 ? "wide" : s.warmth > 0.7 ? "portrait" : s.formality > 0.7 ? "landscape" : "square";

  return {
    type: {
      scale,
      ratio,
      headingWeight,
      bodyWeight,
      headingTracking,
      bodyTracking: s.formality > 0.8 ? "0.01em" : "0",
      headingLeading: round(clamp(1.22 - scale * 0.08, 0.95, 1.2), 2),
      bodyLeading: round(clamp(1.5 + s.informationDensity * 0.2, 1.45, 1.75), 2),
      headingCase: a.headingCase,
      measure,
    },
    space: { step: 0.5, section, gap, container },
    shape: {
      card: cardRadius,
      button: buttonRadius,
      image: imageRadius,
      input: Math.min(cardRadius, 10),
      border: a.ruleWeight,
      shadow,
      buttonShape: a.buttonShape,
      buttonFill: a.buttonFill,
    },
    surface: {
      card,
      divider,
      // Banding earns its place when there is enough content for a page to
      // need chapters, and gets in the way when there is not.
      banding: !isMenu && s.informationDensity > 0.6 && s.visualWeight < 0.7,
    },
    image: { treatment: a.images, ratio: ratioName },
    motion,
    density,
  };
}

/**
 * The tokens a document without any should be rendered with.
 *
 * Existing sites predate this system; rendering them from their architecture
 * alone reproduces exactly what they looked like before.
 */
export function tokensForArchitecture(id: string, kind: SiteKind): DesignTokens {
  return deriveTokens({ architectureId: id, kind, signals: NEUTRAL_SIGNALS });
}
