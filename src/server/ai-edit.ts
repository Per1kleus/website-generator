import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { newId, type Section, type Site } from "@/lib/site";
import { PALETTES } from "./palette";
import { hasApiKey } from "./generator";

const MODEL = "claude-opus-5";

export type EditResult = { site: Site; summary: string; changed: boolean };

const SYSTEM = `You edit a website's JSON document in response to a short instruction typed on a phone.

You receive the current document and an instruction. Return the COMPLETE updated document.

Rules:
- Return only the JSON document. Preserve the exact schema: keys, types, and the "id" of every section you keep.
- Never invent new section "type" values. Allowed types: hero, about, services, menu, gallery, hours, testimonials, cta, contact, footer.
- Keep copy mobile-first: headlines <= 8 words, subheadlines <= 20 words, card descriptions <= 15 words, paragraphs <= 2 sentences.
- Colours must be hex strings and must keep body text readable against the background (aim for a 4.5:1 contrast ratio).
- theme.layout is one of: minimal, balanced, dense. theme.fonts.heading/body are one of: system, serif, grotesk, rounded, mono.
- To remove a section, drop it from the array. To hide it instead, set visible to false.
- Do only what the instruction asks. Leave everything else byte-identical.
- Never write placeholder text.`;

/** Suggested commands surfaced in the mobile AI sheet (requirement 9). */
export const AI_SUGGESTIONS = [
  "Make it more luxurious",
  "Make it more minimal",
  "Change the colors",
  "Improve the mobile layout",
  "Add a gallery",
  "Remove this section",
  "Make the menu easier to navigate",
  "Shorten the text for phones",
  "Make the buttons stand out",
];

/* -------------------------------------------------------------------------
   Deterministic fallback. Without an API key the AI editor still does real,
   useful work for the most common phrasings rather than failing on a phone.
------------------------------------------------------------------------- */
function localEdit(site: Site, instruction: string): EditResult {
  const t = instruction.toLowerCase();
  const next: Site = structuredClone(site);
  let summary = "";

  if (/luxur|premium|elegant|upscale|expensive/.test(t)) {
    next.theme.colors = { ...PALETTES.plum };
    next.theme.fonts = { heading: "serif", body: "serif" };
    next.theme.layout = "minimal";
    next.theme.radius = 2;
    summary = "Applied an elegant, premium look: serif type, deeper palette, more space.";
  } else if (/minimal|simpler|clean|plainer|less busy/.test(t)) {
    next.theme.colors = { ...PALETTES.charcoal };
    next.theme.layout = "minimal";
    next.theme.radius = 4;
    summary = "Stripped it back: neutral palette, more whitespace, squarer corners.";
  } else if (/colou?r/.test(t)) {
    const keys = Object.keys(PALETTES);
    const current = JSON.stringify(next.theme.colors);
    const pick = keys.find((k) => JSON.stringify(PALETTES[k]) !== current) ?? keys[0];
    next.theme.colors = { ...PALETTES[pick] };
    summary = `Switched to the ${pick} palette.`;
  } else if (/mobile|phone|small screen|touch/.test(t)) {
    next.theme.layout = "balanced";
    next.meta.stickyCta.enabled = next.meta.kind !== "menu";
    for (const s of next.sections) {
      if (s.type === "hero" && s.props.headline.length > 45) {
        s.props.headline = s.props.headline.split(/\s+/).slice(0, 7).join(" ");
      }
    }
    summary = "Tightened the mobile layout and turned the sticky action bar back on.";
  } else if (/add a gallery|add gallery|add photos|add images/.test(t)) {
    const existing = next.sections.find((s) => s.type === "gallery");
    if (existing) {
      existing.visible = true;
      summary = "Turned the gallery section back on.";
    } else {
      const gallery: Section = {
        id: newId("gal"), type: "gallery", title: "Gallery", visible: true,
        props: { heading: "Gallery", imageIds: [] },
      };
      const footerAt = next.sections.findIndex((s) => s.type === "footer");
      next.sections.splice(footerAt < 0 ? next.sections.length : footerAt, 0, gallery);
      summary = "Added a gallery section. Upload photos to fill it.";
    }
  } else if (/menu.*(navigat|easier|find)|easier.*menu/.test(t)) {
    const menu = next.sections.find((s) => s.type === "menu");
    if (menu && menu.type === "menu") {
      menu.visible = true;
      next.theme.layout = "dense";
      // Move the menu directly after the hero: fewest taps from QR to prices.
      const i = next.sections.indexOf(menu);
      next.sections.splice(i, 1);
      next.sections.splice(1, 0, menu);
      summary = "Moved the menu to the top and tightened the spacing for quick scanning.";
    } else {
      summary = "There is no menu section on this site yet.";
      return { site, summary, changed: false };
    }
  } else if (/bolder|bold|stand out|punchy|vibrant/.test(t)) {
    next.theme.colors = { ...PALETTES.ember };
    next.theme.fonts.heading = "grotesk";
    next.theme.radius = 4;
    summary = "Turned up the contrast for a bolder, punchier feel.";
  } else if (/shorten|shorter|less text|concise/.test(t)) {
    for (const s of next.sections) {
      if (s.type === "hero") {
        s.props.subheadline = s.props.subheadline.split(/\s+/).slice(0, 16).join(" ");
      }
      if (s.type === "about") {
        s.props.body = s.props.body.split(/\n{2,}/).slice(0, 2).join("\n\n");
      }
    }
    summary = "Trimmed the copy so it fits a phone screen without scrolling.";
  } else {
    return {
      site,
      summary:
        "Connect an Anthropic API key to handle free-form edits. Without one I can still change colours, style, layout, and sections — try one of the suggestions.",
      changed: false,
    };
  }

  return { site: next, summary, changed: true };
}

export async function aiEdit(
  site: Site,
  instruction: string,
  focusSectionId?: string,
): Promise<EditResult> {
  if (!hasApiKey()) return localEdit(site, instruction);

  try {
    const client = new Anthropic();
    const focus = focusSectionId
      ? `\n\nThe user is currently editing the section with id "${focusSectionId}". If the instruction says "this section", it means that one.`
      : "";

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Current document:\n\n${JSON.stringify(site)}\n\nInstruction: ${instruction}${focus}\n\nReturn the complete updated JSON document, and nothing else.`,
        },
      ],
    });

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      return { site, summary: "I can't make that particular change.", changed: false };
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // The model may wrap JSON in a fence despite instructions; take the object.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON in response");

    const parsed = JSON.parse(text.slice(start, end + 1)) as Site;
    const validated = validateSite(parsed, site);
    return { site: validated, summary: "Applied your change.", changed: true };
  } catch (err) {
    console.error("[ai-edit] failed, falling back to local edit:", err);
    return localEdit(site, instruction);
  }
}

const ALLOWED_TYPES = new Set([
  "hero", "about", "services", "menu", "gallery", "hours",
  "testimonials", "cta", "contact", "footer",
]);

/**
 * Never trust a model response straight into the database. Anything malformed
 * falls back to the corresponding value from the document we started with.
 */
export function validateSite(candidate: Site, previous: Site): Site {
  const sections = Array.isArray(candidate.sections) ? candidate.sections : previous.sections;
  const clean = sections.filter(
    (s): s is Section =>
      Boolean(s) && typeof s === "object" && typeof s.id === "string" && ALLOWED_TYPES.has(s.type),
  );

  const hex = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : fallback;

  const pc = previous.theme.colors;
  const cc = candidate.theme?.colors ?? pc;

  return {
    version: 1,
    meta: {
      businessName: candidate.meta?.businessName || previous.meta.businessName,
      tagline: candidate.meta?.tagline ?? previous.meta.tagline,
      description: candidate.meta?.description ?? previous.meta.description,
      // The site kind is the user's choice, not the model's.
      kind: previous.meta.kind,
      language: candidate.meta?.language || previous.meta.language,
      stickyCta: {
        enabled: Boolean(candidate.meta?.stickyCta?.enabled ?? previous.meta.stickyCta.enabled),
        label: candidate.meta?.stickyCta?.label ?? previous.meta.stickyCta.label,
        href: candidate.meta?.stickyCta?.href ?? previous.meta.stickyCta.href,
      },
    },
    theme: {
      colors: {
        primary: hex(cc.primary, pc.primary),
        secondary: hex(cc.secondary, pc.secondary),
        accent: hex(cc.accent, pc.accent),
        bg: hex(cc.bg, pc.bg),
        text: hex(cc.text, pc.text),
      },
      fonts: {
        heading: ["system", "serif", "grotesk", "rounded", "mono"].includes(
          candidate.theme?.fonts?.heading,
        )
          ? candidate.theme.fonts.heading
          : previous.theme.fonts.heading,
        body: ["system", "serif", "grotesk", "rounded", "mono"].includes(
          candidate.theme?.fonts?.body,
        )
          ? candidate.theme.fonts.body
          : previous.theme.fonts.body,
      },
      layout: ["minimal", "balanced", "dense"].includes(candidate.theme?.layout)
        ? candidate.theme.layout
        : previous.theme.layout,
      radius:
        typeof candidate.theme?.radius === "number" &&
        candidate.theme.radius >= 0 &&
        candidate.theme.radius <= 40
          ? candidate.theme.radius
          : previous.theme.radius,
    },
    sections: clean.length ? clean : previous.sections,
  };
}
