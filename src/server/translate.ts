import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { localeInfo, type Locale } from "@/lib/locales";
import { allKeys, emptyCatalog, key, t, type Site } from "@/lib/site";
import { hasApiKey } from "./research";

const MODEL = "claude-opus-5";

/**
 * Localisation (requirements 12-18).
 *
 * Translation operates on the flat string catalog, so it physically cannot
 * touch structure, layout, prices, links or phone numbers — those do not live
 * in the catalog. That is what guarantees "changing language never changes the
 * design" rather than merely promising it.
 */

const SYSTEM = `You translate the copy of a small business's website.

You receive a JSON object of {key: text} in a source language and return a JSON object with the SAME KEYS and translated values.

Rules:
- Return every key you were given. Never add, remove or rename a key.
- Translate meaning, not words. The result must read as if written by a native speaker of the target language, not as a translation.
- DO NOT translate: the business name, brand names, proper nouns, product names that function as brand names, street names, or anything that is plainly a name.
- DO NOT translate or reformat: prices, numbers, phone numbers, email addresses, URLs, opening-hour times.
- Keep the register and personality of the source. If the source is warm and plain, the translation is warm and plain.
- Respect length. These strings sit in a fixed layout on a phone: a headline must stay short, a button label stays 1-3 words. If the natural translation is much longer, find a shorter natural phrasing rather than letting it wrap badly.
- Preserve blank-line paragraph breaks exactly.
- Keys ending in ".alt" are image alt text: describe the image for a screen reader in the target language.
- If a value is an empty string, return an empty string.

Output ONLY the JSON object.`;

/** Chunked so a large menu does not blow past a single response. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function translateStrings(
  strings: Record<string, string>,
  from: Locale,
  to: Locale,
  businessName: string,
): Promise<Record<string, string>> {
  const client = new Anthropic();
  const entries = Object.entries(strings).filter(([, v]) => v && v.trim() !== "");
  const result: Record<string, string> = {};

  for (const batch of chunk(entries, 60)) {
    const payload = Object.fromEntries(batch);
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Source language: ${localeInfo(from).english}
Target language: ${localeInfo(to).english} (${localeInfo(to).native})
Business name (never translate): ${businessName}

${JSON.stringify(payload, null, 1)}`,
        },
      ],
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") continue;

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0) continue;

    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      for (const [k] of batch) {
        const v = parsed[k];
        if (typeof v === "string") result[k] = v;
      }
    } catch {
      // Leave this batch untranslated; the catalog falls back per key.
    }
  }

  return result;
}

const SEO_SYSTEM = `You write SEO metadata for one language version of a small business website.

Rules:
- title: at most 60 characters, includes the business name, reads naturally in the target language.
- description: 120-155 characters, describes what the business actually is. Never invent facts or claims.
- ogTitle / ogDescription: may be slightly more conversational than the title/description.
- keywords: 5-10 short phrases a real person would search in this language. Include the business name and its town.
- Never translate the business name.
Output ONLY the JSON object.`;

async function translateSeo(
  site: Site,
  from: Locale,
  to: Locale,
): Promise<Site["i18n"][string]["seo"]> {
  const source = site.i18n[from]?.seo ?? emptyCatalog().seo;
  try {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: SEO_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Business name (never translate): ${site.meta.businessName}
Source language: ${localeInfo(from).english}
Target language: ${localeInfo(to).english} (${localeInfo(to).native})

Source metadata:
${JSON.stringify(source, null, 1)}

Output ONLY: {"title":"","description":"","ogTitle":"","ogDescription":"","keywords":[""]}`,
        },
      ],
    });
    const message = await stream.finalMessage();
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    return {
      title: typeof parsed.title === "string" && parsed.title ? parsed.title : source.title,
      description: typeof parsed.description === "string" ? parsed.description : source.description,
      ogTitle: typeof parsed.ogTitle === "string" && parsed.ogTitle ? parsed.ogTitle : source.ogTitle,
      ogDescription: typeof parsed.ogDescription === "string" ? parsed.ogDescription : source.ogDescription,
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k): k is string => typeof k === "string").slice(0, 12)
        : source.keywords,
    };
  } catch {
    return source;
  }
}

/**
 * Adds or refreshes one locale.
 *
 * Only the catalog changes. `sections`, `theme` and `meta` are returned
 * untouched, which is what makes adding a language after generation safe
 * (requirement 17).
 */
export async function addLocale(site: Site, target: Locale): Promise<Site> {
  const from = site.meta.defaultLocale;
  if (target === from) return site;

  const sourceStrings = site.i18n[from]?.strings ?? {};

  // Without a key we still register the locale, and every string falls back to
  // the default language rather than rendering blank. The site stays usable
  // and the missing translations are reported by validation.
  if (!hasApiKey()) {
    return {
      ...site,
      meta: {
        ...site.meta,
        locales: site.meta.locales.includes(target)
          ? site.meta.locales
          : [...site.meta.locales, target],
      },
      i18n: {
        ...site.i18n,
        [target]: site.i18n[target] ?? { ...emptyCatalog(), seo: site.i18n[from]?.seo ?? emptyCatalog().seo },
      },
    };
  }

  const [strings, seo] = await Promise.all([
    translateStrings(sourceStrings, from, target, site.meta.businessName),
    translateSeo(site, from, target),
  ]);

  return {
    ...site,
    meta: {
      ...site.meta,
      locales: site.meta.locales.includes(target)
        ? site.meta.locales
        : [...site.meta.locales, target],
    },
    i18n: {
      ...site.i18n,
      // Merge over anything already translated so a re-run does not discard
      // creator edits for keys the model failed to return.
      [target]: {
        strings: { ...(site.i18n[target]?.strings ?? {}), ...strings },
        seo,
      },
    },
  };
}

/**
 * Removes a locale (requirement 18). The default locale can never be removed,
 * and the switcher disappears automatically once one language remains.
 */
export function removeLocale(site: Site, target: Locale): Site {
  if (target === site.meta.defaultLocale) return site;
  if (!site.meta.locales.includes(target)) return site;

  const i18n = { ...site.i18n };
  delete i18n[target];

  return {
    ...site,
    meta: { ...site.meta, locales: site.meta.locales.filter((l) => l !== target) },
    i18n,
  };
}

/**
 * Fills in any key a locale is missing — used after the creator edits
 * structure (adds a menu item, a service, a section) so the other languages
 * do not silently fall behind.
 */
export async function fillMissingStrings(site: Site, target: Locale): Promise<Site> {
  const from = site.meta.defaultLocale;
  if (target === from || !hasApiKey()) return site;

  const catalog = site.i18n[target] ?? emptyCatalog();
  const missing: Record<string, string> = {};
  for (const k of allKeys(site)) {
    const source = site.i18n[from]?.strings[k];
    if (source && source.trim() && !catalog.strings[k]?.trim()) missing[k] = source;
  }
  if (!Object.keys(missing).length) return site;

  const translated = await translateStrings(missing, from, target, site.meta.businessName);
  return {
    ...site,
    i18n: {
      ...site.i18n,
      [target]: { ...catalog, strings: { ...catalog.strings, ...translated } },
    },
  };
}

/** Synchronous, key-level view of what is still untranslated, for validation. */
export function untranslated(site: Site, locale: Locale): string[] {
  const from = site.meta.defaultLocale;
  if (locale === from) return [];
  return allKeys(site).filter((k) => {
    const source = site.i18n[from]?.strings[k];
    return Boolean(source?.trim()) && !site.i18n[locale]?.strings[k]?.trim();
  });
}

/** Generates SEO for the default locale when the content stage left it thin. */
export function ensureSeo(site: Site): Site {
  const locale = site.meta.defaultLocale;
  const catalog = site.i18n[locale] ?? emptyCatalog();
  const hero = site.sections.find((s) => s.type === "hero");
  const fallbackDescription = hero
    ? t(site, locale, key.section(hero.id, "subheadline"))
    : t(site, locale, key.meta("tagline"));

  return {
    ...site,
    i18n: {
      ...site.i18n,
      [locale]: {
        ...catalog,
        seo: {
          title: catalog.seo.title || site.meta.businessName,
          description: catalog.seo.description || fallbackDescription,
          ogTitle: catalog.seo.ogTitle || catalog.seo.title || site.meta.businessName,
          ogDescription: catalog.seo.ogDescription || catalog.seo.description || fallbackDescription,
          keywords: catalog.seo.keywords,
        },
      },
    },
  };
}
