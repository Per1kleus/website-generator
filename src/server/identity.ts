import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ARCHITECTURE_IDS, architecture } from "@/lib/architectures";
import { PALETTES } from "@/lib/styles";
import type { SiteKind, Theme } from "@/lib/site";
import { UPLOAD_DIR } from "./db";
import { hasApiKey, type BusinessProfile } from "./research";

const MODEL = "claude-opus-5";

/**
 * Visual identity analysis and design architecture selection
 * (requirements 4, 5, 6 and 7).
 *
 * The point is that the *place* drives the design. A whitewashed taverna, a
 * concrete-and-steel barber shop and a gilded patisserie should not come out
 * of this looking like the same website with different colours — so the model
 * is asked to read materials, light and atmosphere first, and only then pick
 * an architecture and a palette that follow from them.
 */

export const VisualIdentitySchema = z.object({
  dominantColors: z.array(z.string()),
  secondaryColors: z.array(z.string()),
  materials: z.array(z.string()),
  interiorStyle: z.string(),
  lighting: z.string(),
  typographyPersonality: z.string(),
  brandPersonality: z.array(z.string()),
  photographyStyle: z.string(),
  atmosphere: z.string(),
  /** Chosen architecture id and why, in one sentence the creator can read. */
  architecture: z.string(),
  architectureRationale: z.string(),
  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
    bg: z.string(),
    text: z.string(),
  }),
  fonts: z.object({ heading: z.string(), body: z.string() }),
  /** Sections this business actually needs, in order (requirement 8). */
  sectionPlan: z.array(z.string()),
  /** Up to 5 questions, only when a real design decision is genuinely open. */
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.string()),
    }),
  ),
  confidence: z.enum(["high", "medium", "low"]),
});

export type VisualIdentity = z.infer<typeof VisualIdentitySchema>;

const HEX = /^#[0-9a-f]{6}$/i;

const SYSTEM = `You are a senior brand and web designer. You decide the visual identity for one specific business's website.

Method — follow it in order:
1. Read the environment first: materials, colours, light, textures, architecture, and how the place feels to be in. This is what makes the site feel like THIS business.
2. Only then choose a design architecture and a palette that follow from it.

Design architecture — pick exactly one id:
editorial, luxury, minimal, mediterranean, industrial, organic, brutalist, architectural, classic, modern, experimental, image-first, typography-first, menu-first, product-first

Fonts — heading and body, each one of:
system, serif, grotesk, rounded, mono, display, slab, humanist

Palette rules (non-negotiable, these are accessibility requirements):
- Five hex colours, full 6-digit form (#rrggbb).
- bg and text must have a contrast ratio of at least 7:1. Prefer a near-white or near-black bg.
- primary is used as a button fill with bg as the label colour: primary against bg must reach at least 4.5:1.
- Do not use pure #000000 or #ffffff for text and bg together; use slightly tinted neutrals drawn from the business's own materials.
- Take hues from the real environment. A stone-and-olive taverna should not come back indigo.

Section plan — list only the sections this business actually needs, in the order they should appear. Choose from:
hero, about, services, menu, gallery, hours, testimonials, cta, contact, footer
Never include a section the business has nothing to put in. footer is always last and always present.

Questions — ask at most 5, and only when a genuinely consequential design decision cannot be inferred from what you were given. If the information is sufficient, return an empty array. Never ask about facts you could research; only about taste and intent. Each question needs 2-4 concrete options.

Never invent facts about the business. You are choosing a look, not writing claims.`;

async function logoBlock(logoAssetId: string | null): Promise<Anthropic.ImageBlockParam | null> {
  if (!logoAssetId) return null;
  try {
    const data = await readFile(path.join(UPLOAD_DIR, `${logoAssetId}.webp`));
    return {
      type: "image",
      source: { type: "base64", media_type: "image/webp", data: data.toString("base64") },
    };
  } catch {
    return null;
  }
}

function fallbackIdentity(kind: SiteKind, style: string, profile: BusinessProfile): VisualIdentity {
  const archId = kind === "menu" ? "menu-first" : architecture(style).id;
  const palette = PALETTES.indigo;
  return {
    dominantColors: [], secondaryColors: [], materials: [],
    interiorStyle: "", lighting: "", typographyPersonality: "",
    brandPersonality: [], photographyStyle: "",
    atmosphere: profile.atmosphere,
    architecture: archId,
    architectureRationale: "Chosen from the style you picked — no identity analysis was available.",
    palette: { ...palette },
    fonts: { ...architecture(archId).fonts },
    sectionPlan: [],
    questions: [],
    confidence: "low",
  };
}

export async function analyseIdentity(args: {
  profile: BusinessProfile;
  businessName: string;
  businessType: string;
  description: string;
  kind: SiteKind;
  stylePreset: string;
  logoAssetId: string | null;
  /** Style words the creator typed, if any. */
  designNotes: string;
}): Promise<VisualIdentity> {
  if (!hasApiKey()) return fallbackIdentity(args.kind, args.stylePreset, args.profile);

  try {
    const client = new Anthropic();
    const logo = await logoBlock(args.logoAssetId);

    const brief = [
      `Business: ${args.businessName}`,
      args.businessType && `Type: ${args.businessType}`,
      `Website kind: ${args.kind}`,
      args.profile.category && `Researched category: ${args.profile.category}`,
      args.profile.cuisineOrSpecialty && `Specialty: ${args.profile.cuisineOrSpecialty}`,
      args.profile.location && `Location: ${args.profile.location}`,
      args.profile.atmosphere && `Atmosphere found in research: ${args.profile.atmosphere}`,
      args.profile.targetAudience && `Audience: ${args.profile.targetAudience}`,
      args.profile.positioning && `Positioning: ${args.profile.positioning}`,
      args.profile.priceRange && `Price range: ${args.profile.priceRange}`,
      args.profile.reviewThemes.length && `Recurring review themes: ${args.profile.reviewThemes.join("; ")}`,
      args.profile.services.length && `Services found: ${args.profile.services.join(", ")}`,
      args.profile.menuHighlights.length && `Menu items found: ${args.profile.menuHighlights.map((m) => m.name).join(", ")}`,
      args.description && `Owner's own words:\n${args.description}`,
      args.designNotes && `Design preferences the creator asked for: ${args.designNotes}`,
      `Creator's starting style choice (a hint, not a constraint): ${args.stylePreset}`,
      args.kind === "menu"
        ? `This is a QR-code digital menu read on a phone at a table. menu-first is almost always correct here.`
        : "",
      logo ? `A logo is attached. Let it inform the palette and personality, but do not let it override the physical identity of the place.` : "No logo was provided.",
    ]
      .filter(Boolean)
      .join("\n");

    const content: Anthropic.ContentBlockParam[] = [];
    if (logo) content.push(logo);
    content.push({
      type: "text",
      text: `${brief}

Decide the visual identity. Output ONLY a JSON object of this shape and nothing else:
{"dominantColors":[""],"secondaryColors":[""],"materials":[""],"interiorStyle":"","lighting":"","typographyPersonality":"","brandPersonality":[""],"photographyStyle":"","atmosphere":"","architecture":"","architectureRationale":"","palette":{"primary":"#000000","secondary":"#000000","accent":"#000000","bg":"#ffffff","text":"#000000"},"fonts":{"heading":"","body":""},"sectionPlan":[""],"questions":[{"id":"","question":"","options":[""]}],"confidence":"high"}`,
    });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      return fallbackIdentity(args.kind, args.stylePreset, args.profile);
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0) return fallbackIdentity(args.kind, args.stylePreset, args.profile);

    const parsed = VisualIdentitySchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return fallbackIdentity(args.kind, args.stylePreset, args.profile);

    return sanitiseIdentity(parsed.data, args.kind, args.stylePreset, args.profile);
  } catch (err) {
    console.error("[identity] analysis failed, falling back:", err);
    return fallbackIdentity(args.kind, args.stylePreset, args.profile);
  }
}

/** Never let a model response set an unreadable palette or an unknown architecture. */
export function sanitiseIdentity(
  raw: VisualIdentity,
  kind: SiteKind,
  stylePreset: string,
  profile: BusinessProfile,
): VisualIdentity {
  const fallback = fallbackIdentity(kind, stylePreset, profile);

  const archId = ARCHITECTURE_IDS.includes(raw.architecture)
    ? raw.architecture
    : fallback.architecture;

  const colour = (v: string, alt: string) => (HEX.test(v?.trim() ?? "") ? v.trim() : alt);
  const palette = {
    primary: colour(raw.palette?.primary, fallback.palette.primary),
    secondary: colour(raw.palette?.secondary, fallback.palette.secondary),
    accent: colour(raw.palette?.accent, fallback.palette.accent),
    bg: colour(raw.palette?.bg, fallback.palette.bg),
    text: colour(raw.palette?.text, fallback.palette.text),
  };

  // Enforce the contrast promise rather than trusting it. If the model's own
  // palette fails, repair the offending pair instead of discarding the work.
  if (contrastRatio(palette.text, palette.bg) < 7) {
    palette.text = pickReadable(palette.bg, palette.text);
  }
  if (contrastRatio(palette.primary, palette.bg) < 4.5) {
    palette.primary = darkenUntil(palette.primary, palette.bg, 4.5);
  }

  const FONTS = ["system", "serif", "grotesk", "rounded", "mono", "display", "slab", "humanist"];
  const arch = architecture(archId);

  return {
    ...raw,
    architecture: archId,
    palette,
    fonts: {
      heading: FONTS.includes(raw.fonts?.heading) ? raw.fonts.heading : arch.fonts.heading,
      body: FONTS.includes(raw.fonts?.body) ? raw.fonts.body : arch.fonts.body,
    },
    questions: (raw.questions ?? [])
      .filter((q) => q.question?.trim() && Array.isArray(q.options) && q.options.length >= 2)
      .slice(0, 5)
      .map((q, i) => ({
        id: q.id?.trim() || `q${i + 1}`,
        question: q.question.trim(),
        options: q.options.filter((o) => o?.trim()).slice(0, 4),
      })),
  };
}

export function themeFromIdentity(identity: VisualIdentity, kind: SiteKind): Theme {
  const arch = architecture(identity.architecture);
  return {
    colors: { ...identity.palette },
    fonts: { ...identity.fonts },
    layout: kind === "menu" ? "dense" : arch.rhythm === "airy" ? "minimal" : arch.rhythm === "tight" ? "dense" : "balanced",
    radius: arch.radius,
    architecture: identity.architecture,
  };
}

/* ------------------------------- colour maths ---------------------------- */

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Keeps the hue, pushes lightness until the pair is comfortably readable. */
function pickReadable(bg: string, preferred: string): string {
  const bgLum = relativeLuminance(bg);
  const target = bgLum > 0.4 ? "#14141a" : "#f7f7f8";
  return contrastRatio(preferred, bg) >= 7 ? preferred : target;
}

function darkenUntil(colour: string, bg: string, ratio: number): string {
  const m = colour.replace("#", "");
  let r = parseInt(m.slice(0, 2), 16);
  let g = parseInt(m.slice(2, 4), 16);
  let b = parseInt(m.slice(4, 6), 16);
  const towardsDark = relativeLuminance(bg) > 0.4;

  for (let i = 0; i < 24; i++) {
    const hex = `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
    if (contrastRatio(hex, bg) >= ratio) return hex;
    if (towardsDark) {
      r *= 0.88; g *= 0.88; b *= 0.88;
    } else {
      r = r + (255 - r) * 0.12;
      g = g + (255 - g) * 0.12;
      b = b + (255 - b) * 0.12;
    }
  }
  return towardsDark ? "#1a1a22" : "#f2f2f5";
}
