import "server-only";
import { key, newId, type Section, type Site } from "@/lib/site";
import type { Locale } from "@/lib/locales";
import { readValues } from "../google/api";
import { GoogleError } from "../google/api";
import { fillMissingStrings } from "../translate";
import { resolveImage } from "./drive-images";
import { processSheet, type Finding } from "./processor";
import { EMPTY_STATS, type SyncStats } from "./source";

/**
 * Synchronisation: Google Sheets -> structured menu data -> the Site document.
 *
 * The sheet drives only the menu section and the strings that belong to it.
 * Theme, architecture, section order and every other section are returned
 * untouched, so changing menu content can never change the website's design.
 *
 * Writing into the existing Site document is deliberate rather than keeping a
 * parallel menu store: it means the menu inherits the whole existing pipeline
 * — the renderer, the language system, preview, export and deployment — and
 * the public page stays static HTML that never calls Google.
 */

export type SyncOutcome = {
  ok: boolean;
  error?: string;
  /** Reconnecting would plausibly fix it. */
  reauth?: boolean;
  site?: Site;
  stats: SyncStats;
  findings: Finding[];
};

/**
 * Existing translations are keyed by section/category/item id. Re-syncing must
 * not orphan them, so ids are reused wherever the source key is unchanged.
 */
type IdMap = { categories: Map<string, string>; items: Map<string, string> };

function existingIds(section: Extract<Section, { type: "menu" }>): IdMap {
  const categories = new Map<string, string>();
  const items = new Map<string, string>();
  for (const cat of section.categories) {
    if (cat.sourceKey) categories.set(cat.sourceKey, cat.id);
    for (const item of cat.items) {
      if (item.sourceKey) items.set(item.sourceKey, item.id);
    }
  }
  return { categories, items };
}

function categoryKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "category";
}

export async function syncMenu(args: {
  userId: string;
  projectId: string;
  site: Site;
  spreadsheetId: string;
  sheetTitle: string;
  /** Re-download every image rather than reusing what is already stored. */
  refreshImages?: boolean;
}): Promise<SyncOutcome> {
  /* 1. Retrieve ---------------------------------------------------------- */
  let values: string[][];
  try {
    values = await readValues(args.userId, args.spreadsheetId, args.sheetTitle);
  } catch (err) {
    const google = err instanceof GoogleError;
    return {
      ok: false,
      error: google ? err.message : "Could not read the spreadsheet.",
      reauth: google ? err.reauth : false,
      stats: { ...EMPTY_STATS },
      findings: [],
    };
  }

  /* 2-5. Parse and validate ---------------------------------------------- */
  const parsed = processSheet(values);
  const findings: Finding[] = [...parsed.findings];

  if (!parsed.items.length) {
    // Nothing usable. The previously synced menu stays exactly as it is —
    // the public page keeps serving the last good data rather than emptying.
    return {
      ok: false,
      error: findings.find((f) => f.level === "error")?.message ?? "No usable menu rows were found.",
      stats: {
        ...EMPTY_STATS,
        rowsRejected: parsed.rejected,
        errors: findings.filter((f) => f.level === "error").length,
        warnings: findings.filter((f) => f.level === "warning").length,
      },
      findings,
    };
  }

  /* 6. Resolve images ----------------------------------------------------- */
  let imagesResolved = 0;
  let imagesFailed = 0;
  const imageFor = new Map<string, string>();

  for (const item of parsed.items) {
    if (!item.imageUrlRaw) continue;
    const resolution = await resolveImage({
      userId: args.userId,
      projectId: args.projectId,
      raw: item.imageUrlRaw,
      alt: item.name,
      force: args.refreshImages,
    });

    if (resolution.kind === "asset") {
      imageFor.set(item.sourceKey, resolution.assetId);
      imagesResolved += 1;
    } else if (resolution.kind === "external") {
      imageFor.set(item.sourceKey, resolution.url);
      imagesResolved += 1;
    } else if (resolution.kind === "error") {
      imagesFailed += 1;
      // A broken image never removes the dish — the row renders text-only and
      // the problem is reported to the creator instead of to customers.
      findings.push({
        level: "warning",
        row: item.row,
        column: "imageurl",
        message: `${resolution.message} The item is shown without a photo.`,
      });
    }
  }

  /* 7. Group by category -------------------------------------------------- */
  const menuSection = args.site.sections.find(
    (s): s is Extract<Section, { type: "menu" }> => s.type === "menu",
  );
  const sectionId = menuSection?.id ?? newId("sec");
  const reuse = menuSection ? existingIds(menuSection) : { categories: new Map(), items: new Map() };

  const defaultLocale = args.site.meta.defaultLocale;
  const strings: Record<string, string> = {};

  const categories = parsed.categories.map((name) => {
    const catKey = categoryKey(name);
    const catId = reuse.categories.get(catKey) ?? newId("cat");
    strings[key.row(sectionId, catId, "name")] = name;

    const items = parsed.items
      .filter((it) => it.category === name)
      .map((it) => {
        const itemId = reuse.items.get(it.sourceKey) ?? newId("itm");
        strings[key.menuItem(sectionId, catId, itemId, "name")] = it.name;
        strings[key.menuItem(sectionId, catId, itemId, "description")] = it.description;

        const image = imageFor.get(it.sourceKey);
        // A local asset id becomes an <img> the renderer resolves; an external
        // https URL is passed through as-is.
        const isAsset = image && !/^https?:\/\//i.test(image);
        if (image) {
          strings[key.menuItem(sectionId, catId, itemId, "alt")] = it.name;
        }

        return {
          id: itemId,
          sourceKey: it.sourceKey,
          price: it.price,
          tags: [] as string[],
          chefsChoice: it.chefsChoice,
          ...(image ? { imageId: isAsset ? image : image } : {}),
        };
      });

    return { id: catId, sourceKey: catKey, items };
  });

  /* 8. Hand the result to the site --------------------------------------- */
  const nextSection: Extract<Section, { type: "menu" }> = {
    id: sectionId,
    type: "menu",
    visible: true,
    categories,
  };

  const sections = menuSection
    ? args.site.sections.map((s) => (s.id === sectionId ? nextSection : s))
    : // No menu section yet (a website that was not generated as a menu):
      // insert it before the footer rather than restructuring the page.
      (() => {
        const copy = args.site.sections.slice();
        const footerAt = copy.findIndex((s) => s.type === "footer");
        copy.splice(footerAt < 0 ? copy.length : footerAt, 0, nextSection);
        return copy;
      })();

  const catalog = args.site.i18n[defaultLocale] ?? { strings: {}, seo: { title: "", description: "", ogTitle: "", ogDescription: "", keywords: [] } };

  // Drop stale keys for this section so a removed dish does not leave its old
  // name behind, then write the current ones.
  const kept: Record<string, string> = {};
  for (const [k, v] of Object.entries(catalog.strings)) {
    if (!k.startsWith(`${sectionId}.`)) kept[k] = v;
  }

  let site: Site = {
    ...args.site,
    sections,
    i18n: {
      ...args.site.i18n,
      [defaultLocale]: {
        ...catalog,
        strings: {
          ...kept,
          ...strings,
          [key.section(sectionId, "title")]:
            catalog.strings[key.section(sectionId, "title")] || "Menu",
          [key.section(sectionId, "heading")]:
            catalog.strings[key.section(sectionId, "heading")] || "Menu",
          [key.section(sectionId, "note")]: catalog.strings[key.section(sectionId, "note")] ?? "",
          [key.meta("chefsChoiceLabel")]:
            catalog.strings[key.meta("chefsChoiceLabel")] || "Chef's choice",
        },
      },
    },
  };

  // Other languages: translate only what is new. Prices, images and the
  // chef's-choice flag are structural and were never in the catalog, so a
  // translation pass physically cannot alter them.
  for (const locale of site.meta.locales) {
    if (locale === defaultLocale) continue;
    site = await fillMissingStrings(site, locale as Locale);
  }

  const stats: SyncStats = {
    items: parsed.items.length,
    categories: categories.length,
    imagesResolved,
    imagesFailed,
    rowsRejected: parsed.rejected,
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warning").length,
  };

  return { ok: true, site, stats, findings };
}
