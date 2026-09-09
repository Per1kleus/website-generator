import "server-only";
import type { Locale } from "@/lib/locales";
import type { Site, SiteKind } from "@/lib/site";
import { parseMapsUrl } from "@/lib/maps";
import { themeFor } from "@/lib/styles";
import { assembleSite, generateContent } from "./content";
import { analyseIdentity, themeFromIdentity, type VisualIdentity } from "./identity";
import { emptyProfile, hasApiKey, researchBusiness, type BusinessProfile } from "./research";
import { addLocale, ensureSeo } from "./translate";

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
};

export type StageReporter = (stage: string, message: string) => void;

export async function runGeneration(
  input: GenerationInput,
  report: StageReporter = () => {},
): Promise<GenerationArtifacts> {
  const usedAi = hasApiKey();
  const maps = parseMapsUrl(input.mapsUrl);

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
    console.error("[generate] research failed:", err);
    profile = { ...emptyProfile(), name: input.businessName, category: input.businessType };
  }
  // The creator's own input always wins over research for contact details:
  // they know their own phone number.
  if (!profile.location) profile.location = input.location || maps.address;
  if (!profile.address) profile.address = maps.address;
  if (input.phone) profile.phone = input.phone;
  if (input.email) profile.email = input.email;

  /* 2. Identity + 3. Architecture ---------------------------------------- */
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
  });

  report("architecture", `Design direction: ${identity.architecture}`);
  const theme = usedAi
    ? themeFromIdentity(identity, input.siteKind)
    : themeFor(input.style, input.siteKind);

  /* 4. Content ----------------------------------------------------------- */
  report("content", "Writing the content");
  const { content } = await generateContent({
    profile,
    identity,
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
  return { site, profile, identity, usedAi };
}
