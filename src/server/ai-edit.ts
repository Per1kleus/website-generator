import "server-only";
import { ARCHITECTURE_IDS, architecture } from "@/lib/architectures";
import { isSupportedLocale, LOCALES, localeInfo, type Locale } from "@/lib/locales";
import { emptyCatalog, key, newId, type Section, type Site } from "@/lib/site";
import { PALETTES } from "@/lib/styles";
import { contrastRatio } from "./identity";
import { hasApiKey } from "./research";
import { describeError, generateText } from "./gemini";
import { addLocale, fillMissingStrings, removeLocale } from "./translate";


export type EditResult = { site: Site; summary: string; changed: boolean };

export const AI_SUGGESTIONS = [
  "Make the hero more luxurious",
  "Make it more minimal",
  "Change the colors",
  "Improve the mobile layout",
  "Add a gallery",
  "Remove this section",
  "Make the menu easier to navigate",
  "Add English as a website language",
  "Translate the menu into English",
  "Improve the English copy, keep the design",
];

/* -------------------------------------------------------------------------
   Language commands.

   Requirement 26 asks the AI editor to understand language-scoped commands,
   and requirement 15 says changing language must not change the design. Both
   are satisfied by handling these commands structurally, before any model
   call: adding, removing and re-translating a language only ever touch the
   string catalogs, so the design provably cannot move.
------------------------------------------------------------------------- */

function findLocale(text: string): Locale | null {
  const t = text.toLowerCase();
  for (const l of LOCALES) {
    if (
      t.includes(l.english.toLowerCase()) ||
      t.includes(l.native.toLowerCase()) ||
      new RegExp(`\\b${l.code}\\b`).test(t)
    ) {
      return l.code;
    }
  }
  return null;
}

type LanguageCommand =
  | { kind: "add"; locale: Locale }
  | { kind: "remove"; locale: Locale }
  | { kind: "translate"; locale: Locale }
  | null;

export function parseLanguageCommand(instruction: string): LanguageCommand {
  const t = instruction.toLowerCase();
  const locale = findLocale(t);
  if (!locale) return null;

  if (/\b(add|enable|include|support|introduce)\b/.test(t) && /\b(language|locale|version)\b|as a/.test(t)) {
    return { kind: "add", locale };
  }
  if (/\b(remove|delete|drop|disable|get rid of)\b/.test(t)) {
    return { kind: "remove", locale };
  }
  if (/\b(translate|localis|localiz)\w*/.test(t)) {
    return { kind: "translate", locale };
  }
  return null;
}

async function handleLanguageCommand(site: Site, cmd: NonNullable<LanguageCommand>): Promise<EditResult> {
  const name = localeInfo(cmd.locale).english;

  if (cmd.kind === "add") {
    if (site.meta.locales.includes(cmd.locale)) {
      return { site, summary: `${name} is already enabled.`, changed: false };
    }
    const next = await addLocale(site, cmd.locale);
    return {
      site: next,
      summary: `Added ${name}. The design is unchanged — only the text was translated.`,
      changed: true,
    };
  }

  if (cmd.kind === "remove") {
    if (cmd.locale === site.meta.defaultLocale) {
      return {
        site,
        summary: `${name} is the default language, so it cannot be removed. Change the default first in Settings.`,
        changed: false,
      };
    }
    if (!site.meta.locales.includes(cmd.locale)) {
      return { site, summary: `${name} is not enabled.`, changed: false };
    }
    const next = removeLocale(site, cmd.locale);
    return {
      site: next,
      summary:
        next.meta.locales.length === 1
          ? `Removed ${name}. With one language left, the language switcher is now hidden.`
          : `Removed ${name}.`,
      changed: true,
    };
  }

  // "translate X into Y" on an already-enabled language: fill any gaps.
  const withLocale = site.meta.locales.includes(cmd.locale)
    ? await fillMissingStrings(site, cmd.locale)
    : await addLocale(site, cmd.locale);
  return {
    site: withLocale,
    summary: `Updated the ${name} translation. Nothing about the design changed.`,
    changed: true,
  };
}

/* -------------------------------------------------------------------------
   General editing
------------------------------------------------------------------------- */

const SYSTEM = `You edit a website's JSON document in response to a short instruction typed on a phone.

The document has a strict shape. Return the COMPLETE updated document as JSON, nothing else.

  meta      businessName, kind, defaultLocale, locales, logo, stickyCta
  theme     colors (hex), fonts, layout, radius, architecture
  sections  STRUCTURE ONLY: ids, types, visibility, image ids, links, phone,
            email, prices, tags. No display text lives here.
  i18n      per-locale { strings: {key: text}, seo: {...} }. ALL visible text
            is here, keyed by dotted paths that match the section ids.

Rules:
- Never rename or invent string keys. Only change the VALUES of existing keys, or delete keys belonging to sections you removed.
- Section types allowed: hero, about, services, menu, gallery, hours, testimonials, cta, contact, footer.
- theme.architecture must be one of: ${ARCHITECTURE_IDS.join(", ")}.
- theme.fonts values: system, serif, grotesk, rounded, mono, display, slab, humanist.
- theme.layout: minimal, balanced, dense.
- Colours are #rrggbb. Body text must stay readable on the background (4.5:1 minimum).
- Prices, phone numbers, emails and URLs are structural. Never translate or reformat them.
- Keep copy mobile-first: headlines <= 8 words, subheadlines <= 20 words, card descriptions <= 15 words, button labels 1-3 words.
- Never write placeholder text and never invent facts about the business.

LANGUAGE SCOPE — this matters:
- If the instruction names a language, change ONLY that locale's strings in i18n. Leave every other locale byte-identical.
- If the instruction does not name a language, change the default locale, then leave other locales alone.
- Changing wording must never change theme or section structure.

Do only what was asked. Leave everything else byte-identical.`;

/* Deterministic fallback so the editor still does real work without a key. */
function localEdit(site: Site, instruction: string, locale: Locale): EditResult {
  const t = instruction.toLowerCase();
  const next: Site = structuredClone(site);
  let summary = "";

  const setArch = (id: string) => {
    const arch = architecture(id);
    next.theme.architecture = arch.id;
    next.theme.fonts = { ...arch.fonts };
    next.theme.radius = arch.radius;
  };

  if (/luxur|premium|elegant|upscale|expensive|refined/.test(t)) {
    setArch("luxury");
    next.theme.colors = { ...PALETTES.plum };
    summary = "Switched to the Luxury architecture: wider letter-spacing, deeper whitespace, framed imagery.";
  } else if (/minimal|simpler|clean|plainer|less busy/.test(t)) {
    setArch("minimal");
    next.theme.colors = { ...PALETTES.charcoal };
    summary = "Switched to the Minimal architecture: one accent, more air, no ornament.";
  } else if (/bolder|bold|stand out|punchy|raw|loud/.test(t)) {
    setArch("brutalist");
    next.theme.colors = { ...PALETTES.ember };
    summary = "Switched to the Brutalist architecture: oversized type, heavy rules, high contrast.";
  } else if (/editorial|magazine|journal/.test(t)) {
    setArch("editorial");
    summary = "Switched to the Editorial architecture: magazine hierarchy and a measured column.";
  } else if (/colou?r/.test(t)) {
    const keys = Object.keys(PALETTES);
    const current = JSON.stringify(next.theme.colors);
    const pick = keys.find((k) => JSON.stringify(PALETTES[k]) !== current) ?? keys[0];
    next.theme.colors = { ...PALETTES[pick] };
    summary = `Switched to the ${pick} palette.`;
  } else if (/mobile|phone|small screen|touch/.test(t)) {
    next.theme.layout = "balanced";
    next.meta.stickyCta.enabled = next.meta.kind !== "menu";
    summary = "Tightened the mobile layout and re-enabled the sticky action bar.";
  } else if (/add a gallery|add gallery|add photos|add images/.test(t)) {
    const existing = next.sections.find((s) => s.type === "gallery");
    if (existing) {
      existing.visible = true;
      summary = "Turned the gallery section back on.";
    } else {
      const id = newId("sec");
      const gallery: Section = { id, type: "gallery", visible: true, imageIds: [] };
      const footerAt = next.sections.findIndex((s) => s.type === "footer");
      next.sections.splice(footerAt < 0 ? next.sections.length : footerAt, 0, gallery);
      for (const l of next.meta.locales) {
        const catalog = next.i18n[l] ?? emptyCatalog();
        catalog.strings[key.section(id, "title")] = "Gallery";
        catalog.strings[key.section(id, "heading")] = "Gallery";
        next.i18n[l] = catalog;
      }
      summary = "Added a gallery section. Upload photos to fill it.";
    }
  } else if (/menu.*(navigat|easier|find)|easier.*menu/.test(t)) {
    const menu = next.sections.find((s) => s.type === "menu");
    if (!menu) return { site, summary: "There is no menu section on this site yet.", changed: false };
    menu.visible = true;
    setArch("menu-first");
    next.theme.layout = "dense";
    const i = next.sections.indexOf(menu);
    next.sections.splice(i, 1);
    next.sections.splice(1, 0, menu);
    summary = "Moved the menu to the top and switched to the menu-first architecture.";
  } else {
    return {
      site,
      summary:
        "Connect a Gemini API key for free-form edits. Without one I can still change the architecture, colours, layout, languages and sections — try a suggestion.",
      changed: false,
    };
  }

  return { site: next, summary, changed: true };
}

export async function aiEdit(
  site: Site,
  instruction: string,
  focusSectionId?: string,
  locale?: Locale,
): Promise<EditResult> {
  // Language commands are handled structurally, never by the model rewriting
  // the document — that is what makes "the design cannot move" a guarantee.
  const languageCommand = parseLanguageCommand(instruction);
  if (languageCommand) return handleLanguageCommand(site, languageCommand);

  const target = locale && site.meta.locales.includes(locale) ? locale : site.meta.defaultLocale;
  if (!hasApiKey()) return localEdit(site, instruction, target);

  try {
    const named = findLocale(instruction.toLowerCase());
    const scope = named && site.meta.locales.includes(named)
      ? `\n\nThe instruction names ${localeInfo(named).english}. Change ONLY i18n["${named}"]. Every other locale must come back byte-identical.`
      : `\n\nNo language was named. Change i18n["${target}"] only; leave every other locale byte-identical.`;
    const focus = focusSectionId
      ? `\n\nThe user is editing the section with id "${focusSectionId}". "This section" means that one.`
      : "";

    const { text: raw, refused } = await generateText({
      system: SYSTEM,
      maxOutputTokens: 48000,
      content: `Current document:\n\n${JSON.stringify(site)}\n\nInstruction: ${instruction}${scope}${focus}\n\nReturn the complete updated JSON document, and nothing else.`,
    });

    if (refused) {
      return { site, summary: "I can't make that particular change.", changed: false };
    }

    const text = raw.trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON in response");

    const parsed = JSON.parse(text.slice(start, end + 1)) as Site;
    return { site: validateSiteDoc(parsed, site), summary: "Applied your change.", changed: true };
  } catch (err) {
    console.error("[ai-edit] failed, falling back to local edit:", describeError(err));
    return localEdit(site, instruction, target);
  }
}

/* -------------------------------------------------------------------------
   Validation. A model response never reaches the database unchecked.
------------------------------------------------------------------------- */

const ALLOWED_TYPES = new Set([
  "hero", "about", "services", "menu", "gallery", "hours",
  "testimonials", "cta", "contact", "footer",
]);
const FONTS = ["system", "serif", "grotesk", "rounded", "mono", "display", "slab", "humanist"];
const HEX = /^#[0-9a-f]{6}$/i;

export function validateSiteDoc(candidate: Site, previous: Site): Site {
  const sections = Array.isArray(candidate.sections) ? candidate.sections : previous.sections;
  const clean = sections.filter(
    (s): s is Section =>
      Boolean(s) && typeof s === "object" && typeof s.id === "string" && ALLOWED_TYPES.has(s.type),
  );

  const pc = previous.theme.colors;
  const cc = candidate.theme?.colors ?? pc;
  const hex = (v: unknown, fallback: string) =>
    typeof v === "string" && HEX.test(v.trim()) ? v.trim() : fallback;

  const colors = {
    primary: hex(cc.primary, pc.primary),
    secondary: hex(cc.secondary, pc.secondary),
    accent: hex(cc.accent, pc.accent),
    bg: hex(cc.bg, pc.bg),
    text: hex(cc.text, pc.text),
  };
  // Reject an unreadable palette outright rather than shipping it.
  if (contrastRatio(colors.text, colors.bg) < 4.5) {
    colors.text = pc.text;
    colors.bg = pc.bg;
  }

  // Languages are managed by the structural commands above, never by the
  // model. Whatever it returns for locales is ignored.
  const locales = previous.meta.locales;
  const defaultLocale = previous.meta.defaultLocale;

  const i18n: Site["i18n"] = {};
  for (const l of locales) {
    const incoming = candidate.i18n?.[l];
    const prior = previous.i18n[l] ?? emptyCatalog();
    const strings: Record<string, string> = { ...prior.strings };
    if (incoming?.strings && typeof incoming.strings === "object") {
      for (const [k, v] of Object.entries(incoming.strings)) {
        if (typeof v === "string") strings[k] = v;
      }
    }
    const seoIn = incoming?.seo;
    i18n[l] = {
      strings,
      seo: {
        title: typeof seoIn?.title === "string" ? seoIn.title : prior.seo.title,
        description: typeof seoIn?.description === "string" ? seoIn.description : prior.seo.description,
        ogTitle: typeof seoIn?.ogTitle === "string" ? seoIn.ogTitle : prior.seo.ogTitle,
        ogDescription:
          typeof seoIn?.ogDescription === "string" ? seoIn.ogDescription : prior.seo.ogDescription,
        keywords: Array.isArray(seoIn?.keywords)
          ? seoIn.keywords.filter((k): k is string => typeof k === "string")
          : prior.seo.keywords,
      },
    };
  }

  return {
    version: 2,
    meta: {
      businessName: candidate.meta?.businessName || previous.meta.businessName,
      kind: previous.meta.kind,
      defaultLocale,
      locales,
      logo: previous.meta.logo,
      stickyCta: {
        enabled: Boolean(candidate.meta?.stickyCta?.enabled ?? previous.meta.stickyCta.enabled),
        href: candidate.meta?.stickyCta?.href ?? previous.meta.stickyCta.href,
      },
    },
    theme: {
      colors,
      // Web fonts are chosen by the design-intelligence stage, not by a free
      // -form edit; carrying them through keeps typography stable.
      fontFamilies: previous.theme.fontFamilies,
      fonts: {
        heading: FONTS.includes(candidate.theme?.fonts?.heading)
          ? candidate.theme.fonts.heading
          : previous.theme.fonts.heading,
        body: FONTS.includes(candidate.theme?.fonts?.body)
          ? candidate.theme.fonts.body
          : previous.theme.fonts.body,
      },
      layout: ["minimal", "balanced", "dense"].includes(candidate.theme?.layout)
        ? candidate.theme.layout
        : previous.theme.layout,
      radius:
        typeof candidate.theme?.radius === "number" &&
        candidate.theme.radius >= 0 &&
        candidate.theme.radius <= 60
          ? candidate.theme.radius
          : previous.theme.radius,
      architecture: ARCHITECTURE_IDS.includes(candidate.theme?.architecture)
        ? candidate.theme.architecture
        : previous.theme.architecture,
    },
    sections: clean.length ? clean : previous.sections,
    i18n,
  };
}

export { isSupportedLocale };
