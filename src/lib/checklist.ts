import { assessPerformance, type PerfReport } from "./performance";
import { auditSeo, isPlaceholder } from "./seo";
import { auditSite, type QaReport } from "./visual-qa";
import { contrastRatio, readableOn } from "./contrast";
import { key, t, type Section, type Site } from "./site";
import { VIEWPORTS } from "./viewports";
import type { Locale } from "./locales";

/**
 * The client readiness checklist.
 *
 * Visual QA answers "does this page hold together". This answers a different
 * question, and the one that actually decides whether a job is finished: "can
 * I send this to the client?" A page can hold together perfectly and still be
 * unsendable — a phone number nobody filled in, a link that goes to "#", a
 * headline still saying "Welcome to our website".
 *
 * Everything here is deterministic and reproducible: the same document scores
 * the same number every time, no model is consulted, and every point taken off
 * is attached to a finding that says what and why. Nothing here edits the
 * site. Safe corrections belong to `lib/qa-fix.ts`; a checklist that quietly
 * rewrote a business's own words in order to score itself higher would be
 * worthless.
 *
 * It reuses the existing systems rather than re-deciding what they decided:
 * visual QA for rendering and responsiveness, `lib/seo.ts` for metadata,
 * `site.images` for photographs, `lib/performance.ts` for weight and loading.
 */

export type CategoryId =
  | "rendering"
  | "responsive"
  | "seo"
  | "content"
  | "images"
  | "accessibility"
  | "performance";

/** The weighting, and the only place it is defined. */
export const CATEGORY_WEIGHT: Record<CategoryId, number> = {
  rendering: 25,
  responsive: 20,
  seo: 15,
  content: 15,
  images: 10,
  accessibility: 10,
  performance: 5,
};

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  rendering: "Rendering & functionality",
  responsive: "Mobile & responsive",
  seo: "SEO",
  content: "Content integrity",
  images: "Images",
  accessibility: "Accessibility",
  performance: "Performance",
};

export type Severity = "critical" | "warning" | "info";

export type CheckIssue = {
  id: string;
  category: CategoryId;
  severity: Severity;
  /** What is wrong, in the creator's language. */
  issue: string;
  /** Where — a section, a field, a part of the page. */
  location: string;
  /** What to do about it. */
  correction: string;
  /** Points removed from the category. Info findings always cost nothing. */
  cost: number;
};

export type CategoryResult = {
  id: CategoryId;
  label: string;
  max: number;
  score: number;
  verdict: "PASS" | "WARNING" | "FAIL";
  issues: CheckIssue[];
};

export type ReadinessStatus =
  | "READY"
  | "READY WITH WARNINGS"
  | "NEEDS REVIEW"
  | "NOT READY";

export type ReadinessReport = {
  /** 0–100. Deterministic, this application's own measure. */
  score: number;
  status: ReadinessStatus;
  /**
   * Set when the status is worse than the score alone would give — a critical
   * failure overrides the number, and this says which one.
   */
  overrideReason: string | null;
  categories: CategoryResult[];
  issues: CheckIssue[];
  /** The reports this was built from, so the UI need not recompute them. */
  qa: QaReport;
  performance: PerfReport;
};

export type ReadinessInput = {
  site: Site;
  locale: Locale;
  /** The rendered page. Several checks are properties of the HTML. */
  html?: string;
  /** Real image sizes from the assets table. */
  images?: Record<string, { width: number; height: number; bytes: number }>;
};

/* -------------------------------------------------------------------------
   Helpers
------------------------------------------------------------------------- */

/** The document without its stylesheet or scripts — a CSS comment is not markup. */
function markup(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

/** A link a person can tap that goes nowhere. */
function isDeadHref(href: string): boolean {
  const value = (href ?? "").trim();
  if (!value) return true;
  if (value === "#" || value === "#undefined") return true;
  if (/^(undefined|null|about:blank)$/i.test(value)) return true;
  return /^javascript:/i.test(value);
}

/** A link that at least has the shape of somewhere real. */
function isPlausibleHref(href: string): boolean {
  const value = (href ?? "").trim();
  if (isDeadHref(value)) return false;
  if (/^(mailto:|tel:)/i.test(value)) return value.length > 8;
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Mojibake and unresolved templates — the marks of text that went through a
 * broken encoding or a substitution that never happened.
 */
const BROKEN_TEXT = new RegExp(
  [
    "\\uFFFD", // the replacement character itself
    "\\u00C3[\\u0080-\\u00BF]", // UTF-8 read as Latin-1
    "\\u00E2\\u0080[\\u0099\\u009C\\u009D]", // smart quotes, mangled
    "\\{\\{[^}]*\\}\\}", // {{unresolved}}
    "\\$\\{[^}]*\\}", // ${unresolved}
    "%[A-Z_]{3,}%", // %PLACEHOLDER%
  ].join("|"),
);

function sectionLabel(section: Section): string {
  return `${section.type} (${section.id})`;
}

/* -------------------------------------------------------------------------
   The checklist
------------------------------------------------------------------------- */

export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const { site, locale, html } = input;
  const issues: CheckIssue[] = [];
  const add = (issue: CheckIssue) => issues.push(issue);

  // The existing systems, consulted once each. Their findings are translated
  // into readiness terms rather than recomputed.
  const qa = auditSite({ site, locale, html, images: input.images });
  const performance = assessPerformance({ site, html, images: input.images });
  const seoFindings = auditSeo(site, locale, html);

  const visible = site.sections.filter((s) => s.visible);
  const strings = site.i18n[locale]?.strings ?? {};
  const placements = site.images ?? [];
  const body = html ? markup(html) : "";

  /* ------------------------------------------------- rendering (25) */

  if (!html) {
    add({
      id: "not-rendered",
      category: "rendering",
      severity: "critical",
      issue: "The website could not be rendered, so nothing else about it can be checked.",
      location: "Website",
      correction: "Open the preview; if it fails there too, the saved content is the problem.",
      cost: 25,
    });
  } else {
    if (!/<\/html>/i.test(html) || html.length < 500) {
      add({
        id: "render-incomplete",
        category: "rendering",
        severity: "critical",
        issue: "The rendered page is truncated or incomplete.",
        location: "Website",
        correction: "Re-open the preview and check for an error.",
        cost: 25,
      });
    }
    if (!/<main\b/i.test(html)) {
      add({
        id: "no-main",
        category: "rendering",
        severity: "critical",
        issue: "The page has no main content region.",
        location: "Website",
        correction: "The renderer should always emit one; report this.",
        cost: 10,
      });
    }
    if (!/<footer\b/i.test(html)) {
      add({
        id: "no-footer",
        category: "rendering",
        severity: "warning",
        issue: "The page has no footer.",
        location: "Website",
        correction: "Switch the footer section back on.",
        cost: 4,
      });
    }
  }

  if (!visible.length) {
    add({
      id: "no-sections",
      category: "rendering",
      severity: "critical",
      issue: "Every section is switched off, so the website is blank.",
      location: "Sections",
      correction: "Switch at least the hero and contact sections back on.",
      cost: 25,
    });
  }

  // An empty section that is nevertheless visible renders as a heading over
  // nothing, which is the most obvious sign of an unfinished site.
  for (const issue of qa.issues.filter((i) => i.id === "empty-section")) {
    add({
      id: `empty-section:${issue.location}`,
      category: "rendering",
      severity: "critical",
      issue: issue.issue,
      location: issue.location,
      correction: issue.correction,
      cost: 6,
    });
  }

  // Navigation the visitor cannot use is a broken website, not a blemish.
  for (const issue of qa.issues.filter((i) => i.id === "nav-mobile-missing")) {
    add({
      id: "nav-broken",
      category: "rendering",
      severity: "critical",
      issue: issue.issue,
      location: issue.location,
      correction: issue.correction,
      cost: 10,
    });
  }

  /* Links: internal anchors must exist, external ones must be real addresses. */
  // Resolved against the ids the page actually renders, not just the section
  // list: "#main" is a real destination the renderer always emits, and a check
  // that only knew about sections would call the skip link broken.
  const sectionIds = new Set(
    html
      ? [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
      : [...site.sections.map((s) => s.id), "main"],
  );
  const structuralHrefs: { href: string; where: string }[] = [];
  for (const s of site.sections) {
    if (s.type === "hero") {
      structuralHrefs.push(
        { href: s.ctaHref, where: "Hero button" },
        { href: s.secondaryHref, where: "Hero second button" },
      );
    }
    if (s.type === "cta") structuralHrefs.push({ href: s.ctaHref, where: "Call-to-action button" });
    if (s.type === "contact") {
      structuralHrefs.push(
        { href: s.mapsUrl, where: "Map link" },
        { href: s.bookingUrl, where: "Booking link" },
      );
    }
    if (s.type === "footer") for (const l of s.links) structuralHrefs.push({ href: l.href, where: "Footer link" });
  }
  for (const { href, where } of structuralHrefs) {
    // An absent link is a content question, not a broken one: the button
    // simply is not rendered.
    if (!href.trim()) continue;
    if (!isPlausibleHref(href)) {
      add({
        id: `bad-link:${where}:${href}`,
        category: "rendering",
        severity: "critical",
        issue: `${where} points at "${href.slice(0, 40)}", which is not a usable address.`,
        location: where,
        correction: "Point it somewhere real, or clear it so the button is not shown.",
        cost: 5,
      });
    } else if (href.startsWith("#") && href.length > 1 && !sectionIds.has(href.slice(1))) {
      add({
        id: `dangling-anchor:${href}`,
        category: "rendering",
        severity: "critical",
        issue: `${where} jumps to "${href}", which is no longer a section on this page.`,
        location: where,
        correction: "Point it at a section that exists.",
        cost: 5,
      });
    }
  }

  if (html) {
    const dead = [...body.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter(isDeadHref);
    if (dead.length) {
      add({
        id: "dead-links-rendered",
        category: "rendering",
        severity: "critical",
        issue: `${dead.length} link${dead.length === 1 ? "" : "s"} on the page go nowhere when tapped.`,
        location: "Links",
        correction: "Give them a destination or remove them.",
        cost: 5,
      });
    }
  }

  /* ------------------------------------------------ responsive (20) */

  // Visual QA already measured all four widths; this reads its verdict rather
  // than measuring anything a second time.
  const responsiveIds = new Set([
    "heading-overflow", "measure-too-wide", "measure-too-narrow", "gutter-too-large",
    "touch-targets", "hover-only", "nav-crowded", "nav-needs-script", "button-label-long",
    "weak-hierarchy", "section-too-tall", "excess-whitespace",
  ]);
  const responsiveIssues = qa.issues.filter((i) => responsiveIds.has(i.id));
  for (const issue of responsiveIssues) {
    // A layout that breaks on a phone is a layout most visitors will see.
    const phoneOnly =
      issue.viewports.length > 0 && issue.viewports.every((v) => v === "mobile" || v === "narrow");
    add({
      id: `qa:${issue.id}`,
      category: "responsive",
      severity: issue.level === "error" && phoneOnly ? "critical" : "warning",
      issue: issue.issue,
      location: issue.location,
      correction: issue.correction,
      cost: issue.level === "error" ? 6 : 2,
    });
  }
  const failedViewports = VIEWPORTS.filter((vp) => qa.viewports[vp.id] === "FAIL");
  if (failedViewports.length && !responsiveIssues.length) {
    add({
      id: "viewport-failed",
      category: "responsive",
      severity: "warning",
      issue: `The page is marked failing at ${failedViewports.map((v) => v.label).join(", ")}.`,
      location: "Layout",
      correction: "Open the preview at that width and look.",
      cost: 4,
    });
  }

  /* -------------------------------------------------------- SEO (15) */

  for (const finding of seoFindings) {
    // A missing or placeholder title is what a search result and a shared link
    // both show; it is the one metadata fault worth refusing to publish over.
    const critical = finding.id === "title-missing" || finding.id === "title-placeholder";
    add({
      id: `seo:${finding.id}`,
      category: "seo",
      severity: critical ? "critical" : "warning",
      issue: finding.message,
      location: "Metadata",
      correction: finding.correction,
      cost: finding.level === "error" ? 4 : 2,
    });
  }
  if (html && /aggregateRating|"review"|ratingValue/.test(html)) {
    add({
      id: "seo:unverified-schema",
      category: "seo",
      severity: "critical",
      issue: "The structured data contains ratings or reviews, which this application never verifies.",
      location: "Structured data",
      correction: "Remove them: a fabricated rating is penalised and dishonest.",
      cost: 8,
    });
  }

  /* ---------------------------------------------------- content (15) */

  if (!site.meta.businessName.trim()) {
    add({
      id: "no-business-name",
      category: "content",
      severity: "critical",
      issue: "The business has no name.",
      location: "Business details",
      correction: "Set it in the project settings.",
      cost: 8,
    });
  }

  const contact = site.sections.find((s) => s.type === "contact");
  if (contact?.type === "contact") {
    const address = t(site, locale, key.section(contact.id, "address"));
    if (!contact.phone.trim() && !contact.email.trim() && !address.trim()) {
      add({
        id: "no-contact-details",
        category: "content",
        severity: "critical",
        issue: "The website gives a visitor no way to reach the business — no phone, no email, no address.",
        location: "Contact section",
        correction: "Add at least one of them.",
        cost: 8,
      });
    }
    if (contact.phone.trim() && !/\d{5,}/.test(contact.phone.replace(/\D/g, ""))) {
      add({
        id: "phone-implausible",
        category: "content",
        severity: "warning",
        issue: `"${contact.phone}" does not look like a telephone number.`,
        location: "Contact section",
        correction: "Check it before the client's customers try it.",
        cost: 3,
      });
    }
    if (contact.email.trim() && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(contact.email.trim())) {
      add({
        id: "email-implausible",
        category: "content",
        severity: "warning",
        issue: `"${contact.email}" does not look like an email address.`,
        location: "Contact section",
        correction: "Check it before the client's customers try it.",
        cost: 3,
      });
    }
  }

  // Placeholder copy, broken characters, empty required strings. All reported,
  // none rewritten — these are the business's own words to fix.
  const placeholders = Object.entries(strings).filter(([, v]) => isPlaceholder(v ?? ""));
  if (placeholders.length) {
    add({
      id: "placeholder-copy",
      category: "content",
      severity: "critical",
      issue: `${placeholders.length} piece${placeholders.length === 1 ? "" : "s"} of placeholder text are still on the page.`,
      location: placeholders[0][0],
      correction: "Replace it with real copy. Nothing here rewrites it for you.",
      cost: 8,
    });
  }
  const broken = Object.entries(strings).filter(([, v]) => BROKEN_TEXT.test(v ?? ""));
  if (broken.length) {
    add({
      id: "broken-characters",
      category: "content",
      severity: "critical",
      issue: `${broken.length} piece${broken.length === 1 ? "" : "s"} of text contain broken characters or an unresolved template.`,
      location: broken[0][0],
      correction: "Re-enter the text; something mangled it on the way in.",
      cost: 6,
    });
  }

  for (const section of visible) {
    if (section.type === "hero") {
      if (!t(site, locale, key.section(section.id, "headline")).trim()) {
        add({
          id: "empty-headline",
          category: "content",
          severity: "critical",
          issue: "The hero has no headline — the first thing a visitor reads is blank.",
          location: sectionLabel(section),
          correction: "Write one.",
          cost: 6,
        });
      }
      if (!t(site, locale, key.section(section.id, "ctaLabel")).trim() && section.ctaHref.trim()) {
        add({
          id: "cta-unlabelled",
          category: "content",
          severity: "warning",
          issue: "The hero's button has a destination but no label, so it does not render.",
          location: sectionLabel(section),
          correction: "Give it a label, or clear its link.",
          cost: 3,
        });
      }
    }
    if (section.type === "cta" && !t(site, locale, key.section(section.id, "ctaLabel")).trim()) {
      add({
        id: "empty-cta-label",
        category: "content",
        severity: "warning",
        issue: "A call-to-action section has no button label.",
        location: sectionLabel(section),
        correction: "Label the button, or switch the section off.",
        cost: 3,
      });
    }
  }

  // Missing translations are only a fault where a second language is promised.
  const defaultKeys = Object.keys(site.i18n[site.meta.defaultLocale]?.strings ?? {});
  for (const l of site.meta.locales) {
    if (l === site.meta.defaultLocale) continue;
    const catalog = site.i18n[l];
    const translated = new Set(
      Object.entries(catalog?.strings ?? {})
        .filter(([, v]) => (v ?? "").trim())
        .map(([k]) => k),
    );
    const missing = defaultKeys.filter((k) => !translated.has(k)).length;
    if (missing > 0) {
      // Half a language missing is a page that reads as two languages at once;
      // a handful of strings is a page with a few fallbacks in it.
      const severe = missing > defaultKeys.length / 2;
      add({
        id: `untranslated:${l}`,
        category: "content",
        severity: severe ? "critical" : "warning",
        issue: `${missing} of ${defaultKeys.length} pieces of text are not translated into ${l.toUpperCase()}; those fall back to ${site.meta.defaultLocale.toUpperCase()}.`,
        location: `${l.toUpperCase()} content`,
        correction: "Translate them, or remove the language.",
        cost: severe ? 6 : 2,
      });
    }
  }

  /* ----------------------------------------------------- images (10) */

  const hasImages = placements.length > 0;
  if (!hasImages) {
    // Not a failure. A business with no photographs gets a page designed for
    // type, which is a legitimate outcome and is scored as one.
    add({
      id: "no-images",
      category: "images",
      severity: "info",
      issue: "This business supplied no photographs, so the page is designed for type and the gallery is switched off.",
      location: "Images",
      correction: "Nothing to do. Upload photographs if the client sends some.",
      cost: 0,
    });
  } else {
    for (const placement of placements) {
      const measured = input.images?.[placement.assetId];
      if (!measured) {
        add({
          id: `image-missing:${placement.assetId}`,
          category: "images",
          severity: "critical",
          issue: "An image on the page no longer exists in the project.",
          location: `Image ${placement.assetId}`,
          correction: "Re-upload it, or remove it from the section using it.",
          cost: 5,
        });
        continue;
      }
      if (!measured.width || !measured.height) {
        add({
          id: `image-unsized:${placement.assetId}`,
          category: "images",
          severity: "warning",
          issue: "An image has no recorded size, so the page cannot reserve space for it.",
          location: `Image ${placement.assetId}`,
          correction: "Re-upload it.",
          cost: 3,
        });
      }
    }
    for (const issue of qa.issues.filter((i) => i.category === "images")) {
      add({
        id: `qa-image:${issue.id}`,
        category: "images",
        severity: "warning",
        issue: issue.issue,
        location: issue.location,
        correction: issue.correction,
        cost: issue.level === "error" ? 3 : 2,
      });
    }
    const hero = placements.find((p) => p.role === "hero");
    if (hero && !hero.priority) {
      add({
        id: "hero-not-prioritised",
        category: "images",
        severity: "warning",
        issue: "The hero photograph is not given loading priority.",
        location: "Hero section",
        correction: "The image pipeline sets this; re-save the page.",
        cost: 2,
      });
    }
    if (html) {
      const missingAlt = [...body.matchAll(/<img\b[^>]*>/gi)]
        .map((m) => m[0])
        .filter((tag) => !/\balt="[^"]+"/.test(tag));
      if (missingAlt.length) {
        add({
          id: "image-alt-missing",
          category: "images",
          severity: "warning",
          issue: `${missingAlt.length} image${missingAlt.length === 1 ? " has" : "s have"} no alt text.`,
          location: "Images",
          correction: "Describe them on the Images screen.",
          cost: 3,
        });
      }
    }
  }

  /* ---------------------------------------------- accessibility (10) */

  {
    const c = site.theme.colors;
    const bodyContrast = contrastRatio(c.text, c.bg);
    if (bodyContrast < 4.5) {
      add({
        id: "contrast-body",
        category: "accessibility",
        severity: "critical",
        issue: `Body text is ${bodyContrast.toFixed(1)}:1 against the background, below the 4.5:1 minimum.`,
        location: "Palette",
        correction: "Darken the text or lighten the background on the Design screen.",
        cost: 5,
      });
    }
    const buttonContrast = contrastRatio(readableOn(c.primary), c.primary);
    if (buttonContrast < 4.5) {
      add({
        id: "contrast-button",
        category: "accessibility",
        severity: "warning",
        issue: `Button text is ${buttonContrast.toFixed(1)}:1 against the button colour.`,
        location: "Palette",
        correction: "Choose a button colour with more contrast.",
        cost: 3,
      });
    }
  }
  for (const issue of qa.issues.filter(
    (i) => i.category === "accessibility" && i.id !== "contrast-body",
  )) {
    add({
      id: `qa-a11y:${issue.id}`,
      category: "accessibility",
      severity: "warning",
      issue: issue.issue,
      location: issue.location,
      correction: issue.correction,
      cost: issue.level === "error" ? 3 : 2,
    });
  }
  for (const issue of qa.issues.filter((i) => i.id === "touch-targets")) {
    add({
      id: "a11y-touch",
      category: "accessibility",
      severity: "warning",
      issue: issue.issue,
      location: issue.location,
      correction: issue.correction,
      cost: 3,
    });
  }
  if (html && !/<h1\b/i.test(html)) {
    add({
      id: "a11y-no-h1",
      category: "accessibility",
      severity: "warning",
      issue: "The page has no first-level heading, so its structure is unclear to a screen reader.",
      location: "Headings",
      correction: "The hero headline should be the H1.",
      cost: 3,
    });
  }

  /* ------------------------------------------------- performance (5) */

  for (const finding of performance.findings) {
    add({
      id: `perf:${finding.id}`,
      category: "performance",
      severity: finding.level === "info" ? "info" : "warning",
      issue: finding.issue,
      location: "Performance",
      correction: finding.correction,
      // The performance engine scores itself out of 100; here it is worth five
      // points, so its findings are scaled rather than double-counted.
      cost: finding.level === "info" ? 0 : Math.max(1, Math.round(finding.cost / 4)),
    });
  }

  /* ------------------------------------------------------------ score */

  const categories: CategoryResult[] = (Object.keys(CATEGORY_WEIGHT) as CategoryId[]).map((id) => {
    const own = issues.filter((i) => i.category === id);
    const spent = own.reduce((sum, i) => sum + i.cost, 0);
    const max = CATEGORY_WEIGHT[id];
    const onlyInfo = own.length > 0 && own.every((i) => i.severity === "info");
    return {
      id,
      label: CATEGORY_LABEL[id],
      max,
      score: Math.max(0, max - spent),
      verdict: own.some((i) => i.severity === "critical")
        ? "FAIL"
        : own.length === 0 || onlyInfo
          ? "PASS"
          : "WARNING",
      issues: own,
    };
  });

  const score = categories.reduce((sum, c) => sum + c.score, 0);
  const criticals = issues.filter((i) => i.severity === "critical");

  // The rule that makes the number trustworthy: a critical failure is not
  // something a good score can outvote. A site that scores 98 and gives a
  // visitor no way to contact the business is not 98% ready — it is not ready.
  const status: ReadinessStatus = criticals.length
    ? "NOT READY"
    : score >= 95
      ? "READY"
      : score >= 85
        ? "READY WITH WARNINGS"
        : score >= 70
          ? "NEEDS REVIEW"
          : "NOT READY";

  return {
    score,
    status,
    overrideReason: criticals.length
      ? `${criticals.length} critical issue${criticals.length === 1 ? "" : "s"} — ${criticals[0].issue}`
      : null,
    categories,
    issues,
    qa,
    performance,
  };
}

/** A one-line summary for a project card. */
export function readinessSummary(report: ReadinessReport): string {
  return `${report.score}/100 · ${report.status}`;
}

/** Issues worth showing first: criticals, then the costliest warnings. */
export function rankedIssues(report: ReadinessReport): CheckIssue[] {
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return [...report.issues].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.cost - a.cost,
  );
}
