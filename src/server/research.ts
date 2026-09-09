import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { parseMapsUrl } from "@/lib/maps";

const MODEL = "claude-opus-5";

/**
 * Business research (requirement 3).
 *
 * The hard rule here is that nothing may be invented. Every field carries its
 * own `verified` flag, and the model is instructed to leave a field empty
 * rather than guess. Prices, hours, reviews, awards and contact details are
 * treated as facts a customer could act on and be wrong about, so they are
 * only ever carried through when the research actually found them.
 */

export type Verified<T> = { value: T; verified: boolean; source: string };

export const BusinessProfileSchema = z.object({
  /** Confirmed or corrected business name. Empty means "use what the user typed". */
  name: z.string(),
  category: z.string(),
  cuisineOrSpecialty: z.string(),
  location: z.string(),
  address: z.string(),
  phone: z.string(),
  email: z.string(),
  website: z.string(),
  openingHours: z.array(z.object({ day: z.string(), hours: z.string() })),
  priceRange: z.string(),
  rating: z.string(),
  /** Themes drawn from public reviews — never quoted as a named testimonial. */
  reviewThemes: z.array(z.string()),
  services: z.array(z.string()),
  /** Only items whose names were actually found. Prices only if found. */
  menuHighlights: z.array(z.object({ name: z.string(), price: z.string() })),
  atmosphere: z.string(),
  targetAudience: z.string(),
  positioning: z.string(),
  /** Which of the above were confirmed by a source, by field name. */
  verifiedFields: z.array(z.string()),
  /** URLs actually consulted. */
  sources: z.array(z.string()),
  /** Anything the research could not establish, stated plainly. */
  unknowns: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export function emptyProfile(): BusinessProfile {
  return {
    name: "", category: "", cuisineOrSpecialty: "", location: "", address: "",
    phone: "", email: "", website: "", openingHours: [], priceRange: "",
    rating: "", reviewThemes: [], services: [], menuHighlights: [],
    atmosphere: "", targetAudience: "", positioning: "",
    verifiedFields: [], sources: [], unknowns: [], confidence: "low",
  };
}

const SYSTEM = `You research small businesses so a website can be built for them. You have web search and web fetch.

ABSOLUTE RULE — never fabricate. This is the only rule that cannot be traded away.
- If you cannot find a fact from a real source, return an empty string or an empty array for it. Never guess, never approximate, never "fill in something plausible".
- NEVER invent: prices, menu items, opening hours, phone numbers, addresses, email addresses, ratings, reviews, awards, certifications, years in business, staff names, or claims about quality.
- A field you found is listed in verifiedFields. A field you did not find is left empty and named in unknowns.
- reviewThemes are short neutral summaries of recurring sentiment across public reviews ("guests mention the terrace", "regulars praise the service"). Never copy a review verbatim and never attribute one to a named person.
- menuHighlights may only contain dish names you actually saw. Include a price ONLY if that exact price was published. Otherwise leave price empty.
- If the business cannot be identified at all, return the empty profile with confidence "low" and say so in unknowns.

Search efficiently: a handful of targeted searches, then stop. Prefer the business's own website and its Google Maps / directory listing over aggregator spam.`;

function researchPrompt(input: {
  businessName: string;
  businessType: string;
  mapsUrl: string;
  location: string;
  description: string;
}): string {
  const maps = parseMapsUrl(input.mapsUrl);
  const lines = [
    `Business name: ${input.businessName}`,
    input.businessType && `Stated type: ${input.businessType}`,
    input.location && `Stated location: ${input.location}`,
    input.mapsUrl && `Google Maps link: ${input.mapsUrl}`,
    maps.placeName && `Place name from the link: ${maps.placeName}`,
    maps.address && `Address from the link: ${maps.address}`,
    maps.lat != null && `Coordinates: ${maps.lat}, ${maps.lng}`,
    input.description && `What the owner says:\n${input.description}`,
  ].filter(Boolean);

  return `${lines.join("\n")}

Research this business and return what you can verify. Leave anything you cannot verify empty.`;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function researchBusiness(input: {
  businessName: string;
  businessType: string;
  mapsUrl: string;
  location: string;
  description: string;
}): Promise<BusinessProfile> {
  // With no key there is no research step at all. Falling back to the user's
  // own inputs is honest; inventing a profile would not be.
  if (!hasApiKey()) {
    const maps = parseMapsUrl(input.mapsUrl);
    return {
      ...emptyProfile(),
      name: input.businessName,
      category: input.businessType,
      location: input.location || maps.address,
      address: maps.address,
      unknowns: ["No research was performed — no API key is configured."],
      confidence: "low",
    };
  }

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 8 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
    ],
    messages: [
      {
        role: "user",
        content: `${researchPrompt(input)}

When you have finished researching, output ONLY a JSON object matching this shape, and nothing else:
{"name":"","category":"","cuisineOrSpecialty":"","location":"","address":"","phone":"","email":"","website":"","openingHours":[{"day":"","hours":""}],"priceRange":"","rating":"","reviewThemes":[""],"services":[""],"menuHighlights":[{"name":"","price":""}],"atmosphere":"","targetAudience":"","positioning":"","verifiedFields":[""],"sources":[""],"unknowns":[""],"confidence":"low"}`,
      },
    ],
  });

  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    return { ...emptyProfile(), name: input.businessName, unknowns: ["Research was declined."] };
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { ...emptyProfile(), name: input.businessName, unknowns: ["Research returned no usable data."] };
  }

  const parsed = BusinessProfileSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) {
    return { ...emptyProfile(), name: input.businessName, unknowns: ["Research returned malformed data."] };
  }

  // Belt and braces: strip anything that claims to be verified but has no
  // source behind it, so downstream code can trust `verifiedFields`.
  const profile = parsed.data;
  if (!profile.sources.length) profile.verifiedFields = [];
  return profile;
}
