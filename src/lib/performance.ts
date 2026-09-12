import type { ImagePlacement, Site } from "./site";

/**
 * Deterministic performance assessment.
 *
 * This is not Lighthouse and never claims to be. Lighthouse measures a real
 * page load on real hardware; nothing here does, and a number that pretended
 * otherwise would be worse than no number at all. What this measures is the
 * set of properties the application can actually see — the bytes it is about
 * to ship, the dimensions it recorded at upload, the loading hints it emitted,
 * the stylesheet it generated — and those properties are exactly the ones the
 * application can also fix.
 *
 * Everywhere it is shown it is labelled a project score, out of 100, with
 * every deduction named. See `docs/READINESS.md`.
 */

export type PerfCategoryId =
  | "images"
  | "weight"
  | "critical"
  | "stability"
  | "fonts"
  | "code";

export type PerfFinding = {
  id: string;
  category: PerfCategoryId;
  level: "warning" | "info";
  /** What was measured, in the creator's language. */
  issue: string;
  /** What to do about it. */
  correction: string;
  /** Points taken off this category. */
  cost: number;
};

export type PerfCategory = {
  id: PerfCategoryId;
  label: string;
  /** Points available. */
  max: number;
  /** Points scored. */
  score: number;
  /** True when the category does not apply — a site with no photographs. */
  notApplicable: boolean;
};

export type PerfReport = {
  /** 0–100, deterministic, this application's own measure. */
  score: number;
  categories: PerfCategory[];
  findings: PerfFinding[];
  /** The measurements the score was computed from, for the report. */
  measured: {
    htmlBytes: number;
    cssBytes: number;
    scriptBytes: number;
    imageBytes: number;
    imageCount: number;
    totalBytes: number;
    fontRequests: number;
    fontWeights: number;
    lazyImages: number;
    priorityImages: number;
    imagesWithDimensions: number;
    heroPreloaded: boolean;
  };
};

export type PerfInput = {
  site: Site;
  /** The rendered page. Without it only the document can be judged. */
  html?: string;
  /** Real sizes from the assets table, keyed by asset id. */
  images?: Record<string, { width: number; height: number; bytes: number }>;
};

/* -------------------------------------------------------------------------
   Budgets
------------------------------------------------------------------------- */

/**
 * What a small business website should weigh.
 *
 * These are not arbitrary: a generated site here is one HTML document with an
 * inline stylesheet and a handful of photographs, and it is read on a phone on
 * mobile data, often outdoors, often on a slow connection. 1.5MB of images is
 * already generous for that; 250KB of document is generous twice over.
 */
const BUDGET = {
  /** Bytes of HTML including the inline stylesheet. */
  document: 250_000,
  /** Bytes of photographs on one page. */
  images: 1_500_000,
  /** Bytes for any single photograph. */
  singleImage: 400_000,
  /** A hero can be bigger; it is the one that has to look good full-bleed. */
  heroImage: 600_000,
  /** Font files are a request each, and each one blocks text. */
  fontWeights: 4,
} as const;

const CATEGORY_MAX: Record<PerfCategoryId, number> = {
  images: 30,
  weight: 20,
  critical: 15,
  stability: 20,
  fonts: 10,
  code: 5,
};

const CATEGORY_LABEL: Record<PerfCategoryId, string> = {
  images: "Image optimisation",
  weight: "Asset weight",
  critical: "Critical resource loading",
  stability: "Layout stability",
  fonts: "Font efficiency",
  code: "Generated-code efficiency",
};

const bytes = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_048_576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;

/** The document without its stylesheet or scripts, for counting real tags. */
function markup(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function sumBlocks(html: string, tag: "style" | "script"): number {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let total = 0;
  for (const m of html.matchAll(re)) total += m[1].length;
  return total;
}

/* -------------------------------------------------------------------------
   The assessment
------------------------------------------------------------------------- */

export function assessPerformance(input: PerfInput): PerfReport {
  const { site, html } = input;
  const placements: ImagePlacement[] = site.images ?? [];
  const findings: PerfFinding[] = [];
  const add = (f: PerfFinding) => findings.push(f);

  /* ------------------------------------------------------- measurements */

  const imgTags = html ? [...markup(html).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]) : [];
  const sized = imgTags.filter((t) => /\bwidth="/.test(t) && /\bheight="/.test(t));
  const lazy = imgTags.filter((t) => /loading="lazy"/.test(t));
  const priority = imgTags.filter((t) => /fetchpriority="high"/.test(t));

  const perImage = placements.map((p) => ({
    placement: p,
    size: input.images?.[p.assetId] ?? { width: p.width, height: p.height, bytes: 0 },
  }));
  const imageBytes = perImage.reduce((sum, i) => sum + i.size.bytes, 0);

  const cssBytes = html ? sumBlocks(html, "style") : 0;
  const scriptBytes = html ? sumBlocks(html, "script") : 0;
  const htmlBytes = html ? html.length : 0;

  const fontUrl = site.theme.fontFamilies?.url ?? "";
  const weightList = /wght@([\d;,.]+)/.exec(fontUrl)?.[1] ?? "";
  const fontWeights = weightList ? weightList.split(";").filter(Boolean).length : fontUrl ? 1 : 0;
  const fontRequests = fontUrl ? 1 : 0;
  const heroPreloaded = html ? /rel="preload"[^>]*as="image"/.test(html) : false;

  const measured = {
    htmlBytes,
    cssBytes,
    scriptBytes,
    imageBytes,
    imageCount: placements.length,
    totalBytes: htmlBytes + imageBytes,
    fontRequests,
    fontWeights,
    lazyImages: lazy.length,
    priorityImages: priority.length,
    imagesWithDimensions: sized.length,
    heroPreloaded,
  };

  /* ------------------------------------------------------------ images */

  // A site whose business supplied no photographs is not failing at image
  // optimisation; it has no images to optimise. Saying "30/30" would be
  // inventing a pass, so the category stands aside instead.
  const hasImages = placements.length > 0;

  if (hasImages) {
    for (const { placement, size } of perImage) {
      const limit = placement.role === "hero" ? BUDGET.heroImage : BUDGET.singleImage;
      if (size.bytes > limit) {
        add({
          id: `image-heavy:${placement.assetId}`,
          category: "images",
          level: "warning",
          issue: `A ${placement.role} photograph is ${bytes(size.bytes)}, over the ${bytes(limit)} this page budgets for one.`,
          correction: "Re-upload it; the upload pipeline caps photographs at 2000px and WebP quality 80.",
          cost: 4,
        });
      }
      // A photograph far larger than the box it is drawn in is bytes the
      // visitor downloads and the browser then throws away.
      const widest = placement.role === "hero" ? 1440 : 720;
      if (size.width > widest * 2.2) {
        add({
          id: `image-oversized:${placement.assetId}`,
          category: "images",
          level: "warning",
          issue: `A ${placement.role} photograph is ${size.width}px wide but is never drawn wider than about ${widest}px.`,
          correction: "Re-upload it at a smaller size, or leave it — the extra detail only costs bytes.",
          cost: 2,
        });
      }
    }

    if (imgTags.length > 1 && priority.length > 1) {
      add({
        id: "too-many-priority",
        category: "images",
        level: "warning",
        issue: `${priority.length} images are marked high priority, so they compete for the same bandwidth.`,
        correction: "Prioritise only the image at the top of the page.",
        cost: 4,
      });
    }
    const belowFold = imgTags.slice(1).filter((t) => !/loading="lazy"/.test(t) && !/fetchpriority="high"/.test(t));
    if (belowFold.length) {
      add({
        id: "not-lazy",
        category: "images",
        level: "warning",
        issue: `${belowFold.length} image${belowFold.length === 1 ? " is" : "s are"} loaded eagerly below the first screen.`,
        correction: "Mark everything below the fold as lazy.",
        cost: 3,
      });
    }
    const noFocal = placements.filter((p) => p.focalX === 0.5 && p.focalY === 0.5).length;
    if (noFocal === placements.length && placements.length > 1) {
      add({
        id: "no-focal-points",
        category: "images",
        level: "info",
        issue: "No photograph has a measured focal point, so every crop falls back to the centre.",
        correction: "Re-upload them; the focal point is measured once, at upload.",
        cost: 0,
      });
    }
  }

  /* ------------------------------------------------------------ weight */

  if (measured.totalBytes > BUDGET.document + BUDGET.images) {
    const over = measured.totalBytes - (BUDGET.document + BUDGET.images);
    add({
      id: "page-heavy",
      category: "weight",
      level: "warning",
      issue: `The page weighs ${bytes(measured.totalBytes)}, ${bytes(over)} over its budget.`,
      correction: "Remove or replace the largest photographs.",
      // Proportional to how far over, so one big picture is not the same
      // finding as ten.
      cost: Math.min(12, 4 + Math.floor(over / 500_000) * 4),
    });
  }
  if (htmlBytes > BUDGET.document) {
    add({
      id: "document-heavy",
      category: "weight",
      level: "warning",
      issue: `The HTML document is ${bytes(htmlBytes)}, over the ${bytes(BUDGET.document)} budget.`,
      correction: "Shorten the longest sections, or split the page.",
      cost: 4,
    });
  }

  /* ---------------------------------------------------------- critical */

  if (hasImages && placements.some((p) => p.role === "hero") && html && !heroPreloaded) {
    add({
      id: "hero-not-preloaded",
      category: "critical",
      level: "warning",
      issue: "The hero photograph is not preloaded, so it starts downloading only after the stylesheet.",
      correction: "Emit a preload hint for the hero image.",
      cost: 5,
    });
  }
  if (html) {
    // Anything that blocks the first paint and is not this app's own inline
    // stylesheet: the font sheet is loaded non-blocking, so a blocking one is
    // a regression worth naming.
    const blocking = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => !/media="print"/.test(tag));
    if (blocking.length) {
      add({
        id: "render-blocking-css",
        category: "critical",
        level: "warning",
        issue: `${blocking.length} stylesheet${blocking.length === 1 ? "" : "s"} block the first paint.`,
        correction: "Load them the way the font sheet is loaded, or inline them.",
        cost: 5,
      });
    }
    const externalScripts = [...html.matchAll(/<script[^>]+src=/gi)].length;
    if (externalScripts) {
      add({
        id: "external-scripts",
        category: "critical",
        level: "warning",
        issue: `${externalScripts} external script${externalScripts === 1 ? "" : "s"} are requested.`,
        correction: "A generated site should need none.",
        cost: 5,
      });
    }
  }

  /* --------------------------------------------------------- stability */

  if (imgTags.length && sized.length < imgTags.length) {
    const missing = imgTags.length - sized.length;
    add({
      id: "unsized-images",
      category: "stability",
      level: "warning",
      issue: `${missing} image${missing === 1 ? "" : "s"} render without width and height, so the page jumps as they load.`,
      correction: "Emit the real pixel dimensions on every image.",
      // The single biggest cause of layout shift, and entirely avoidable.
      cost: Math.min(20, missing * 7),
    });
  }
  if (html && imgTags.length && !/aspect-ratio:/.test(html)) {
    add({
      id: "no-aspect-ratio",
      category: "stability",
      level: "warning",
      issue: "Image boxes do not declare an aspect ratio, so their height is only known once they load.",
      correction: "Give each image role a ratio in the stylesheet.",
      cost: 6,
    });
  }
  if (fontRequests && html && !/display=swap/.test(html)) {
    add({
      id: "font-blocks-text",
      category: "stability",
      level: "warning",
      issue: "The web font is loaded without display=swap, so text stays invisible until it arrives.",
      correction: "Add display=swap to the font URL.",
      cost: 6,
    });
  }

  /* ------------------------------------------------------------- fonts */

  if (fontWeights > BUDGET.fontWeights) {
    add({
      id: "too-many-weights",
      category: "fonts",
      level: "warning",
      issue: `${fontWeights} font weights are requested; the design sets two.`,
      correction: "Request only the weights the design uses.",
      cost: Math.min(6, (fontWeights - BUDGET.fontWeights) * 2),
    });
  }
  if (fontRequests > 1) {
    add({
      id: "many-font-requests",
      category: "fonts",
      level: "warning",
      issue: `${fontRequests} font stylesheets are requested.`,
      correction: "One request can carry both families.",
      cost: 4,
    });
  }
  if (html && fontRequests && !/preconnect/.test(html)) {
    add({
      id: "no-preconnect",
      category: "fonts",
      level: "warning",
      issue: "The font host is not preconnected, so the connection is set up only when the stylesheet is parsed.",
      correction: "Preconnect to the font host.",
      cost: 2,
    });
  }

  /* -------------------------------------------------------------- code */

  if (cssBytes > 60_000) {
    add({
      id: "css-large",
      category: "code",
      level: "warning",
      issue: `The generated stylesheet is ${bytes(cssBytes)}.`,
      correction: "Emit only the rules the chosen layouts need.",
      cost: 3,
    });
  }
  if (scriptBytes > 8_000) {
    add({
      id: "script-large",
      category: "code",
      level: "warning",
      issue: `The generated page carries ${bytes(scriptBytes)} of script.`,
      correction: "A generated site should need almost none.",
      cost: 2,
    });
  }

  /* ------------------------------------------------------------- score */

  const categories: PerfCategory[] = (Object.keys(CATEGORY_MAX) as PerfCategoryId[]).map((id) => {
    const notApplicable = id === "images" && !hasImages;
    const spent = findings.filter((f) => f.category === id).reduce((sum, f) => sum + f.cost, 0);
    return {
      id,
      label: CATEGORY_LABEL[id],
      max: CATEGORY_MAX[id],
      score: notApplicable ? 0 : Math.max(0, CATEGORY_MAX[id] - spent),
      notApplicable,
    };
  });

  // A category that does not apply is removed from the denominator rather than
  // given away: a site with no photographs is scored out of the 70 points it
  // can actually earn, then expressed out of 100.
  const available = categories.filter((c) => !c.notApplicable).reduce((s, c) => s + c.max, 0);
  const earned = categories.filter((c) => !c.notApplicable).reduce((s, c) => s + c.score, 0);
  const score = available === 0 ? 100 : Math.round((earned / available) * 100);

  return { score, categories, findings, measured };
}
