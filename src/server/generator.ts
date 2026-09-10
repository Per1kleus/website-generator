import "server-only";
import type { Locale } from "@/lib/locales";
import type { Site, SiteKind } from "@/lib/site";
import { parseMapsUrl } from "@/lib/maps";
import { themeFor } from "@/lib/styles";
import { assembleSite, generateContent } from "./content";
import { analyseIdentity, themeFromIdentity, type VisualIdentity } from "./identity";
import { emptyProfile, hasApiKey, researchBusiness, type BusinessProfile } from "./research";
import { describeError } from "./gemini";
import { addLocale, ensureSeo } from "./translate";
import { analyseWithSkill, type SkillDesign } from "./uiux";
import { applyLayoutPlan, planLayout, type LayoutPlan } from "./layout";
import { critique, type Critique } from "./critic";
import { ensureFirstLaunch, getState } from "./ollama";

export { hasApiKey };

/**
 * The generation pipeline (requirement 29):
 *
 *   INPUT -> RESEARCH -> IDENTITY ANALYSIS -> ARCHITECTURE -> CONTENT
 *         -> LOCALISATION -> BUILD -> SEO -> VALIDATION -> READY
 *
 * Each stage reports progress so the mobile progress screen can show a truthful
 * checklist, and each has a fallback so a failure never leaves a phone-only
 * user with nothing.
 */

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
  designNotes: string;
  logoAssetId: string | null;
  defaultLocale: Locale;
  locales: Locale[];
  /** Answers to the design questions, keyed by question text. */
  answers: Record<string, string>;
};

export type GenerationArtifacts = {
  site: Site;
  profile: BusinessProfile;
  identity: VisualIdentity;
  usedAi: boolean;
  /** What the ui-ux-pro-max skill recommended, for the creator to see. */
  skill: SkillDesign | null;
  /** What the content-aware layout engine decided, and why. */
  layout: LayoutPlan;
  /** What the design review found, and which corrections were applied. */
  critique: Critique;
};

export type StageReporter = (stage: string, message: string) => void;

export async function runGeneration(
  input: GenerationInput,
  report: StageReporter = () => {},
): Promise<GenerationArtifacts> {
  const usedAi = hasApiKey();
  const maps = parseMapsUrl(input.mapsUrl);

  // Idempotent: probes for Ollama once per process and starts the model
  // download in the background if it is missing. Never awaited for longer
  // than the probe, so a first generation is not held up by a download.
  void ensureFirstLaunch();

  /* 1. Research ---------------------------------------------------------- */
  report("research", usedAi ? "Researching the business" : "Reading your details");
  let profile: BusinessProfile;
  try {
    profile = await researchBusiness({
      businessName: input.businessName,
      businessType: input.businessType,
      mapsUrl: input.mapsUrl,
      location: input.location,
      description: input.description,
    });
  } catch (err) {
    console.error("[generate] research failed:", describeError(err));
    profile = { ...emptyProfile(), name: input.businessName, category: input.businessType };
  }
  // The creator's own input always wins over research for contact details:
  // they know their own phone number.
  if (!profile.location) profile.location = input.location || maps.address;
  if (!profile.address) profile.address = maps.address;
  if (input.phone) profile.phone = input.phone;
  if (input.email) profile.email = input.email;

  /* 2. Design intelligence ------------------------------------------------
     The ui-ux-pro-max skill supplies the catalogue knowledge — style, colour
     system, font pairing, landing pattern, section order. The local model's
     only job is to ask it a good question, which is where most of the quality
     comes from: the same business asked badly returns a crypto/kiosk system,
     asked well returns the right warm bakery one. */
  report("analysis", "Consulting the design catalogue");
  const skill = await analyseWithSkill({
    profile,
    businessName: input.businessName,
    businessType: input.businessType,
    description: input.description,
    kind: input.siteKind,
    designNotes: input.designNotes,
  });
  if (skill) {
    report(
      "analysis",
      `${skill.rationale}${skill.query.source === "local-model" ? " (local model)" : ""}`,
    );
  }

  /* 3. Identity + architecture ------------------------------------------- */
  report("analysis", "Analysing the visual identity");
  const identity = await analyseIdentity({
    profile,
    businessName: input.businessName,
    businessType: input.businessType,
    description: input.description,
    kind: input.siteKind,
    stylePreset: input.style,
    logoAssetId: input.logoAssetId,
    designNotes: input.designNotes,
    // The skill's recommendation is a strong prior, not a veto: a hosted model
    // that can actually see the logo and read the research may still know
    // better about this specific business.
    skill,
  });

  report("architecture", `Design direction: ${identity.architecture}`);

  /* The theme is layered, best source first:
       hosted identity analysis  (sees the logo and the research)
       > the skill's catalogue   (real design knowledge, no key needed)
       > the creator's preset    (last resort)
     Web fonts only ever come from the skill, so they survive either way. */
  const theme = usedAi
    ? themeFromIdentity(identity, input.siteKind, skill?.theme.fontFamilies ?? null)
    : skill
      ? skill.theme
      : themeFor(input.style, input.siteKind);

  /* 4. Content ----------------------------------------------------------- */
  report("content", "Writing the content");
  const { content } = await generateContent({
    profile,
    identity,
    // The skill's landing pattern decides section order when the hosted
    // analysis did not produce a plan of its own.
    skillSectionPlan: skill?.sectionPlan ?? [],
    businessName: input.businessName,
    businessType: input.businessType,
    description: input.description,
    kind: input.siteKind,
    locale: input.defaultLocale,
    answers: input.answers,
  });

  /* 5. Build ------------------------------------------------------------- */
  let site = assembleSite({
    content,
    identity,
    theme,
    businessName: input.businessName,
    kind: input.siteKind,
    locale: input.defaultLocale,
    phone: input.phone || profile.phone,
    email: input.email || profile.email,
    mapsUrl: maps.valid ? input.mapsUrl : "",
    logo: input.logoAssetId
      ? { assetId: input.logoAssetId, height: 36, transparent: true }
      : null,
  });

  /* 5b. Design systems ---------------------------------------------------
     The catalogue chose the direction and the model wrote the content; these
     three decide how the page is actually composed, and they are deterministic:
     the layout engine reads what the document really contains, the token
     engine turns that into one coherent visual language, and the heuristics
     check the result against the patterns that make a page look generated. */
  report("design", "Composing the layout for this business");
  const layout = planLayout({
    site,
    profile,
    identity,
    skill,
    businessType: input.businessType,
    description: input.description,
  });
  site = applyLayoutPlan(site, layout);
  for (const note of layout.notes.slice(0, 3)) report("design", note);

  /* 5c. Design review -----------------------------------------------------
     Deterministic findings first; a single hosted critique only when they
     show something worth a second opinion. A page that already reads as
     designed costs nothing here. */
  const reviewed = await critique(site, layout.signals);
  site = reviewed.site;
  if (reviewed.critique.applied.length) {
    report("design", `Design review: ${reviewed.critique.applied.join(", ")}`);
  }

  /* 6. Localisation ------------------------------------------------------ */
  const extra = input.locales.filter((l) => l !== input.defaultLocale);
  if (extra.length === 0) {
    // Single language: skip the localisation work entirely (requirement 29).
    report("localize", "One language — nothing to translate");
  } else {
    for (const locale of extra) {
      report("localize", `Translating into ${locale.toUpperCase()}`);
      site = await addLocale(site, locale);
    }
  }

  /* 7. SEO --------------------------------------------------------------- */
  report("seo", "Generating SEO metadata");
  site = ensureSeo(site);

  report("build", "Building the website");
  return { site, profile, identity, usedAi, skill, layout, critique: reviewed.critique };
}
