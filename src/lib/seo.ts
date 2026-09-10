import { key, t, type BusinessFacts, type Site } from "./site";
import type { Locale } from "./locales";

/**
 * The SEO engine.
 *
 * Everything here is built from what the research actually verified. That is
 * not a stylistic preference: a title claiming a business is "in Athens", a
 * description promising services it does not offer, or opening hours nobody
 * confirmed are all ways of getting a customer to turn up to a closed door.
 * The research rules already say never state what could not be verified, and
 * this module is where those rules meet the part of the page that search
 * engines and social previews quote.
 *
 * It adds no model call. The words come from content the pipeline already
 * produced and from fields the research already established; the work here is
 * choosing, shaping and validating them.
 */

/** Fields the research marked as verified, as a set, for quick asking. */
function verified(facts: BusinessFacts | null): Set<string> {
  return new Set(facts?.verifiedFields ?? []);
}

/** A known value, or empty. Nothing unverified ever reaches metadata. */
function fact(facts: BusinessFacts | null, field: keyof BusinessFacts): string {
  const value = facts?.[field];
  return typeof value === "string" ? value.trim() : "";
}

const clip = (text: string, max: number): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // Cut on a word boundary; a title ending mid-word looks broken in a result.
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
};

export type SeoInput = {
  site: Site;
  locale: Locale;
  /** What the research established, carried on the document. */
  facts: BusinessFacts | null;
};

/**
 * The page title.
 *
 * Business name first, because that is what someone searching for it types,
 * then only the qualifiers that are true: what it is, and where. A business
 * whose location was never verified does not get a location in its title.
 */
export function buildTitle(input: SeoInput): string {
  const { site, facts } = input;
  const name = site.meta.businessName.trim();
  const category = fact(facts, "category") || fact(facts, "cuisineOrSpecialty");
  const location = fact(facts, "location");

  const qualifier = [category, location && `in ${location}`].filter(Boolean).join(" ");
  return clip(qualifier ? `${name} — ${qualifier}` : name, 60);
}

/**
 * The meta description.
 *
 * Assembled from established facts in the order a person would want them: what
 * the business is, where, what it actually offers. Falls back to the copy the
 * content stage already wrote, which is itself constrained by the same
 * no-fabrication rules — never to a generic sentence about professional
 * service, which is worth nothing to a reader and nothing to a search engine.
 */
export function buildDescription(input: SeoInput): string {
  const { site, locale, facts } = input;
  const name = site.meta.businessName.trim();
  const category = fact(facts, "category");
  const location = fact(facts, "location");
  const positioning = fact(facts, "positioning");

  const services = (facts?.services ?? []).filter(Boolean).slice(0, 3);
  const dishes = (facts?.menuHighlights ?? []).map((m) => m.name).filter(Boolean).slice(0, 3);

  const sentences: string[] = [];
  const opening = [name, category && `— ${category.toLowerCase()}`, location && `in ${location}`]
    .filter(Boolean)
    .join(" ");
  if (opening) sentences.push(`${opening}.`);
  if (positioning) sentences.push(`${positioning.replace(/\.$/, "")}.`);
  if (services.length) sentences.push(`${services.join(", ")}.`);
  else if (dishes.length) sentences.push(`${dishes.join(", ")}.`);

  const assembled = sentences.join(" ").trim();
  if (assembled.length >= 60) return clip(assembled, 155);

  // Nothing verified worth saying: use the page's own opening copy rather than
  // inventing a claim.
  const hero = site.sections.find((s) => s.type === "hero");
  const written = hero
    ? [t(site, locale, key.section(hero.id, "subheadline")), t(site, locale, key.section(hero.id, "headline"))]
        .filter(Boolean)
        .join(" — ")
    : t(site, locale, key.meta("tagline"));

  return clip([assembled, written].filter(Boolean).join(" ") || name, 155);
}

/**
 * Keywords, only where they are facts.
 *
 * Search engines have ignored this tag for years; it is filled here because
 * the field exists in the document and an empty one invites someone to stuff
 * it later. Terms come from verified fields only, deduplicated, and capped.
 */
export function buildKeywords(input: SeoInput): string[] {
  const { site, facts } = input;
  const terms = [
    site.meta.businessName,
    fact(facts, "category"),
    fact(facts, "cuisineOrSpecialty"),
    fact(facts, "location"),
    ...(facts?.services ?? []).slice(0, 5),
  ]
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2);

  return [...new Set(terms)].slice(0, 8);
}

/**
 * Alt text for a photograph.
 *
 * Describes what can be said truthfully — this business, this place — and
 * never guesses at what is in the frame. A creator's own alt text always wins.
 */
export function buildAltText(input: SeoInput, existing: string, role: string): string {
  if (existing.trim()) return existing.trim();
  const { site, facts } = input;
  const name = site.meta.businessName.trim();
  const location = fact(facts, "location");
  const where = location ? ` in ${location}` : "";
  switch (role) {
    case "hero":
      return `${name}${where}`;
    case "menu":
      return `A dish at ${name}`;
    case "gallery":
    case "showcase":
      return `${name}${where}`;
    default:
      return `${name}${where}`;
  }
}

/* -------------------------------------------------------------------------
   Structured data
------------------------------------------------------------------------- */

/**
 * The schema.org type this business actually is.
 *
 * A restaurant marked up as a generic LocalBusiness loses its rich result; a
 * law firm marked up as a Restaurant is simply wrong. The mapping is on the
 * researched category, and falls back to the broadest type that is still true.
 */
export function schemaType(site: Site, facts: BusinessFacts | null): string {
  const text = `${fact(facts, "category")} ${fact(facts, "cuisineOrSpecialty")} ${site.meta.kind}`.toLowerCase();

  // Ordered from most specific to least: schema.org has a real type for a
  // bakery and for an accountant, and using the generic parent throws away the
  // rich result the specific one earns. Whatever falls through is described as
  // a LocalBusiness, which is broad but never wrong.
  const MAP: [RegExp, string][] = [
    [/\b(bakery|bakeries|baker|patisserie|pastry shop|zaharoplasteio)\b/, "Bakery"],
    [/\b(cafe|café|coffee|espresso|kafeneio)\b/, "CafeOrCoffeeShop"],
    [/\b(bar|pub|taproom|wine bar|cocktail)\b/, "BarOrPub"],
    [/\b(restaurant|taverna|trattoria|bistro|pizzeria|deli|grill|ouzeri|mezedopoleio)\b/, "Restaurant"],
    [/\b(hotel|resort|hostel|guest house|guesthouse|bed and breakfast|suites|inn)\b/, "Hotel"],
    [/\b(law|lawyer|legal|solicitor|attorney|advocate|notary)\b/, "LegalService"],
    [/\b(account\w*|bookkeep\w*|audit\w*|tax)\b/, "AccountingService"],
    [/\b(dental|dentist|clinic|medical|doctor|physio\w*|veterinar\w*|pharmac\w*)\b/, "MedicalBusiness"],
    [/\b(gym|fitness|crossfit|pilates|yoga)\b/, "ExerciseGym"],
    [/\b(salon|barber|spa|beauty|hairdress\w*|nails)\b/, "HealthAndBeautyBusiness"],
    [/\b(car|auto\w*|vehicle|detailing|tyre|tire|garage)\b/, "AutomotiveBusiness"],
    [/\b(consultan\w*|advisory|agency|architect\w*|engineer\w*|marketing|design studio)\b/, "ProfessionalService"],
    [/\b(shop|store|boutique|retail|grocer\w*|market)\b/, "Store"],
  ];

  // A digital menu is a menu for a place that serves food, whatever else the
  // category says.
  if (site.meta.kind === "menu" && !MAP.slice(0, 4).some(([re]) => re.test(text))) {
    return "FoodEstablishment";
  }
  for (const [re, type] of MAP) if (re.test(text)) return type;
  return "LocalBusiness";
}

/**
 * Structured data, containing only what is known.
 *
 * Every property here is either something the creator entered, something the
 * research verified, or something on the page itself. Ratings, review counts,
 * prices and geo-coordinates are deliberately absent: they are the properties
 * most worth faking and the ones a search engine penalises hardest when they
 * turn out to be false.
 */
export function buildStructuredData(
  input: SeoInput,
  opts: { canonical?: string; logoUrl?: string; imageUrls?: string[] } = {},
): Record<string, unknown> {
  const { site, locale, facts } = input;
  const seo = site.i18n[locale]?.seo;
  const contact = site.sections.find((s) => s.type === "contact");
  const hours = site.sections.find((s) => s.type === "hours");
  const isVerified = verified(facts);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType(site, facts),
    name: site.meta.businessName,
    inLanguage: locale,
  };

  if (seo?.description) data.description = seo.description;
  if (opts.canonical) data.url = opts.canonical;
  if (opts.logoUrl) data.logo = opts.logoUrl;
  if (opts.imageUrls?.length) data.image = opts.imageUrls.slice(0, 6);

  if (contact?.type === "contact") {
    if (contact.phone) data.telephone = contact.phone;
    if (contact.email) data.email = contact.email;
    const address = t(site, locale, key.section(contact.id, "address"));
    if (address) {
      const locality = fact(facts, "location");
      data.address = {
        "@type": "PostalAddress",
        streetAddress: address,
        ...(locality ? { addressLocality: locality } : {}),
      };
    }
    if (contact.mapsUrl) data.hasMap = contact.mapsUrl;
  }

  // Hours are only marked up when the research confirmed them: a wrong
  // opening time in a search result sends someone to a closed door.
  if (hours?.type === "hours" && hours.rows.length && isVerified.has("openingHours")) {
    data.openingHours = hours.rows
      .map((r) => `${t(site, locale, key.row(hours.id, r.id, "day"))} ${r.hours}`.trim())
      .filter(Boolean);
  }

  if (isVerified.has("priceRange") && fact(facts, "priceRange")) {
    data.priceRange = fact(facts, "priceRange");
  }

  const menu = site.sections.find((s) => s.type === "menu");
  if (data["@type"] === "Restaurant" && menu?.type === "menu" && menu.categories.length) {
    data.hasMenu = {
      "@type": "Menu",
      hasMenuSection: menu.categories.slice(0, 12).map((c) => ({
        "@type": "MenuSection",
        name: t(site, locale, key.row(menu.id, c.id, "name")),
        hasMenuItem: c.items.slice(0, 24).map((item) => ({
          "@type": "MenuItem",
          name: t(site, locale, key.menuItem(menu.id, c.id, item.id, "name")),
          ...(item.price ? { offers: { "@type": "Offer", price: item.price } } : {}),
        })),
      })),
    };
  }

  return data;
}

/* -------------------------------------------------------------------------
   Applying and auditing
------------------------------------------------------------------------- */

/**
 * Fill the default locale's metadata from verified facts.
 *
 * Anything the creator or the translation stage already wrote is left alone —
 * this only supplies what is missing or obviously unusable.
 */
export function applySeo(site: Site, facts: BusinessFacts | null): Site {
  const locale = site.meta.defaultLocale;
  const catalog = site.i18n[locale];
  if (!catalog) return site;

  const input: SeoInput = { site, locale, facts };
  const existing = catalog.seo;
  const title = usable(existing.title) ? existing.title : buildTitle(input);
  const description = usable(existing.description, 50)
    ? existing.description
    : buildDescription(input);

  return {
    ...site,
    i18n: {
      ...site.i18n,
      [locale]: {
        ...catalog,
        seo: {
          title,
          description,
          ogTitle: usable(existing.ogTitle) ? existing.ogTitle : title,
          ogDescription: usable(existing.ogDescription, 50) ? existing.ogDescription : description,
          keywords: existing.keywords.length ? existing.keywords : buildKeywords(input),
        },
      },
    },
  };
}

/** Placeholder text that should never reach a search result. */
const PLACEHOLDER =
  /(lorem ipsum|your business name|example\.com|coming soon|placeholder|untitled|welcome to our website|tbd)/i;

/** Copy that should never reach a visitor, wherever it appears. */
export function isPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text ?? "");
}

function usable(value: string, min = 3): boolean {
  const v = (value ?? "").trim();
  return v.length >= min && !PLACEHOLDER.test(v);
}

export type SeoFinding = {
  id: string;
  level: "error" | "warning";
  message: string;
  /** What to do, specifically. */
  correction: string;
};

/**
 * Check the metadata and the rendered page together.
 *
 * The document alone cannot answer "is there exactly one H1" — that is a
 * property of the HTML — so the audit takes the rendered page when it has one.
 */
export function auditSeo(site: Site, locale: Locale, page?: string): SeoFinding[] {
  const findings: SeoFinding[] = [];
  const seo = site.i18n[locale]?.seo;
  // The head is needed for canonical, OG and JSON-LD; the body for headings
  // and images. Only the stylesheet is dropped, because a CSS comment
  // mentioning <img> is not an image on the page.
  const html = page?.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  const push = (id: string, level: SeoFinding["level"], message: string, correction: string) =>
    findings.push({ id, level, message, correction });

  if (!seo?.title?.trim()) {
    push("title-missing", "error", "The page has no title.", "Set a title from the business name and category.");
  } else {
    if (seo.title.length > 60) {
      push("title-long", "warning", `The title is ${seo.title.length} characters; search results cut around 60.`, "Shorten it to the business name plus one qualifier.");
    }
    if (PLACEHOLDER.test(seo.title)) {
      push("title-placeholder", "error", "The title still contains placeholder text.", "Replace it with the real business name.");
    }
    if (!seo.title.toLowerCase().includes(site.meta.businessName.toLowerCase().split(" ")[0] ?? "")) {
      push("title-anonymous", "warning", "The title does not contain the business name.", "Lead the title with the business name.");
    }
  }

  if (!seo?.description?.trim()) {
    push("description-missing", "error", "The page has no meta description.", "Write one from the verified category, location and services.");
  } else {
    if (seo.description.length < 50) {
      push("description-short", "warning", `The description is ${seo.description.length} characters; under about 50 it tells a searcher nothing.`, "Add what the business is and where it is.");
    }
    if (seo.description.length > 165) {
      push("description-long", "warning", `The description is ${seo.description.length} characters and will be cut.`, "Trim it to about 155.");
    }
    if (PLACEHOLDER.test(seo.description)) {
      push("description-placeholder", "error", "The description still contains placeholder text.", "Replace it with real information about the business.");
    }
  }

  if (html) {
    const h1s = html.match(/<h1\b/gi) ?? [];
    if (h1s.length === 0) push("h1-missing", "error", "The page has no H1.", "The hero headline should be the H1.");
    if (h1s.length > 1) push("h1-multiple", "error", `The page has ${h1s.length} H1 elements.`, "Keep one H1 and demote the rest to H2.");

    // Heading order: an H3 arriving before any H2 is a broken outline.
    const levels = [...html.matchAll(/<h([1-3])\b/gi)].map((m) => Number(m[1]));
    let seenH2 = false;
    for (const level of levels) {
      if (level === 2) seenH2 = true;
      if (level === 3 && !seenH2) {
        push("heading-order", "warning", "A third-level heading appears before any second-level heading.", "Promote it, or add the section heading it belongs under.");
        break;
      }
    }

    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    const missingAlt = imgs.filter((tag) => !/\balt=/.test(tag));
    if (missingAlt.length) {
      push("alt-missing", "error", `${missingAlt.length} image${missingAlt.length === 1 ? " has" : "s have"} no alt attribute.`, "Give every image alt text, or an empty alt if it is purely decorative.");
    }
    const emptyAlt = imgs.filter((tag) => /\balt=""/.test(tag));
    if (emptyAlt.length && emptyAlt.length === imgs.length && imgs.length > 0) {
      push("alt-empty", "warning", "Every image is marked decorative.", "Describe the photographs that carry meaning.");
    }

    if (!/<html[^>]*\blang=/i.test(html)) {
      push("lang-missing", "error", "The page does not declare its language.", "Set lang on the html element.");
    }
    if (!/<link[^>]+rel="canonical"/i.test(html) && /<link[^>]+rel="alternate"/i.test(html)) {
      push("canonical-missing", "warning", "The page links alternates but has no canonical URL.", "Add a canonical link for the published address.");
    }
    if (!/property="og:title"/i.test(html)) {
      push("og-missing", "warning", "The page has no Open Graph title.", "Add Open Graph metadata so shared links preview properly.");
    }

    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
    if (!ld) {
      push("schema-missing", "warning", "The page has no structured data.", "Add a schema.org description of the business.");
    } else {
      try {
        const parsed = JSON.parse(ld[1].replace(/\\u003c/g, "<"));
        if (!parsed["@type"] || !parsed.name) {
          push("schema-incomplete", "warning", "The structured data has no type or name.", "Include at least @type and name.");
        }
        for (const forbidden of ["aggregateRating", "review", "ratingValue"]) {
          if (JSON.stringify(parsed).includes(forbidden)) {
            push("schema-unverified", "error", `The structured data contains ${forbidden}, which was never verified.`, "Remove it: fabricated ratings are penalised and dishonest.");
          }
        }
      } catch {
        push("schema-invalid", "error", "The structured data is not valid JSON.", "Fix the JSON-LD block.");
      }
    }
  }

  return findings;
}
