import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { newId, type Section, type Site, type SiteKind } from "@/lib/site";
import { parseMapsUrl } from "@/lib/maps";
import { themeFor } from "./palette";

const MODEL = "claude-opus-5";

export type GenerationInput = {
  businessName: string;
  businessType: string;
  siteKind: SiteKind;
  mapsUrl: string;
  location: string;
  phone: string;
  email: string;
  description: string;
  style: string;
};

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/* -------------------------------------------------------------------------
   Schema for the model's response. Kept flat and bounded so a single
   structured call returns reliably rather than drifting into prose.
------------------------------------------------------------------------- */
const MenuItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  price: z.string(),
  tags: z.array(z.string()),
});

const ContentSchema = z.object({
  tagline: z.string(),
  metaDescription: z.string(),
  hero: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    subheadline: z.string(),
    ctaLabel: z.string(),
    secondaryLabel: z.string(),
  }),
  about: z.object({
    heading: z.string(),
    body: z.string(),
    highlights: z.array(z.string()),
  }),
  services: z.object({
    heading: z.string(),
    intro: z.string(),
    items: z.array(z.object({ name: z.string(), description: z.string(), price: z.string() })),
  }),
  menu: z.object({
    heading: z.string(),
    note: z.string(),
    categories: z.array(z.object({ name: z.string(), items: z.array(MenuItemSchema) })),
  }),
  hours: z.object({
    heading: z.string(),
    rows: z.array(z.object({ day: z.string(), hours: z.string() })),
    note: z.string(),
  }),
  testimonials: z.object({
    heading: z.string(),
    items: z.array(z.object({ quote: z.string(), author: z.string() })),
  }),
  cta: z.object({ heading: z.string(), body: z.string(), ctaLabel: z.string() }),
  contact: z.object({ heading: z.string(), address: z.string() }),
  footerTagline: z.string(),
  stickyCtaLabel: z.string(),
});

type Content = z.infer<typeof ContentSchema>;

const SYSTEM = `You write copy and structure for small-business websites that are read almost entirely on phones.

Non-negotiable rules:
- Mobile is the primary medium. Write for a 360px-wide screen held one-handed.
- Headlines: at most 8 words. Subheadlines: at most 20 words. Long headlines wrap into walls of text on a phone.
- Body paragraphs: at most 2 sentences each. Separate paragraphs with a blank line.
- Button labels: 1-3 words, and they must name the action ("Call us", "See the menu"), never "Click here" or "Learn more".
- Every card/service description: at most 15 words.
- Write concrete, specific copy grounded in the business described. Never write placeholder text like "Lorem ipsum", "Your text here", or "Business Name".
- Never invent a fact that a customer could act on and be wrong about: no fake awards, no fake certifications, no invented prices for a business whose prices you were not told.
- For opening hours you were not given, use plausible ordinary hours and keep them simple.
- Testimonials must read as generic satisfied-customer sentiment, never as named real people with specific verifiable claims.

Fill EVERY field. If a section does not apply to this business, still return sensible short content for it - the app decides which sections to show.`;

function userPrompt(input: GenerationInput): string {
  const maps = parseMapsUrl(input.mapsUrl);
  const lines = [
    `Business name: ${input.businessName}`,
    input.businessType && `Business type: ${input.businessType}`,
    `Website type: ${input.siteKind}`,
    input.location && `Location: ${input.location}`,
    maps.placeName && `Google Maps place: ${maps.placeName}`,
    maps.address && `Google Maps address: ${maps.address}`,
    input.phone && `Phone: ${input.phone}`,
    input.email && `Email: ${input.email}`,
    input.description && `What the owner says about the business:\n${input.description}`,
    `Visual style requested: ${input.style}`,
  ].filter(Boolean);

  const kindNote =
    input.siteKind === "menu"
      ? `\nThis is a DIGITAL MENU opened by scanning a QR code at the table. The menu is the entire point: produce 4-6 categories with 4-8 real items each, with prices in the local format. Keep every other section extremely short - the guest wants prices, not marketing.`
      : input.siteKind === "landing"
        ? `\nThis is a single-page landing page built around ONE action. Every section must push toward that action.`
        : input.siteKind === "booking"
          ? `\nThis site exists to drive calls and reservations. The phone number and booking action are the priority.`
          : "";

  return `${lines.join("\n")}\n${kindNote}\n\nWrite the complete content for this website.`;
}

async function generateContent(input: GenerationInput): Promise<Content> {
  const client = new Anthropic();
  // Streaming: the response is large and this call sits inside a background job
  // that may run for a while; streaming avoids HTTP timeouts entirely.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ContentSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(input) }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to generate content for this business description.");
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return ContentSchema.parse(JSON.parse(text));
}

/* -------------------------------------------------------------------------
   Template fallback. The platform must work end-to-end with no API key, so
   this produces a genuinely complete site from the owner's own inputs.
------------------------------------------------------------------------- */
function templateContent(input: GenerationInput): Content {
  const name = input.businessName;
  const type = input.businessType || "local business";
  const where = input.location || parseMapsUrl(input.mapsUrl).address;
  const desc = input.description.trim();
  const firstLine = desc.split(/\n/)[0]?.trim() ?? "";

  return {
    tagline: `${type}${where ? ` in ${where}` : ""}`,
    metaDescription: firstLine || `${name} — ${type}${where ? ` in ${where}` : ""}.`,
    hero: {
      eyebrow: where || type,
      headline: name,
      subheadline: firstLine || `Everything you need from your local ${type}.`,
      ctaLabel: input.phone ? "Call us" : "Get in touch",
      secondaryLabel: input.siteKind === "menu" ? "See the menu" : "What we do",
    },
    about: {
      heading: `About ${name}`,
      body:
        desc ||
        `${name} is a ${type}${where ? ` based in ${where}` : ""}.\n\nWe look after every customer personally, and we would love to look after you too.`,
      highlights: ["Independent and local", "Friendly, personal service", "Easy to reach"],
    },
    services: {
      heading: "What we offer",
      intro: "",
      items: [
        { name: "Our core service", description: `What ${name} is known for.`, price: "" },
        { name: "Personal advice", description: "Tell us what you need and we will help.", price: "" },
        { name: "Get in touch", description: "Questions are always welcome.", price: "" },
      ],
    },
    menu: {
      heading: "Menu",
      note: "Ask our team about allergens and daily specials.",
      categories: [
        {
          name: "Starters",
          items: [
            { name: "Soup of the day", description: "Made fresh each morning.", price: "—", tags: [] },
            { name: "House salad", description: "Seasonal leaves and dressing.", price: "—", tags: ["v"] },
          ],
        },
        {
          name: "Mains",
          items: [
            { name: "Today's special", description: "Ask your server.", price: "—", tags: [] },
            { name: "House favourite", description: "The one people come back for.", price: "—", tags: [] },
          ],
        },
        {
          name: "Drinks",
          items: [
            { name: "Coffee", description: "", price: "—", tags: [] },
            { name: "Soft drinks", description: "", price: "—", tags: [] },
          ],
        },
      ],
    },
    hours: {
      heading: "Opening hours",
      rows: [
        { day: "Monday – Friday", hours: "9:00 – 18:00" },
        { day: "Saturday", hours: "10:00 – 16:00" },
        { day: "Sunday", hours: "Closed" },
      ],
      note: "Hours may vary on public holidays.",
    },
    testimonials: {
      heading: "What people say",
      items: [
        { quote: "Genuinely helpful and easy to deal with.", author: "A local customer" },
        { quote: "We keep coming back. Always worth it.", author: "A regular" },
      ],
    },
    cta: {
      heading: "Come and see us",
      body: where ? `Find us in ${where}.` : "We would love to hear from you.",
      ctaLabel: input.phone ? "Call now" : "Contact us",
    },
    contact: { heading: "Find us", address: where },
    footerTagline: `${type}${where ? ` · ${where}` : ""}`,
    stickyCtaLabel: input.phone ? "Call" : "Contact",
  };
}

/* -------------------------------------------------------------------------
   Assembly: content + theme -> Site document
------------------------------------------------------------------------- */
function ctaHref(input: GenerationInput): string {
  if (input.phone) return `tel:${input.phone.replace(/[^\d+]/g, "")}`;
  if (input.email) return `mailto:${input.email}`;
  return "#contact";
}

/** Section order differs per site kind — a menu leads with the menu, not a hero pitch. */
function sectionOrder(kind: SiteKind): Section["type"][] {
  switch (kind) {
    case "menu":
      return ["hero", "menu", "hours", "contact", "footer"];
    case "landing":
      return ["hero", "services", "testimonials", "cta", "contact", "footer"];
    case "portfolio":
      return ["hero", "about", "gallery", "testimonials", "contact", "footer"];
    case "booking":
      return ["hero", "services", "hours", "testimonials", "cta", "contact", "footer"];
    default:
      return ["hero", "about", "services", "gallery", "testimonials", "hours", "cta", "contact", "footer"];
  }
}

export function assembleSite(input: GenerationInput, c: Content): Site {
  const href = ctaHref(input);
  const maps = parseMapsUrl(input.mapsUrl);

  const build = (type: Section["type"]): Section => {
    switch (type) {
      case "hero":
        return { id: newId("hero"), type: "hero", title: "Hero", visible: true, props: {
          eyebrow: c.hero.eyebrow, headline: c.hero.headline, subheadline: c.hero.subheadline,
          ctaLabel: c.hero.ctaLabel, ctaHref: href,
          secondaryLabel: c.hero.secondaryLabel,
          secondaryHref: input.siteKind === "menu" ? "#menu" : "#services",
          imageId: "" } };
      case "about":
        return { id: newId("about"), type: "about", title: "About", visible: true, props: {
          heading: c.about.heading, body: c.about.body,
          highlights: c.about.highlights, imageId: "" } };
      case "services":
        return { id: newId("svc"), type: "services", title: "Services", visible: true, props: {
          heading: c.services.heading, intro: c.services.intro, items: c.services.items } };
      case "menu":
        return { id: newId("menu"), type: "menu", title: "Menu", visible: true, props: {
          heading: c.menu.heading, note: c.menu.note, categories: c.menu.categories } };
      case "gallery":
        // Starts hidden: an empty gallery would render as a hole in the page.
        // The moment the owner uploads a photo the app switches it on.
        return { id: newId("gal"), type: "gallery", title: "Gallery", visible: false, props: {
          heading: "Gallery", imageIds: [] } };
      case "hours":
        return { id: newId("hrs"), type: "hours", title: "Opening hours", visible: true, props: {
          heading: c.hours.heading, rows: c.hours.rows, note: c.hours.note } };
      case "testimonials":
        return { id: newId("tst"), type: "testimonials", title: "Testimonials", visible: true, props: {
          heading: c.testimonials.heading, items: c.testimonials.items } };
      case "cta":
        return { id: newId("cta"), type: "cta", title: "Call to action", visible: true, props: {
          heading: c.cta.heading, body: c.cta.body, ctaLabel: c.cta.ctaLabel, ctaHref: href } };
      case "contact":
        return { id: newId("con"), type: "contact", title: "Contact", visible: true, props: {
          heading: c.contact.heading,
          address: c.contact.address || input.location,
          phone: input.phone, email: input.email,
          mapsUrl: maps.valid ? input.mapsUrl : "", bookingUrl: "" } };
      case "footer":
        return { id: newId("ftr"), type: "footer", title: "Footer", visible: true, props: {
          businessName: input.businessName, tagline: c.footerTagline, links: [] } };
    }
  };

  return {
    version: 1,
    meta: {
      businessName: input.businessName,
      tagline: c.tagline,
      description: c.metaDescription,
      kind: input.siteKind,
      language: "en",
      stickyCta: {
        // A menu has no sticky CTA: nothing may cover the prices.
        enabled: input.siteKind !== "menu",
        label: c.stickyCtaLabel || "Contact",
        href,
      },
    },
    theme: themeFor(input.style, input.siteKind),
    sections: sectionOrder(input.siteKind).map(build),
  };
}

export async function generateSite(
  input: GenerationInput,
  onStep?: (msg: string) => void,
): Promise<{ site: Site; usedAi: boolean }> {
  if (!hasApiKey()) {
    onStep?.("Composing from your details");
    return { site: assembleSite(input, templateContent(input)), usedAi: false };
  }
  try {
    onStep?.("Writing your content");
    const content = await generateContent(input);
    return { site: assembleSite(input, content), usedAi: true };
  } catch (err) {
    // A generation failure must never leave the user with nothing on a phone.
    // Fall back to the template site and let the job report what happened.
    console.error("[generator] AI generation failed, falling back to template:", err);
    onStep?.("Composing from your details");
    return { site: assembleSite(input, templateContent(input)), usedAi: false };
  }
}
