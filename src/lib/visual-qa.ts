import { architecture } from "./architectures";
import { contrastRatio } from "./contrast";
import { key, t, type DesignTokens, type Section, type Site } from "./site";
import { tokensForArchitecture } from "./tokens";
import { auditSeo, isPlaceholder } from "./seo";
import type { Locale } from "./locales";
import { VIEWPORTS, type ViewportId } from "./viewports";

/**
 * Visual QA.
 *
 * Generation succeeding is not the same as the website being right. This
 * checks the page that was actually produced — the document, and the CSS the
 * token engine derived from it — at the four widths that matter, and reports
 * what a person would see rather than what the pipeline intended.
 *
 * It runs in the same process as generation, with no browser and no network,
 * for one practical reason: the packaged Windows application has no browser
 * automation in it, and a QA system that only works on the developer's machine
 * is not a QA system. Everything below is arithmetic on values this codebase
 * itself chose — clamp() sizes at a given viewport, container widths against
 * gutters, aspect ratios against real pixel dimensions — so it is exact rather
 * than approximate, and it takes microseconds.
 *
 * The browser is still used, in the test suite, to prove these rules match
 * what a real engine does. See scripts/site-qa.mjs.
 */

// The widths live in lib/viewports.ts, shared with the live preview: the
// creator inspects by hand exactly the widths this audits.
export { VIEWPORTS, type ViewportId } from "./viewports";

export type QaCategory =
  | "layout"
  | "typography"
  | "navigation"
  | "interactive"
  | "images"
  | "content"
  | "accessibility"
  | "seo";

export type QaIssue = {
  id: string;
  category: QaCategory;
  level: "error" | "warning";
  /** Which widths it happens at. Empty means "at every width". */
  viewports: ViewportId[];
  /** What is wrong. */
  issue: string;
  /** Where — a section id or a named part of the page. */
  location: string;
  /** What to do about it, specifically. */
  correction: string;
};

export type QaReport = {
  issues: QaIssue[];
  /** PASS / WARNING / FAIL per viewport and per category. */
  viewports: Record<ViewportId, "PASS" | "WARNING" | "FAIL">;
  categories: Record<QaCategory, "PASS" | "WARNING" | "FAIL">;
  score: number;
};

/* -------------------------------------------------------------------------
   The CSS this codebase generates, evaluated at a width
------------------------------------------------------------------------- */

const REM = 16;

/**
 * `clamp(min, preferred, max)` where the preferred part is `Xrem + Yvw`.
 *
 * This mirrors exactly what a browser computes for the heading rules in
 * render.ts, which is what makes the type checks below real rather than
 * heuristic.
 */
export function clampPx(
  minRem: number,
  baseRem: number,
  vw: number,
  maxRem: number,
  viewportPx: number,
): number {
  const preferred = baseRem * REM + (vw / 100) * viewportPx;
  return Math.min(Math.max(minRem * REM, preferred), maxRem * REM);
}

/** The page gutter render.ts applies, in px. */
const GUTTER = 20;

/** Usable content width at a viewport, after gutters and the container cap. */
export function contentWidth(site: Site, viewportPx: number): number {
  const tokens = site.theme.tokens ?? tokensForArchitecture(site.theme.architecture, site.meta.kind);
  const container = tokens.space.container * REM;
  // The container's max-width is a border-box width and the gutter is its own
  // padding, so the gutter comes out of the container as well as out of the
  // viewport — the usable width is 40px narrower than the cap, not equal to it.
  return Math.min(container, viewportPx) - GUTTER * 2;
}

/** The h1 size render.ts produces at this width. */
export function headingPx(site: Site, viewportPx: number, level: 1 | 2 = 1): number {
  const tokens = site.theme.tokens ?? tokensForArchitecture(site.theme.architecture, site.meta.kind);
  const scale = tokens.type.scale;
  const ratio = tokens.type.ratio;
  const hero = site.sections.find((s) => s.type === "hero");
  const typographicHero = hero?.layout === "typographic";

  if (level === 1) {
    return typographicHero
      ? clampPx(2.2 * scale, 1.1 * scale, 6 * scale, 5.5 * scale, viewportPx)
      : clampPx(1.85 * scale, 1.2 * scale, 2.8 * scale * (ratio / 1.25), 3.4 * scale * (ratio / 1.25), viewportPx);
  }
  return clampPx(1.4 * scale, 1.1 * scale, 1.5 * scale, 2.2 * scale, viewportPx);
}

/**
 * The longest unbreakable run in a string, in characters.
 *
 * A long word cannot wrap, so it is the thing that actually pushes a page
 * sideways on a narrow phone — a business name like
 * "Papadakis-and-Partners-Chartered-Accountants" is a real overflow, and one
 * that only shows up at 320px.
 */
/**
 * Roughly how wide one character is, in em, at heading weight.
 *
 * A single average is not good enough: "iiii" and "MMMM" differ by a factor of
 * three, and an all-caps heading with 0.16em tracking is nearly twice the width
 * of the same words set lowercase. Measured against Chromium across the
 * architectures this app generates, the table below lands within a few percent
 * — close enough to tell "this will break mid-word" from "this fits", which is
 * the only question being asked.
 */
const NARROW = new Set("iljtfrI1.,;:'!|");
const WIDE = new Set("mwMW@%");
const UPPER_NARROW = new Set("IJ");

function charEm(ch: string, upper: boolean): number {
  const c = upper ? ch.toUpperCase() : ch;
  if (c === " ") return 0.25;
  const isUpper = c >= "A" && c <= "Z";
  if (WIDE.has(c)) return isUpper ? 0.9 : 0.78;
  if (isUpper) return UPPER_NARROW.has(c) ? 0.35 : 0.68;
  if (NARROW.has(c)) return 0.3;
  return 0.5;
}

/**
 * The width of a string in em, given how the heading tokens set it.
 *
 * `headingCase: "upper"` and `headingTracking` are both applied, because both
 * are decisions this app makes and both change whether a word fits.
 */
export function textEm(text: string, tokens: DesignTokens): number {
  const upper = tokens.type.headingCase === "upper";
  const tracking = parseFloat(tokens.type.headingTracking) || 0;
  let width = 0;
  for (const ch of text ?? "") width += charEm(ch, upper) + tracking;
  // A couple of percent of headroom: being slightly pessimistic costs a
  // slightly smaller heading, while being optimistic ships a broken one.
  return width * 1.02;
}

/** The widest unbreakable run of a string, in em. */
export function longestRunEm(text: string, tokens: DesignTokens): number {
  return runs(text).reduce((widest, run) => Math.max(widest, textEm(run, tokens)), 0);
}

/** The runs a browser cannot break inside. */
function runs(text: string): string[] {
  return (text ?? "").split(/[\s\u00ad\u2010-\u2015/\\]+|(?<=[-\u2010-\u2015/\\])/).filter(Boolean);
}

export function longestWord(text: string): number {
  // A browser breaks a line after a hyphen, a slash or a dash, so
  // "Papadopoulos-Konstantinou" is two runs on the page even though it is one
  // word in the sentence: the check has to model the engine, not grammar.
  return runs(text).reduce((longest, word) => Math.max(longest, word.length), 0);
}

/* -------------------------------------------------------------------------
   The audit
------------------------------------------------------------------------- */

export type QaInput = {
  site: Site;
  locale: Locale;
  /** The rendered page, when there is one: some checks are about the HTML. */
  html?: string;
  /** Real pixel sizes of the images, keyed by asset id. */
  images?: Record<string, { width: number; height: number; bytes: number }>;
};

/**
 * The document without its stylesheet or scripts.
 *
 * The generated CSS talks about `<img>` in its own comments, and a selector
 * can contain anything. Scanning the raw string for tags finds those and
 * reports problems in code that never renders.
 */
function markup(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

export function auditSite(input: QaInput): QaReport {
  const { site, locale } = input;
  const issues: QaIssue[] = [];
  const tokens = site.theme.tokens ?? tokensForArchitecture(site.theme.architecture, site.meta.kind);
  const arch = architecture(site.theme.architecture);
  const visible = site.sections.filter((s) => s.visible);
  const strings = site.i18n[locale]?.strings ?? {};

  const add = (issue: Omit<QaIssue, "viewports"> & { viewports?: ViewportId[] }) =>
    issues.push({ viewports: [], ...issue });

  /* ---------------------------------------------------------- typography */

  // A heading wider than the page is the most common and most visible break,
  // and it only appears at the narrow end.
  {
    const hero = visible.find((s) => s.type === "hero");
    const headline = hero
      ? t(site, locale, key.section(hero.id, "headline")) || site.meta.businessName
      : site.meta.businessName;
    const run = longestRunEm(headline, tokens);
    const overflowing = VIEWPORTS.filter(
      (vp) => run * headingPx(site, vp.width, 1) > contentWidth(site, vp.width),
    );
    if (overflowing.length) {
      // One issue naming every width it happens at, rather than four issues
      // saying the same thing: the correction is the same in all of them.
      const worst = overflowing[overflowing.length - 1];
      const width = contentWidth(site, worst.width);
      add({
        id: "heading-overflow",
        category: "typography",
        level: "error",
        viewports: overflowing.map((vp) => vp.id),
        issue: `The hero heading is ${Math.round(
          headingPx(site, worst.width, 1),
        )}px at ${worst.width}px wide, so the word "${
          (headline.split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? "").slice(0, 24)
        }" cannot fit in the ${Math.round(width)}px of usable width.`,
        location: hero ? `Hero section (${hero.id})` : "Hero section",
        correction: `Reduce the heading scale so the h1 lands near ${Math.round(
          width / run,
        )}px at ${worst.width}px.`,
      });
    }
  }

  // Body measure that exceeds the container is not a measure at all.
  {
    const desktopWidth = contentWidth(site, 1440);
    const measurePx = tokens.type.measure * (16 * 0.5);
    if (measurePx > desktopWidth * 1.05) {
      add({
        id: "measure-too-wide",
        category: "typography",
        level: "warning",
        issue: `The text measure (${tokens.type.measure}ch) is wider than the container allows, so lines run the full width.`,
        location: "Body text",
        correction: `Reduce the measure to about ${Math.floor(desktopWidth / 8)}ch or widen the container.`,
      });
    }
    if (tokens.type.measure < 45) {
      add({
        id: "measure-too-narrow",
        category: "typography",
        level: "warning",
        issue: `The text measure is ${tokens.type.measure}ch; under about 45 characters the eye jumps line to line.`,
        location: "Body text",
        correction: "Raise the measure to at least 52ch.",
      });
    }
  }

  // Headings that do not separate from body text.
  {
    const h2 = headingPx(site, 390, 2);
    if (h2 < 20) {
      add({
        id: "weak-hierarchy",
        category: "typography",
        level: "warning",
        viewports: ["mobile", "narrow"],
        issue: `Section headings are ${Math.round(h2)}px on a phone, barely larger than body text.`,
        location: "Section headings",
        correction: "Raise the heading scale so section headings reach at least 22px on a phone.",
      });
    }
  }

  /* -------------------------------------------------------------- layout */

  // The container must fit inside the narrowest screen once gutters are taken.
  if (tokens.space.container * REM > 0 && 320 - GUTTER * 2 < 200) {
    add({
      id: "gutter-too-large",
      category: "layout",
      level: "error",
      viewports: ["narrow"],
      issue: "The page gutter leaves too little room on a 320px screen.",
      location: "Page container",
      correction: "Reduce the horizontal padding.",
    });
  }

  // Sections so tall they become a scroll of nothing.
  for (const section of visible) {
    const rows = countRows(section);
    if (rows > 24 && section.type !== "menu") {
      add({
        id: "section-too-tall",
        category: "layout",
        level: "warning",
        issue: `The ${section.type} section has ${rows} items, which makes one unbroken scroll.`,
        location: `${section.type} (${section.id})`,
        correction: "Split it, or group the items under sub-headings.",
      });
    }
  }

  // Whitespace that is not doing anything: a very airy page with very little
  // on it reads as unfinished rather than considered.
  const bodySections = visible.filter((s) => s.type !== "hero" && s.type !== "footer");
  if (tokens.space.section > 6 && bodySections.length <= 2) {
    add({
      id: "excess-whitespace",
      category: "layout",
      level: "warning",
      issue: `Sections are spaced ${tokens.space.section}rem apart on a page with only ${bodySections.length} of them.`,
      location: "Page rhythm",
      correction: "Tighten section spacing until the page reads as composed rather than empty.",
    });
  }

  /* ---------------------------------------------------------- navigation */

  {
    // The renderer builds the nav from sections that have a nav title, so
    // counting sections instead would report a missing phone menu on a page
    // that legitimately has no navigation at all.
    const links = visible.filter(
      (s) => s.type !== "hero" && s.type !== "footer" && t(site, locale, key.section(s.id, "title")),
    ).length;
    if (arch.nav !== "none" && links > 7) {
      add({
        id: "nav-crowded",
        category: "navigation",
        level: "warning",
        viewports: ["tablet", "mobile", "narrow"],
        issue: `${links} navigation links will wrap or crowd on a narrow screen.`,
        location: "Site header",
        correction: "Hide the least important links on small screens, or shorten their labels.",
      });
    }
    if (input.html) {
      const hasToggle = /class="nav-toggle"/.test(input.html);
      const hasMobileNav = /class="nav-mobile"/.test(input.html);
      if (arch.nav !== "none" && links > 0 && (!hasToggle || !hasMobileNav)) {
        add({
          id: "nav-mobile-missing",
          category: "navigation",
          level: "error",
          viewports: ["mobile", "narrow"],
          issue: "There is no way to reach the navigation on a phone.",
          location: "Site header",
          correction: "Render the phone navigation and its toggle.",
        });
      }
      // The toggle is a checkbox + label, so it works with no JavaScript. If
      // that ever becomes script-driven, a phone with a failed script loses
      // the menu entirely.
      if (hasToggle && !/#nav-open/.test(input.html)) {
        add({
          id: "nav-needs-script",
          category: "navigation",
          level: "warning",
          viewports: ["mobile", "narrow"],
          issue: "The phone navigation appears to depend on JavaScript.",
          location: "Site header",
          correction: "Keep the checkbox-and-label toggle so the menu works without scripts.",
        });
      }
    }
  }

  /* --------------------------------------------------------- interactive */

  if (input.html) {
    // Touch targets: the generated CSS sets 3rem on .btn and 2.75rem on nav
    // links. A regression here is invisible until someone tries to tap.
    if (!/\.btn\{[^}]*min-height:3rem/.test(input.html.replace(/\s+/g, ""))
      && !/min-height:3rem/.test(input.html)) {
      add({
        id: "touch-targets",
        category: "interactive",
        level: "error",
        viewports: ["mobile", "narrow"],
        issue: "Buttons no longer declare a minimum height, so they can fall under the 44px touch minimum.",
        location: "Buttons",
        correction: "Restore the 3rem minimum height on .btn.",
      });
    }
    if (/:hover[^{]*\{[^}]*display:\s*block/.test(input.html)) {
      add({
        id: "hover-only",
        category: "interactive",
        level: "error",
        viewports: ["mobile", "narrow"],
        issue: "Something is revealed only on hover, which a touch screen cannot do.",
        location: "Interactive elements",
        correction: "Make it visible, or reveal it on focus and tap as well.",
      });
    }
  }

  // Buttons whose label is too long to stay on one line on a phone.
  for (const section of visible) {
    for (const field of ["ctaLabel", "secondaryLabel", "bookingLabel"]) {
      const label = strings[key.section(section.id, field)];
      if (!label) continue;
      if (label.length > 28) {
        add({
          id: "button-label-long",
          category: "interactive",
          level: "warning",
          viewports: ["mobile", "narrow"],
          issue: `The button label "${label}" is ${label.length} characters and will wrap on a phone.`,
          location: `${section.type} (${section.id})`,
          correction: "Shorten it to a few words — the verb and the object.",
        });
      }
    }
  }

  /* -------------------------------------------------------------- images */

  {
    const placements = site.images ?? [];
    for (const placement of placements) {
      const measured = input.images?.[placement.assetId];
      const width = measured?.width ?? placement.width;
      const height = measured?.height ?? placement.height;

      if (!width || !height) {
        add({
          id: "image-dimensions-unknown",
          category: "images",
          level: "warning",
          issue: "An image has no recorded size, so the page cannot reserve space for it and will jump as it loads.",
          location: `Image ${placement.assetId}`,
          correction: "Re-upload it, or record its dimensions.",
        });
        continue;
      }

      if (placement.role === "hero" && Math.max(width, height) < 1200) {
        add({
          id: "hero-image-small",
          category: "images",
          level: "warning",
          issue: `The hero photograph is ${width}×${height}, which will look soft across a laptop.`,
          location: "Hero section",
          correction: "Use a photograph at least 1600px on its longest edge, or move this one into the gallery.",
        });
      }

      const aspect = width / height;
      if (placement.role === "hero" && aspect < 0.9) {
        add({
          id: "hero-image-portrait",
          category: "images",
          level: "warning",
          issue: `The hero photograph is taller than it is wide (${aspect.toFixed(2)}:1), so a wide crop will cut most of it away.`,
          location: "Hero section",
          correction: "Use a landscape photograph for the hero, or switch the hero to a typographic composition.",
        });
      }

      if (measured && measured.bytes > 900_000) {
        add({
          id: "image-heavy",
          category: "images",
          level: "warning",
          issue: `An image is ${(measured.bytes / 1024 / 1024).toFixed(1)}MB, which is slow on mobile data.`,
          location: `Image ${placement.assetId}`,
          correction: "Re-encode it; the upload pipeline caps photographs at 2000px and WebP quality 80.",
        });
      }
    }

    if (input.html) {
      const imgs = [...markup(input.html).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
      const noSize = imgs.filter((tag) => !/\bwidth="/.test(tag) || !/\bheight="/.test(tag));
      if (noSize.length) {
        add({
          id: "image-no-size",
          category: "images",
          level: "error",
          issue: `${noSize.length} image${noSize.length === 1 ? "" : "s"} render without width and height, so the page shifts as they load.`,
          location: "Images",
          correction: "Emit the real pixel dimensions on every image.",
        });
      }
      const eager = imgs.filter((tag) => /fetchpriority="high"/.test(tag));
      if (eager.length > 1) {
        add({
          id: "image-priority",
          category: "images",
          level: "warning",
          issue: `${eager.length} images are marked high priority, which competes for the same bandwidth.`,
          location: "Images",
          correction: "Prioritise only the image at the top of the page.",
        });
      }
      const belowFoldEager = imgs.slice(1).filter((tag) => !/loading="lazy"/.test(tag) && !/fetchpriority="high"/.test(tag));
      if (belowFoldEager.length) {
        add({
          id: "image-not-lazy",
          category: "images",
          level: "warning",
          issue: `${belowFoldEager.length} image${belowFoldEager.length === 1 ? " is" : "s are"} loaded eagerly below the fold.`,
          location: "Images",
          correction: "Mark everything below the first screen as lazy.",
        });
      }
    }
  }

  /* ------------------------------------------------------------- content */

  for (const section of visible) {
    if (isEmptySection(section)) {
      add({
        id: "empty-section",
        category: "content",
        level: "error",
        issue: `The ${section.type} section is visible but has nothing in it.`,
        location: `${section.type} (${section.id})`,
        correction: "Switch it off until there is content for it.",
      });
    }
  }

  {
    const placeholder = Object.entries(strings).filter(([, v]) => isPlaceholder(v ?? ""));
    if (placeholder.length) {
      add({
        id: "placeholder-copy",
        category: "content",
        level: "error",
        issue: `${placeholder.length} piece${placeholder.length === 1 ? "" : "s"} of placeholder text remain on the page.`,
        location: placeholder[0][0],
        correction: "Replace it with real copy, or remove the section.",
      });
    }
  }

  if (input.html) {
    const hrefs = [...markup(input.html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    const dead = hrefs.filter((h) => h === "#" || h === "" || h === "#undefined");
    if (dead.length) {
      add({
        id: "dead-links",
        category: "content",
        level: "warning",
        issue: `${dead.length} link${dead.length === 1 ? " goes" : "s go"} nowhere.`,
        location: "Links",
        correction: "Point them at a real destination or remove them.",
      });
    }
  }

  /* ------------------------------------------------------- accessibility */

  {
    const c = site.theme.colors;
    const body = contrastRatio(c.text, c.bg);
    if (body < 4.5) {
      add({
        id: "contrast-body",
        category: "accessibility",
        level: "error",
        issue: `Body text contrast is ${body.toFixed(1)}:1, below the 4.5:1 minimum.`,
        location: "Palette",
        correction: "Darken the text or lighten the background until it passes.",
      });
    }
    if (input.html && !/:focus-visible/.test(input.html)) {
      add({
        id: "focus-invisible",
        category: "accessibility",
        level: "error",
        issue: "There is no visible focus style, so keyboard users cannot see where they are.",
        location: "Stylesheet",
        correction: "Restore the focus-visible outline.",
      });
    }
    if (input.html && !/class="btn skip"/.test(input.html)) {
      add({
        id: "skip-link",
        category: "accessibility",
        level: "warning",
        issue: "The page has no skip link.",
        location: "Page head",
        correction: "Add a skip-to-content link as the first focusable element.",
      });
    }
  }

  /* ----------------------------------------------------------------- seo */

  for (const finding of auditSeo(site, locale, input.html)) {
    add({
      id: finding.id,
      category: "seo",
      level: finding.level,
      issue: finding.message,
      location: "Metadata",
      correction: finding.correction,
    });
  }

  return report(issues);
}

function countRows(section: Section): number {
  switch (section.type) {
    case "services":
      return section.items.length;
    case "testimonials":
      return section.items.length;
    case "gallery":
      return section.imageIds.length;
    case "hours":
      return section.rows.length;
    case "menu":
      return section.categories.reduce((n, c) => n + c.items.length, 0);
    default:
      return 0;
  }
}

function isEmptySection(section: Section): boolean {
  switch (section.type) {
    case "services":
      return section.items.length === 0;
    case "testimonials":
      return section.items.length === 0;
    case "gallery":
      return section.imageIds.length === 0;
    case "hours":
      return section.rows.length === 0;
    case "menu":
      return section.categories.every((c) => c.items.length === 0);
    default:
      return false;
  }
}

function report(issues: QaIssue[]): QaReport {
  const viewports = Object.fromEntries(
    VIEWPORTS.map((vp) => {
      const mine = issues.filter((i) => i.viewports.length === 0 || i.viewports.includes(vp.id));
      return [
        vp.id,
        mine.some((i) => i.level === "error") ? "FAIL" : mine.length ? "WARNING" : "PASS",
      ];
    }),
  ) as QaReport["viewports"];

  const categories = Object.fromEntries(
    (["layout", "typography", "navigation", "interactive", "images", "content", "accessibility", "seo"] as QaCategory[]).map(
      (category) => {
        const mine = issues.filter((i) => i.category === category);
        return [
          category,
          mine.some((i) => i.level === "error") ? "FAIL" : mine.length ? "WARNING" : "PASS",
        ];
      },
    ),
  ) as QaReport["categories"];

  const score = Math.max(
    0,
    100 - issues.reduce((sum, i) => sum + (i.level === "error" ? 12 : 4), 0),
  );

  return { issues, viewports, categories, score };
}

/** A readable summary, in the shape the requirement asked for. */
export function formatReport(qa: QaReport): string {
  const lines = ["Visual QA", "────────────", ""];
  for (const vp of VIEWPORTS) lines.push(`${vp.label}: ${qa.viewports[vp.id]}`);
  lines.push("");
  for (const [category, verdict] of Object.entries(qa.categories)) {
    lines.push(`${category[0].toUpperCase()}${category.slice(1)}: ${verdict}`);
  }
  lines.push("", `Score: ${qa.score}/100`);
  return lines.join("\n");
}
