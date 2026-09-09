import "server-only";
import { architecture } from "@/lib/architectures";
import { isSupportedLocale, localeInfo } from "@/lib/locales";
import { key, missingKeys, t, type Site } from "@/lib/site";
import { contrastRatio, readableOn } from "@/lib/contrast";
import type { BusinessProfile } from "./research";

/**
 * Pre-flight validation (requirement 27).
 *
 * Findings are advisory, not blocking: a site with warnings still ships,
 * because a phone-only creator being stuck behind a validator is worse than a
 * site with a thin gallery. Errors are the ones worth interrupting for.
 */

export type Finding = {
  level: "error" | "warning";
  area: "content" | "design" | "language" | "technical" | "accessibility";
  message: string;
};

export function validateSite(site: Site, profile?: BusinessProfile): Finding[] {
  const out: Finding[] = [];
  const push = (level: Finding["level"], area: Finding["area"], message: string) =>
    out.push({ level, area, message });

  const locale = site.meta.defaultLocale;
  const visible = site.sections.filter((s) => s.visible);

  /* ------------------------------ structure ----------------------------- */
  if (!visible.length) push("error", "design", "The website has no visible sections.");
  if (!site.sections.some((s) => s.type === "footer" && s.visible)) {
    push("error", "design", "The website has no footer.");
  }
  if (!visible.some((s) => s.type !== "footer")) {
    push("error", "design", "The website has no main content.");
  }
  if (!architecture(site.theme.architecture)) {
    push("error", "design", "The design architecture is not recognised.");
  }

  /* ------------------------------- content ------------------------------ */
  if (site.meta.kind === "menu") {
    const menu = site.sections.find((s) => s.type === "menu");
    const items =
      menu?.type === "menu" ? menu.categories.reduce((n, c) => n + c.items.length, 0) : 0;
    if (!menu || !menu.visible || items === 0) {
      // Nothing is invented to fill a menu, so this is the creator's to do —
      // and on a digital menu it is the whole point of the site.
      push(
        "error",
        "content",
        "Your menu has no dishes yet. Open Edit → Menu and add them; nothing is invented for you.",
      );
    }
  }

  if (!site.meta.businessName.trim()) {
    push("error", "content", "The business name is missing.");
  }
  const contact = site.sections.find((s) => s.type === "contact");
  if (!contact) {
    push("warning", "content", "No contact section — visitors cannot reach the business.");
  } else if (contact.type === "contact" && !contact.phone && !contact.email && !t(site, locale, key.section(contact.id, "address"))) {
    push("warning", "content", "The contact section has no phone, email or address.");
  }

  for (const s of visible) {
    if (s.type === "hero") {
      const headline = t(site, locale, key.section(s.id, "headline"));
      if (!headline) push("error", "content", "The hero has no headline.");
      else if (headline.length > 70) {
        push("warning", "design", "The hero headline is long and may wrap awkwardly on small phones.");
      }
      if (!t(site, locale, key.section(s.id, "ctaLabel"))) {
        push("warning", "content", "The hero has no call-to-action button.");
      }
    }
    if (s.type === "menu" && !s.categories.length) {
      push("warning", "content", "The menu section is empty.");
    }
    if (s.type === "menu" && s.categories.every((c) => c.items.length === 0)) {
      push("warning", "content", "The menu has categories but no dishes.");
    }
    if (s.type === "gallery" && !s.imageIds.length) {
      push("warning", "content", "The gallery is visible but has no images.");
    }
    if (s.type === "services" && !s.items.length) {
      push("warning", "content", "The services section is empty.");
    }
  }

  // Placeholder copy must never reach a real business's website.
  const placeholder = /lorem ipsum|your text here|business name here|\bTBD\b|\bXXX\b/i;
  for (const [k, v] of Object.entries(site.i18n[locale]?.strings ?? {})) {
    if (placeholder.test(v)) {
      push("error", "content", `Placeholder text found in "${k}".`);
      break;
    }
  }

  // Cross-check anything presented as fact against what research established.
  if (profile) {
    const hours = site.sections.find((s) => s.type === "hours");
    if (hours && hours.visible && !profile.openingHours.length) {
      push("warning", "content", "Opening hours are shown but were never verified — check them before publishing.");
    }
    const menu = site.sections.find((s) => s.type === "menu");
    if (menu && menu.type === "menu" && !profile.menuHighlights.length) {
      const priced = menu.categories.some((c) => c.items.some((i) => i.price.trim()));
      if (priced) {
        push("warning", "content", "Menu prices are shown but were never verified — check them before publishing.");
      }
    }
  }

  /* -------------------------------- design ------------------------------ */
  const { bg, text, primary } = site.theme.colors;
  const bodyContrast = contrastRatio(text, bg);
  if (bodyContrast < 4.5) {
    push("error", "accessibility", `Body text contrast is ${bodyContrast.toFixed(1)}:1 — below the 4.5:1 minimum.`);
  } else if (bodyContrast < 7) {
    push("warning", "accessibility", `Body text contrast is ${bodyContrast.toFixed(1)}:1 — readable, but 7:1 is better on a phone outdoors.`);
  }
  const buttonContrast = contrastRatio(primary, bg);
  if (buttonContrast < 3) {
    push("error", "accessibility", `Buttons are ${buttonContrast.toFixed(1)}:1 against the background — they will be hard to see.`);
  }
  // The label sits on the button, not on the page, so it needs its own check.
  const labelContrast = contrastRatio(readableOn(primary), primary);
  if (labelContrast < 4.5) {
    push(
      "error",
      "accessibility",
      `Button text is only ${labelContrast.toFixed(1)}:1 against the button colour.`,
    );
  }

  /* ------------------------------- language ----------------------------- */
  if (!site.meta.locales.length) {
    push("error", "language", "No languages are enabled.");
  }
  if (!site.meta.locales.includes(site.meta.defaultLocale)) {
    push("error", "language", "The default language is not in the enabled list.");
  }
  for (const l of site.meta.locales) {
    if (!isSupportedLocale(l)) {
      push("error", "language", `"${l}" is not a supported language code.`);
      continue;
    }
    if (!site.i18n[l]) {
      push("error", "language", `${localeInfo(l).english} is enabled but has no content.`);
      continue;
    }
    const missing = missingKeys(site, l);
    if (missing.length) {
      // Falling back is safe, so this is a warning — but the creator should know.
      push(
        "warning",
        "language",
        `${localeInfo(l).english} is missing ${missing.length} translation${missing.length === 1 ? "" : "s"}; those fall back to ${localeInfo(site.meta.defaultLocale).english}.`,
      );
    }
    if (!site.i18n[l].seo?.title) {
      push("warning", "language", `${localeInfo(l).english} has no SEO title.`);
    }
  }

  /* ------------------------------ technical ----------------------------- */
  const ids = site.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    push("error", "technical", "Two sections share the same id.");
  }
  for (const s of site.sections) {
    const hrefs: string[] = [];
    if (s.type === "hero") hrefs.push(s.ctaHref, s.secondaryHref);
    if (s.type === "cta") hrefs.push(s.ctaHref);
    if (s.type === "contact") hrefs.push(s.mapsUrl, s.bookingUrl);
    if (s.type === "footer") hrefs.push(...s.links.map((l) => l.href));
    for (const href of hrefs.filter(Boolean)) {
      if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
        push("warning", "technical", `"${href}" is not a usable link and will not work.`);
      }
      if (href.startsWith("#") && href.length > 1 && !ids.includes(href.slice(1))) {
        push("warning", "technical", `A link points at "${href}", which no longer exists on the page.`);
      }
    }
  }

  /* --------------------------- accessibility ---------------------------- */
  for (const s of visible) {
    if (s.type === "gallery") {
      const withoutAlt = s.imageIds.filter((id) => !t(site, locale, key.row(s.id, id, "alt")));
      if (withoutAlt.length) {
        push("warning", "accessibility", `${withoutAlt.length} gallery image${withoutAlt.length === 1 ? " has" : "s have"} no alt text.`);
      }
    }
  }

  return out;
}

export function errorsOnly(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.level === "error");
}

/** Short, phone-friendly summaries for the progress and project screens. */
export function summarise(findings: Finding[]): string[] {
  return findings.map((f) => f.message);
}
