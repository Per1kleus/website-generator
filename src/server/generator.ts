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
import { applyAltText, applyImages, assignRoles, inspectAssets, type ImageInsight } from "./images";
import { applySeo } from "@/lib/seo";
import { correctSite, type QaOutcome } from "@/lib/qa-fix";
import { formatReport } from "@/lib/visual-qa";
import type { Asset } from "./projects";
import type { BusinessFacts } from "@/lib/site";
import { ensureFirstLaunch, getState } from "./ollama";

export { hasApiKey };

/**
 * The generation pipeline (requirement 29):
 *
 *   INPUT -> RESEARCH -> IDENTITY ANALYSIS -> ARCHITECTURE -> CONTENT
 *         -> LAYOUT + TOKENS -> IMAGE INTELLIGENCE -> DESIGN REVIEW
 *         -> LOCALISATION -> SEO -> VISUAL QA -> SAFE CORRECTIONS -> READY
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
  /** What each photograph was measured to be, and what it was given to do. */
  images: ImageInsight[];
  /** The four-viewport check and the corrections it drove. */
  qa: QaOutcome;
};

export type StageReporter = (stage: string, message: string) => void;

export async function runGeneration(
  input: GenerationInput,
  report: StageReporter = () => {},
  /** The project's uploaded photographs. Nothing is invented when empty. */
  assets: Asset[] = [],
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

  /* 5b-ii. Image intelligence --------------------------------------------
     Which photograph belongs where, how it is cropped, and what the page
     reserves for it. All measurement, no model — and no photographs means no
     photograph-shaped sections rather than a grey box where one should be. */
  let insights: ImageInsight[] = [];
  if (assets.length) {
    report("design", `Placing ${assets.length} photograph${assets.length === 1 ? "" : "s"}`);
    try {
      insights = await inspectAssets(assets);
    } catch (err) {
      // A picture we cannot measure is a picture we do not place; the page is
      // still correct without it.
      console.error("[generate] image inspection failed:", describeError(err));
    }
  }
  const wantsGallery = site.sections.some((s) => s.type === "gallery" && s.visible);
  const placements = assignRoles(insights, {
    signals: layout.signals,
    kind: input.siteKind,
    wantsGallery,
  });
  site = applyImages(site, placements);
  if (placements.length) {
    const hero = placements.find((p) => p.role === "hero");
    report(
      "design",
      hero
        ? `The strongest photograph leads the page, cropped to its focal point`
        : `Photographs placed in the gallery; the hero is typographic`,
    );
  }

  /* Facts, carried on the document ---------------------------------------
     The renderer describes the business in its structured data long after
     generation, so what the research actually verified travels with the
     site rather than staying in a table the page cannot see. */
  site = { ...site, meta: { ...site.meta, facts: factsFromProfile(profile) } };

  // Alt text before translation, so every language gets it rather than
  // falling back to the default one.
  site = applyAltText(site, assets);

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

  /* 7. SEO ----------------------------------------------------------------
     Built from what the research verified and from copy the page already
     contains. Nothing is invented: a business whose location was never
     confirmed simply does not get a location in its title. */
  report("seo", "Generating SEO metadata");
  site = ensureSeo(site);
  site = applySeo(site, site.meta.facts ?? null);

  /* 8. Visual QA + targeted safe corrections ------------------------------
     Four widths, the same CSS the renderer emits, evaluated exactly. What can
     be fixed by changing a design decision is fixed, at most twice; what would
     need the business's own words changed is reported to the creator instead. */
  report("qa", "Checking the page at four screen sizes");
  const imageSizes = Object.fromEntries(
    assets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]),
  );
  const qa = correctSite({ site, locale: input.defaultLocale, images: imageSizes });
  site = qa.site;
  for (const correction of qa.applied.slice(0, 3)) report("qa", `Fixed: ${correction.what}`);
  report(
    "qa",
    `Visual QA ${qa.report.score}/100 — ${
      qa.report.issues.filter((i) => i.level === "error").length
    } to fix, ${qa.report.issues.filter((i) => i.level === "warning").length} to check`,
  );

  report("build", "Building the website");
  return {
    site,
    profile,
    identity,
    usedAi,
    skill,
    layout,
    critique: reviewed.critique,
    images: insights,
    qa,
  };
}

/**
 * What the research established, in the shape the document carries.
 *
 * `verifiedFields` is copied across untouched, because it is the field that
 * decides whether anything else here may be stated as fact. A value present
 * but unverified is still not claimed — see lib/seo.ts.
 */
function factsFromProfile(profile: BusinessProfile): BusinessFacts {
  return {
    category: profile.category,
    cuisineOrSpecialty: profile.cuisineOrSpecialty,
    location: profile.location,
    priceRange: profile.priceRange,
    services: profile.services.slice(0, 12),
    menuHighlights: profile.menuHighlights.map((m) => ({ name: m.name, price: m.price })),
    positioning: profile.positioning,
    verifiedFields: profile.verifiedFields,
  };
}

/** The readable four-viewport summary, for the report and the project screen. */
export { formatReport as formatQaReport };
