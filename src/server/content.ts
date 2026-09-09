import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { architecture } from "@/lib/architectures";
import { localeInfo, type Locale } from "@/lib/locales";
import {
  emptyCatalog, key, newId,
  type Section, type SiteKind, type Site,
} from "@/lib/site";
import { hasApiKey, type BusinessProfile } from "./research";
import type { VisualIdentity } from "./identity";

const MODEL = "claude-opus-5";

/**
 * Content generation and localisation.
 *
 * Copy is written directly in the site's default language — not written in
 * English and then translated — because a Greek taverna's Greek copy should
 * read as Greek, not as a translation (requirement 14).
 */

const ItemSchema = z.object({ name: z.string(), description: z.string(), price: z.string() });

export const ContentSchema = z.object({
  tagline: z.string(),
  stickyCtaLabel: z.string(),
  skipToContent: z.string(),
  menuLabel: z.string(),
  chefsChoiceLabel: z.string(),
  logoAlt: z.string(),
  sections: z.array(
    z.object({
      type: z.string(),
      title: z.string(),
      heading: z.string(),
      eyebrow: z.string(),
      headline: z.string(),
      subheadline: z.string(),
      body: z.string(),
      note: z.string(),
      intro: z.string(),
      ctaLabel: z.string(),
      secondaryLabel: z.string(),
      address: z.string(),
      bookingLabel: z.string(),
      tagline: z.string(),
      highlights: z.array(z.string()),
      items: z.array(ItemSchema),
      categories: z.array(z.object({ name: z.string(), items: z.array(ItemSchema) })),
      hours: z.array(z.object({ day: z.string(), hours: z.string() })),
      testimonials: z.array(z.object({ quote: z.string(), author: z.string() })),
      links: z.array(z.object({ label: z.string(), href: z.string() })),
    }),
  ),
  seo: z.object({
    title: z.string(),
    description: z.string(),
    ogTitle: z.string(),
    ogDescription: z.string(),
    keywords: z.array(z.string()),
  }),
});

export type GeneratedContent = z.infer<typeof ContentSchema>;

/**
 * The codified UI/UX layer. There is no "UI/UX Pro Max" skill installed in
 * this environment, so its intent is written down here as explicit,
 * checkable copy rules and applied on every generation.
 */
const UX_RULES = `Copy rules — these exist because the site is read on a phone first:
- Headline: at most 8 words. Subheadline: at most 20 words.
- Body paragraphs: at most 2 sentences. Separate paragraphs with a blank line.
- Card/service descriptions: at most 15 words.
- Button labels: 1-3 words naming the action ("Call us", "See the menu"). Never "Click here" or "Learn more".
- Section titles are 1-2 words — they become the navigation.
- Front-load meaning: the first three words of any heading must carry it, because the rest may wrap.
- Vary sentence length. Do not write in a uniform marketing cadence.
- No exclamation marks, no "nestled", no "your one-stop", no filler superlatives.`;

const TRUTH_RULES = `Truth rules — these override every other instruction:
- You may only state facts that appear in the research brief. Anything not in the brief does not exist.
- NEVER invent prices, menu items, opening hours, phone numbers, addresses, ratings, awards, certifications, years in business, or staff names.
- If prices were not researched, leave every price field empty. An empty price renders as no price, which is correct.
- Testimonials: write at most 2, as generic satisfied-customer sentiment attributed to a generic role ("A regular", "A local guest"). Never a full name, never a specific verifiable claim, never a quoted real review.
- If a section has no verified substance behind it, omit that section entirely rather than padding it.
- Opening hours: only include the hours section if hours were researched. Do not guess plausible hours.`;

function sectionPlanFor(
  kind: SiteKind,
  identity: VisualIdentity,
  profile: BusinessProfile,
  skillPlan: string[] = [],
): string[] {
  const allowed = new Set([
    "hero", "about", "services", "menu", "gallery", "hours",
    "testimonials", "cta", "contact", "footer",
  ]);
  // Prefer the hosted analysis's plan; fall back to the skill's landing
  // pattern, which is real catalogue knowledge rather than a default.
  const planned = (identity.sectionPlan.length ? identity.sectionPlan : skillPlan).filter((s) =>
    allowed.has(s),
  );
  if (planned.length >= 3) {
    // The plan is authoritative, but hero/contact/footer are structural.
    const out = planned.filter((s) => s !== "footer");
    if (!out.includes("hero")) out.unshift("hero");
    if (!out.includes("contact")) out.push("contact");
    out.push("footer");
    return [...new Set(out)];
  }

  // No usable plan: fall back to a shape driven by the site kind, then
  // reordered by the architecture's own emphasis.
  const base: Record<SiteKind, string[]> = {
    menu: ["hero", "menu", "hours", "contact", "footer"],
    landing: ["hero", "services", "testimonials", "cta", "contact", "footer"],
    portfolio: ["hero", "about", "gallery", "testimonials", "contact", "footer"],
    booking: ["hero", "services", "hours", "testimonials", "cta", "contact", "footer"],
    business: ["hero", "about", "services", "gallery", "testimonials", "hours", "cta", "contact", "footer"],
  };
  let plan = base[kind];
  if (!profile.openingHours.length) plan = plan.filter((s) => s !== "hours");
  if (!profile.menuHighlights.length && kind !== "menu") plan = plan.filter((s) => s !== "menu");

  const emphasis = architecture(identity.architecture).emphasis;
  const body = plan.filter((s) => s !== "hero" && s !== "footer");
  body.sort((a, b) => (emphasis[a] ?? 50) - (emphasis[b] ?? 50));
  return ["hero", ...body, "footer"];
}

function brief(args: {
  profile: BusinessProfile;
  identity: VisualIdentity;
  businessName: string;
  businessType: string;
  description: string;
  kind: SiteKind;
  locale: Locale;
  plan: string[];
  answers: Record<string, string>;
}): string {
  const p = args.profile;
  const known = [
    `Business name: ${args.businessName}`,
    p.category && `Category: ${p.category}`,
    p.cuisineOrSpecialty && `Specialty: ${p.cuisineOrSpecialty}`,
    p.location && `Location: ${p.location}`,
    p.address && `Address: ${p.address}`,
    p.phone && `Phone: ${p.phone}`,
    p.email && `Email: ${p.email}`,
    p.priceRange && `Price range: ${p.priceRange}`,
    p.openingHours.length && `Opening hours (researched):\n${p.openingHours.map((h) => `  ${h.day}: ${h.hours}`).join("\n")}`,
    p.services.length && `Services (researched): ${p.services.join(", ")}`,
    p.menuHighlights.length &&
      `Menu items (researched — use these prices verbatim, and only these):\n${p.menuHighlights.map((m) => `  ${m.name}${m.price ? ` — ${m.price}` : " — (no price found)"}`).join("\n")}`,
    p.reviewThemes.length && `Recurring themes in public reviews: ${p.reviewThemes.join("; ")}`,
    p.atmosphere && `Atmosphere: ${p.atmosphere}`,
    p.targetAudience && `Audience: ${p.targetAudience}`,
    p.positioning && `Positioning: ${p.positioning}`,
    args.description && `Owner's own words:\n${args.description}`,
  ].filter(Boolean);

  const unknown = p.unknowns.length
    ? `\nNOT ESTABLISHED — you must not state any of these as fact:\n${p.unknowns.map((u) => `  - ${u}`).join("\n")}`
    : "";

  const answers = Object.entries(args.answers).length
    ? `\nThe creator answered these design questions:\n${Object.entries(args.answers).map(([q, a]) => `  ${q}: ${a}`).join("\n")}`
    : "";

  const arch = architecture(args.identity.architecture);

  return `WHAT IS KNOWN ABOUT THIS BUSINESS:
${known.join("\n")}${unknown}${answers}

DESIGN DIRECTION (already decided — write copy that suits it):
Architecture: ${arch.label} — ${arch.rationale}
Atmosphere: ${args.identity.atmosphere || p.atmosphere || "not established"}
Brand personality: ${args.identity.brandPersonality.join(", ") || "not established"}

WRITE IN: ${localeInfo(args.locale).english} (${localeInfo(args.locale).native}).
Write natively in that language. Do not write English and translate it.

SECTIONS TO WRITE, IN THIS ORDER: ${args.plan.join(", ")}
Return exactly these section types, in this order, once each.`;
}

export async function generateContent(args: {
  profile: BusinessProfile;
  identity: VisualIdentity;
  businessName: string;
  businessType: string;
  description: string;
  kind: SiteKind;
  locale: Locale;
  answers: Record<string, string>;
  skillSectionPlan?: string[];
}): Promise<{ content: GeneratedContent; plan: string[] }> {
  const plan = sectionPlanFor(args.kind, args.identity, args.profile, args.skillSectionPlan ?? []);
  if (!hasApiKey()) {
    return { content: templateContent(args, plan), plan };
  }

  try {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: `You write the copy for one specific small business's website.

${TRUTH_RULES}

${UX_RULES}

Output ONLY a JSON object. Every section object must contain every key; use "" or [] for keys that do not apply to its type.`,
      messages: [
        {
          role: "user",
          content: `${brief({ ...args, plan })}

Output ONLY this JSON shape:
{"tagline":"","stickyCtaLabel":"","skipToContent":"","menuLabel":"","chefsChoiceLabel":"","logoAlt":"","sections":[{"type":"","title":"","heading":"","eyebrow":"","headline":"","subheadline":"","body":"","note":"","intro":"","ctaLabel":"","secondaryLabel":"","address":"","bookingLabel":"","tagline":"","highlights":[""],"items":[{"name":"","description":"","price":""}],"categories":[{"name":"","items":[{"name":"","description":"","price":""}]}],"hours":[{"day":"","hours":""}],"testimonials":[{"quote":"","author":""}],"links":[{"label":"","href":""}]}],"seo":{"title":"","description":"","ogTitle":"","ogDescription":"","keywords":[""]}}`,
        },
      ],
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("content generation declined");

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = ContentSchema.parse(JSON.parse(text.slice(start, end + 1)));
    return { content: parsed, plan };
  } catch (err) {
    console.error("[content] generation failed, using template:", err);
    return { content: templateContent(args, plan), plan };
  }
}

/* ------------------------------------------------------------------ assemble */

export function assembleSite(args: {
  content: GeneratedContent;
  identity: VisualIdentity;
  theme: Site["theme"];
  businessName: string;
  kind: SiteKind;
  locale: Locale;
  phone: string;
  email: string;
  mapsUrl: string;
  logo: Site["meta"]["logo"];
}): Site {
  const strings: Record<string, string> = {};
  const sections: Section[] = [];
  const c = args.content;

  const primaryHref = args.phone
    ? `tel:${args.phone.replace(/[^\d+]/g, "")}`
    : args.email
      ? `mailto:${args.email}`
      : "#contact";

  strings[key.meta("tagline")] = c.tagline;
  strings[key.meta("stickyCtaLabel")] = c.stickyCtaLabel || c.sections[0]?.ctaLabel || "";
  strings[key.meta("skipToContent")] = c.skipToContent || "Skip to content";
  strings[key.meta("menuLabel")] = c.menuLabel || "Menu";
  strings[key.meta("chefsChoiceLabel")] = c.chefsChoiceLabel || "Chef's choice";
  strings[key.meta("logoAlt")] = c.logoAlt || args.businessName;

  const menuSectionId = c.sections.find((s) => s.type === "menu") ? newId("sec") : "";

  for (const raw of c.sections) {
    const id = raw.type === "menu" && menuSectionId ? menuSectionId : newId("sec");
    const set = (field: string, value: string) => {
      strings[key.section(id, field)] = value ?? "";
    };
    set("title", raw.title);

    switch (raw.type) {
      case "hero":
        set("eyebrow", raw.eyebrow);
        set("headline", raw.headline || args.businessName);
        set("subheadline", raw.subheadline);
        set("ctaLabel", raw.ctaLabel);
        set("secondaryLabel", raw.secondaryLabel);
        sections.push({
          id, type: "hero", visible: true,
          ctaHref: primaryHref,
          secondaryHref: menuSectionId ? `#${menuSectionId}` : "#main",
          imageId: "",
        });
        break;

      case "about": {
        set("heading", raw.heading);
        set("body", raw.body);
        const highlights = raw.highlights.filter(Boolean).map((h) => {
          const rid = newId("hl");
          strings[key.row(id, rid, "text")] = h;
          return { id: rid };
        });
        sections.push({ id, type: "about", visible: true, imageId: "", highlights });
        break;
      }

      case "services": {
        set("heading", raw.heading);
        set("intro", raw.intro);
        const items = raw.items.filter((i) => i.name).map((it) => {
          const rid = newId("svc");
          strings[key.row(id, rid, "name")] = it.name;
          strings[key.row(id, rid, "description")] = it.description;
          return { id: rid, price: it.price };
        });
        if (!items.length) break;
        sections.push({ id, type: "services", visible: true, items });
        break;
      }

      case "menu": {
        set("heading", raw.heading);
        set("note", raw.note);
        const categories = raw.categories
          .filter((cat) => cat.name)
          .map((cat) => {
            const cid = newId("cat");
            strings[key.row(id, cid, "name")] = cat.name;
            const items = cat.items.filter((i) => i.name).map((it) => {
              const iid = newId("itm");
              strings[key.menuItem(id, cid, iid, "name")] = it.name;
              strings[key.menuItem(id, cid, iid, "description")] = it.description;
              return { id: iid, price: it.price, tags: [] as string[], chefsChoice: false };
            });
            return { id: cid, items };
          });
        // An empty menu section would render as a bare heading on the live
        // site. Nothing is invented to fill it — the section simply stays off
        // until the creator adds dishes, exactly like the gallery.
        sections.push({ id, type: "menu", visible: categories.length > 0, categories });
        break;
      }

      case "gallery":
        set("heading", raw.heading || "");
        // Starts hidden: an empty gallery is a hole in the page. Uploading a
        // photo switches it on.
        sections.push({ id, type: "gallery", visible: false, imageIds: [] });
        break;

      case "hours": {
        const rows = raw.hours.filter((h) => h.day && h.hours).map((h) => {
          const rid = newId("day");
          strings[key.row(id, rid, "day")] = h.day;
          return { id: rid, hours: h.hours };
        });
        // No researched hours means no hours section — never guessed.
        if (!rows.length) break;
        set("heading", raw.heading);
        set("note", raw.note);
        sections.push({ id, type: "hours", visible: true, rows });
        break;
      }

      case "testimonials": {
        const items = raw.testimonials.filter((t) => t.quote).slice(0, 3).map((t) => {
          const rid = newId("tst");
          strings[key.row(id, rid, "quote")] = t.quote;
          strings[key.row(id, rid, "author")] = t.author;
          return { id: rid };
        });
        if (!items.length) break;
        set("heading", raw.heading);
        sections.push({ id, type: "testimonials", visible: true, items });
        break;
      }

      case "cta":
        set("heading", raw.heading);
        set("body", raw.body);
        set("ctaLabel", raw.ctaLabel);
        sections.push({ id, type: "cta", visible: true, ctaHref: primaryHref });
        break;

      case "contact":
        set("heading", raw.heading);
        set("address", raw.address);
        set("bookingLabel", raw.bookingLabel);
        sections.push({
          id, type: "contact", visible: true,
          phone: args.phone, email: args.email, mapsUrl: args.mapsUrl, bookingUrl: "",
        });
        break;

      case "footer": {
        set("tagline", raw.tagline || c.tagline);
        const links = raw.links.filter((l) => l.label && l.href).map((l) => {
          const rid = newId("lnk");
          strings[key.row(id, rid, "label")] = l.label;
          return { id: rid, href: l.href };
        });
        sections.push({ id, type: "footer", visible: true, links });
        break;
      }
    }
  }

  // Structural guarantee: every generated site has a footer (requirement 8).
  if (!sections.some((s) => s.type === "footer")) {
    const id = newId("sec");
    strings[key.section(id, "title")] = "";
    strings[key.section(id, "tagline")] = c.tagline;
    sections.push({ id, type: "footer", visible: true, links: [] });
  }

  return {
    version: 2,
    meta: {
      businessName: args.businessName,
      kind: args.kind,
      defaultLocale: args.locale,
      locales: [args.locale],
      logo: args.logo,
      stickyCta: {
        // A menu never gets a sticky bar: nothing may cover the prices.
        enabled: args.kind !== "menu",
        href: primaryHref,
      },
    },
    theme: args.theme,
    sections,
    i18n: {
      [args.locale]: {
        ...emptyCatalog(),
        strings,
        seo: {
          title: c.seo.title || args.businessName,
          description: c.seo.description,
          ogTitle: c.seo.ogTitle || c.seo.title || args.businessName,
          ogDescription: c.seo.ogDescription || c.seo.description,
          keywords: c.seo.keywords.filter(Boolean).slice(0, 12),
        },
      },
    },
  };
}

/* ------------------------------------------------------------------ template */

/**
 * Used when no API key is configured. It writes only from what the creator
 * typed — no invented hours, prices, services or testimonials.
 */
function templateContent(
  args: {
    profile: BusinessProfile;
    businessName: string;
    businessType: string;
    description: string;
    kind: SiteKind;
  },
  plan: string[],
): GeneratedContent {
  const type = args.businessType || args.profile.category || "local business";
  const where = args.profile.location || args.profile.address;
  const first = args.description.split(/\n/)[0]?.trim() ?? "";

  const blank = {
    type: "", title: "", heading: "", eyebrow: "", headline: "", subheadline: "",
    body: "", note: "", intro: "", ctaLabel: "", secondaryLabel: "", address: "",
    bookingLabel: "", tagline: "", highlights: [] as string[],
    items: [] as z.infer<typeof ItemSchema>[],
    categories: [] as { name: string; items: z.infer<typeof ItemSchema>[] }[],
    hours: [] as { day: string; hours: string }[],
    testimonials: [] as { quote: string; author: string }[],
    links: [] as { label: string; href: string }[],
  };

  const sections = plan.map((t) => {
    switch (t) {
      case "hero":
        return {
          ...blank, type: "hero", title: "Home",
          eyebrow: where || type,
          headline: args.businessName,
          subheadline: first || `${type}${where ? ` in ${where}` : ""}.`,
          ctaLabel: "Get in touch",
          secondaryLabel: args.kind === "menu" ? "See the menu" : "",
        };
      case "about":
        return {
          ...blank, type: "about", title: "About",
          heading: `About ${args.businessName}`,
          body: args.description || `${args.businessName} is a ${type}${where ? ` in ${where}` : ""}.`,
        };
      case "menu":
        return {
          ...blank, type: "menu", title: "Menu", heading: "Menu",
          note: "Ask our team about today's dishes and allergens.",
          categories: args.profile.menuHighlights.length
            ? [{
                name: "From our menu",
                items: args.profile.menuHighlights.map((m) => ({
                  name: m.name, description: "", price: m.price,
                })),
              }]
            : [],
        };
      case "services":
        return {
          ...blank, type: "services", title: "Services", heading: "What we offer",
          items: args.profile.services.map((s) => ({ name: s, description: "", price: "" })),
        };
      case "hours":
        return {
          ...blank, type: "hours", title: "Hours", heading: "Opening hours",
          hours: args.profile.openingHours,
        };
      case "gallery":
        return { ...blank, type: "gallery", title: "Gallery", heading: "Gallery" };
      case "testimonials":
        // No researched sentiment means no testimonials at all.
        return { ...blank, type: "testimonials", title: "Reviews", heading: "What people say" };
      case "cta":
        return {
          ...blank, type: "cta", title: "Visit", heading: "Come and see us",
          body: where ? `Find us in ${where}.` : "We would love to hear from you.",
          ctaLabel: "Contact us",
        };
      case "contact":
        return {
          ...blank, type: "contact", title: "Contact", heading: "Find us",
          address: args.profile.address || where, bookingLabel: "Book now",
        };
      default:
        return {
          ...blank, type: "footer", title: "",
          tagline: `${type}${where ? ` · ${where}` : ""}`,
        };
    }
  });

  return {
    tagline: `${type}${where ? ` in ${where}` : ""}`,
    stickyCtaLabel: "Contact",
    skipToContent: "Skip to content",
    menuLabel: "Menu",
    chefsChoiceLabel: "Chef's choice",
    logoAlt: args.businessName,
    sections,
    seo: {
      title: `${args.businessName}${where ? ` — ${type} in ${where}` : ""}`,
      description: first || `${args.businessName}, ${type}${where ? ` in ${where}` : ""}.`,
      ogTitle: args.businessName,
      ogDescription: first || `${args.businessName}, ${type}.`,
      keywords: [args.businessName, type, where].filter(Boolean),
    },
  };
}
