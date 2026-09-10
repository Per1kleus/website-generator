#!/usr/bin/env node
/**
 * Design systems test.
 *
 * Exercises the four systems that decide how a generated website is composed:
 * the human design heuristics, the content-aware layout engine, the design
 * token engine and the critic's corrections. Three of the four are
 * deterministic, so most of this runs with no server and no network.
 *
 * The suite is written to fail in both directions: a heuristic that flags a
 * legitimate design is as wrong as one that misses a template, and a token
 * engine that varies at random is as wrong as one that never varies.
 *
 *   node scripts/design-systems-qa.mjs
 */
// The systems are TypeScript; tsx compiles them on the fly. The runner is
// started with --import tsx, which is how a modern Node loads it.
const { deriveTokens, readSignals, NEUTRAL_SIGNALS } = await import("../src/lib/tokens.ts");
const { reviewDesign, designScore } = await import("../src/lib/heuristics.ts");
const { planLayout, applyLayoutPlan, contentProfile } = await import("../src/server/layout.ts");
const { applyCorrections, correctionsFromFindings } = await import("../src/server/critic.ts");
const { renderSite } = await import("../src/lib/render.ts");

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ---------------------------------------------------------------- fixtures */

let counter = 0;
const id = (prefix) => `${prefix}_${++counter}`;

/** A site document with whatever sections a case needs. */
function makeSite(sections, { architecture = "modern", kind = "business", strings = {} } = {}) {
  const catalog = { strings: { ...strings }, seo: { title: "", description: "", ogTitle: "", ogDescription: "", keywords: [] } };
  return {
    version: 2,
    meta: {
      businessName: "Test Business",
      kind,
      defaultLocale: "en",
      locales: ["en"],
      logo: null,
      stickyCta: { enabled: false, href: "#contact" },
    },
    theme: {
      colors: { primary: "#4338ca", secondary: "#312e81", accent: "#b45309", bg: "#fbfbfd", text: "#14141a" },
      fonts: { heading: "serif", body: "system" },
      fontFamilies: null,
      layout: "balanced",
      radius: 12,
      architecture,
    },
    sections,
    i18n: { en: catalog },
  };
}

const services = (count, layout) => ({
  id: id("sec"), type: "services", visible: true, ...(layout ? { layout } : {}),
  items: Array.from({ length: count }, () => ({ id: id("itm"), price: "" })),
});
const testimonials = (count, layout) => ({
  id: id("sec"), type: "testimonials", visible: true, ...(layout ? { layout } : {}),
  items: Array.from({ length: count }, () => ({ id: id("tst") })),
});
const gallery = (count, layout) => ({
  id: id("sec"), type: "gallery", visible: true, ...(layout ? { layout } : {}),
  imageIds: Array.from({ length: count }, () => id("img")),
});
const about = (layout, imageId = "") => ({
  id: id("sec"), type: "about", visible: true, ...(layout ? { layout } : {}),
  imageId, highlights: [{ id: id("hl") }, { id: id("hl") }],
});
const hero = (imageId = "") => ({
  id: id("sec"), type: "hero", visible: true, ctaHref: "#contact", secondaryHref: "#main", imageId,
});
const contact = () => ({
  id: id("sec"), type: "contact", visible: true, phone: "+30 231 000 0000", email: "a@b.gr", mapsUrl: "", bookingUrl: "",
});
const cta = () => ({ id: id("sec"), type: "cta", visible: true, ctaHref: "#contact" });
const footer = () => ({ id: id("sec"), type: "footer", visible: true, links: [] });

const emptyProfile = {
  name: "", category: "", cuisineOrSpecialty: "", location: "", address: "", phone: "", email: "",
  website: "", openingHours: [], priceRange: "", rating: "", reviewThemes: [], services: [],
  menuHighlights: [], atmosphere: "", targetAudience: "", positioning: "", verifiedFields: [],
  sources: [], unknowns: [], confidence: "low",
};

/* ------------------------------------------------------- human heuristics */

console.log("\n=== Human design heuristics ===\n");

{
  // The classic generated page: everything is a card grid.
  const site = makeSite([hero(), services(3, "cards"), testimonials(3, "cards"), about("cards"), contact(), footer()]);
  const findings = reviewDesign(site, { signals: NEUTRAL_SIGNALS });
  const ids = findings.map((f) => f.id);
  record("three card sections are flagged as one repeated silhouette", ids.includes("card-repetition"));
  record("the finding names a specific correction, not 'improve the design'",
    /list|editorial|index/.test(findings.find((f) => f.id === "card-repetition")?.correction ?? ""));
  record("a repeated silhouette scores badly", designScore(findings) < 80, String(designScore(findings)));
}

{
  // A page composed with variety is left alone.
  const site = makeSite([hero(), services(4, "cards"), testimonials(2, "inline"), about("editorial"), contact(), footer()]);
  const findings = reviewDesign(site, { signals: NEUTRAL_SIGNALS });
  record("a varied page raises no repetition finding",
    !findings.some((f) => f.id === "card-repetition" || f.id === "uniform-structure"),
    findings.map((f) => f.id).join(", "));
}

{
  // Large whitespace: intentional for a formal, spare business...
  const luxury = makeSite([hero(), about("statement"), services(3, "list"), contact(), footer()], { architecture: "luxury" });
  luxury.theme.tokens = deriveTokens({
    architectureId: "luxury", kind: "business",
    signals: readSignals({ text: "luxury boutique hotel", content: { services: 3, menuItems: 0, images: 8, testimonials: 1, words: 200 } }),
  });
  const luxFindings = reviewDesign(luxury, { signals: readSignals({ text: "luxury boutique hotel" }) });
  record("generous whitespace is not flagged for a spare luxury business",
    !luxFindings.some((f) => f.id === "unearned-whitespace"));

  // ...and questioned when the page is dense with information.
  const dense = makeSite([hero(), about("editorial"), services(9, "list"), contact(), footer()], { architecture: "luxury" });
  dense.theme.tokens = { ...luxury.theme.tokens, space: { ...luxury.theme.tokens.space, section: 6.2 } };
  const denseFindings = reviewDesign(dense, {
    signals: { ...NEUTRAL_SIGNALS, informationDensity: 0.85 },
  });
  record("the same whitespace is questioned on an information-heavy page",
    denseFindings.some((f) => f.id === "unearned-whitespace"));
}

{
  // Motion: right for a gym, wrong for a law firm — same token, different verdict.
  const gymTokens = deriveTokens({ architectureId: "modern", kind: "business", signals: readSignals({ text: "modern gym fitness training" }) });
  const gym = makeSite([hero(), services(4, "cards"), contact(), footer()]);
  gym.theme.tokens = gymTokens;
  record("expressive motion is not flagged for a gym",
    !reviewDesign(gym, { signals: readSignals({ text: "modern gym fitness training" }) }).some((f) => f.id === "over-animation"),
    `motion=${gymTokens.motion}`);

  const firm = makeSite([hero(), services(4, "list"), contact(), footer()]);
  firm.theme.tokens = { ...gymTokens, motion: "expressive" };
  record("the same expressive motion is flagged for a law firm",
    reviewDesign(firm, { signals: readSignals({ text: "law firm solicitor legal" }) }).some((f) => f.id === "over-animation"));
}

{
  const site = makeSite([hero(), services(3, "cards"), contact(), footer()], {
    strings: { [`${"x"}.ctaLabel`]: "Get started", "y.ctaLabel": "Learn more" },
  });
  const findings = reviewDesign(site, { signals: NEUTRAL_SIGNALS });
  record("boilerplate calls to action are detected", findings.some((f) => f.id === "generic-cta"));
}

{
  const site = makeSite([hero(), gallery(0), testimonials(0), contact(), footer()]);
  const findings = reviewDesign(site, { signals: NEUTRAL_SIGNALS });
  record("sections visible with nothing in them are flagged", findings.some((f) => f.id === "empty-sections"));
}

{
  // Short words in the lexicon must not match inside longer ones: "ai" inside
  // "training" once read a gym as a technology company and halved its energy.
  const gym = readSignals({ text: "modern gym strength and conditioning barbell classes personal training" });
  record("a gym reads as energetic, not technical", gym.energy > 0.75 && gym.warmth >= 0.4,
    `energy ${gym.energy}`);
  const neutral = readSignals({ text: "retail shop selling homeware and maintenance supplies" });
  record("words with no design meaning leave the signals neutral",
    JSON.stringify(neutral) === JSON.stringify(NEUTRAL_SIGNALS), JSON.stringify(neutral));
  const salon = readSignals({ text: "hair salon and barber" });
  record("a salon is not read as a healthcare clinic", salon.formality < 0.6, `formality ${salon.formality}`);
}

/* -------------------------------------------------------- layout engine */

console.log("\n=== Content-aware layout ===\n");

function planFor(text, sections, overrides = {}) {
  const site = makeSite(sections, overrides.siteOptions);
  const plan = planLayout({
    site,
    profile: { ...emptyProfile, ...(overrides.profile ?? {}) },
    identity: null,
    skill: null,
    businessType: text,
    description: text,
    libraryImages: overrides.libraryImages ?? 0,
  });
  return { site, plan, applied: applyLayoutPlan(site, plan) };
}

{
  // Image-heavy: a detailer with photographs leads with them.
  const { plan, applied } = planFor(
    "luxury car detailing studio showcase photography",
    [hero("img1"), about("", "img2"), services(5), gallery(12), contact(), footer()],
  );
  const heroSection = applied.sections.find((s) => s.type === "hero");
  record("an image-heavy business gets an image-led hero", heroSection.layout === "image-led", heroSection.layout);
  record("its gallery becomes a mosaic rather than a plain grid",
    applied.sections.find((s) => s.type === "gallery").layout === "mosaic");
  record("its services are not a card grid",
    applied.sections.find((s) => s.type === "services").layout !== "cards",
    applied.sections.find((s) => s.type === "services").layout);
  record("the signals read it as visual", plan.signals.visualWeight > 0.7, String(plan.signals.visualWeight));
}

{
  // Information-heavy with no pictures: an accountant.
  const { plan, applied } = planFor(
    "accountancy audit tax advisory practice",
    [hero(), about(), services(9), testimonials(3), contact(), footer()],
    { profile: { verifiedFields: ["name", "category"] } },
  );
  const heroSection = applied.sections.find((s) => s.type === "hero");
  record("an information-heavy business does not get an image-led hero", heroSection.layout !== "image-led", heroSection.layout);
  record("its many services become an index or list",
    ["index", "list"].includes(applied.sections.find((s) => s.type === "services").layout),
    applied.sections.find((s) => s.type === "services").layout);
  record("its testimonials are not a card grid",
    applied.sections.find((s) => s.type === "testimonials").layout !== "cards",
    applied.sections.find((s) => s.type === "testimonials").layout);
  record("the design system is dense rather than airy", applied.theme.tokens.density === "dense", applied.theme.tokens.density);
}

{
  // Service-heavy but visual: two services is a statement, not a grid of two.
  const { applied } = planFor("interior design studio", [hero("i"), services(2), contact(), footer()]);
  record("two services are set as a statement, not a grid of two",
    applied.sections.find((s) => s.type === "services").layout === "statement");
}

{
  // A restaurant with a real menu.
  const menuSection = {
    id: id("sec"), type: "menu", visible: true,
    categories: [
      { id: id("cat"), items: Array.from({ length: 9 }, () => ({ id: id("it"), price: "4.50", tags: [] })) },
      { id: id("cat"), items: Array.from({ length: 7 }, () => ({ id: id("it"), price: "6.00", tags: [] })) },
    ],
  };
  const { plan, applied } = planFor(
    "traditional family taverna village",
    [hero("i"), about("", "i2"), menuSection, contact(), footer()],
    { siteOptions: { kind: "menu" } },
  );
  record("a menu with several categories gets an indexed menu layout",
    applied.sections.find((s) => s.type === "menu").layout === "index");
  record("a digital menu keeps a typographic hero, whatever else is true",
    applied.sections.find((s) => s.type === "hero").layout === "typographic");
  record("a menu never animates", applied.theme.tokens.motion === "none");
  record("its items are counted as content", plan.content.menuItems === 16, String(plan.content.menuItems));
}

{
  // Almost nothing verified: sections are switched off, never filled.
  const { plan, applied } = planFor(
    "new business",
    [hero(), about(), services(0), gallery(0), testimonials(0), cta(), contact(), footer()],
  );
  const off = applied.sections.filter((s) => !s.visible).map((s) => s.type);
  record("a section with no services is switched off", off.includes("services"));
  record("a section with no photographs is switched off", off.includes("gallery"));
  record("a section with no reviews is switched off", off.includes("testimonials"));
  record("nothing is invented to fill them",
    applied.sections.every((s) => (s.type !== "services" || s.items.length === 0)));
  record("the reasons are recorded for the creator", plan.notes.length >= 3, `${plan.notes.length} notes`);
}

{
  // Determinism: the same inputs must produce the same design, twice.
  const first = planFor("greek taverna", [hero("i"), about(), services(4), contact(), footer()]);
  const second = planFor("greek taverna", [hero("i"), about(), services(4), contact(), footer()]);
  record("the same business produces the same design twice",
    JSON.stringify(first.applied.theme.tokens) === JSON.stringify(second.applied.theme.tokens));
}

/* --------------------------------------------------------- design tokens */

console.log("\n=== Design tokens ===\n");

const profiles = {
  hotel: readSignals({ text: "luxury boutique hotel spa suites", content: { services: 4, menuItems: 0, images: 10, testimonials: 3, words: 300 } }),
  taverna: readSignals({ text: "traditional family taverna village handmade", content: { services: 0, menuItems: 22, images: 6, testimonials: 2, words: 250 } }),
  accountant: readSignals({ text: "accountancy audit tax advisory", content: { services: 9, menuItems: 0, images: 0, testimonials: 4, words: 800 } }),
  gym: readSignals({ text: "modern gym fitness training performance", content: { services: 6, menuItems: 0, images: 8, testimonials: 5, words: 300 } }),
};

const tokenSets = Object.fromEntries(
  Object.entries(profiles).map(([name, signals]) => [
    name,
    deriveTokens({ architectureId: name === "hotel" ? "luxury" : name === "taverna" ? "mediterranean" : name === "accountant" ? "classic" : "modern", kind: "business", signals }),
  ]),
);

record("every token set is internally complete",
  Object.values(tokenSets).every(
    (t) => t.type && t.space && t.shape && t.surface && t.image && t.motion && t.density,
  ));

record("spacing scales are sane and bounded",
  Object.values(tokenSets).every((t) => t.space.section >= 2.4 && t.space.section <= 7 && t.space.gap > 0));

record("measures stay inside a readable range",
  Object.values(tokenSets).every((t) => t.type.measure >= 45 && t.type.measure <= 80));

record("radius is coherent: buttons are never smaller than cards by accident",
  Object.values(tokenSets).every((t) => t.shape.button >= t.shape.card || t.shape.buttonShape === "square"));

record("a luxury hotel gets restrained shadows and minimal motion",
  tokenSets.hotel.shape.shadow !== "lifted" && tokenSets.hotel.motion !== "expressive",
  `${tokenSets.hotel.shape.shadow}/${tokenSets.hotel.motion}`);

record("a gym gets heavier type than a hotel",
  tokenSets.gym.type.headingWeight > tokenSets.hotel.type.headingWeight,
  `${tokenSets.gym.type.headingWeight} vs ${tokenSets.hotel.type.headingWeight}`);

record("an accountant's page is denser than a hotel's",
  tokenSets.accountant.space.section < tokenSets.hotel.space.section,
  `${tokenSets.accountant.space.section} vs ${tokenSets.hotel.space.section}`);

record("four businesses produce four different design systems",
  new Set(Object.values(tokenSets).map((t) => JSON.stringify(t))).size === 4);

record("token derivation is deterministic",
  JSON.stringify(deriveTokens({ architectureId: "luxury", kind: "business", signals: profiles.hotel })) ===
    JSON.stringify(tokenSets.hotel));

/* --------------------------------------------------------------- critic */

console.log("\n=== Design critic corrections ===\n");

{
  const site = makeSite([hero(), services(3, "cards"), testimonials(3, "cards"), about("cards"), contact(), footer()]);
  site.theme.tokens = deriveTokens({ architectureId: "modern", kind: "business", signals: NEUTRAL_SIGNALS });
  const findings = reviewDesign(site, { signals: NEUTRAL_SIGNALS });
  const corrections = correctionsFromFindings(findings);
  record("the rules alone produce corrections without any model",
    corrections.includes("vary-section-composition"), corrections.join(", "));

  const before = JSON.stringify(site);
  const { site: fixed, applied, notes } = applyCorrections(site, corrections, findings);
  record("applying them changes the composition", JSON.stringify(fixed) !== before);
  record("the first card grid is kept and the rest recomposed",
    fixed.sections.filter((s) => (s.layout ?? "cards") === "cards" && s.type !== "hero").length === 1);
  record("the document keeps its shape — same sections, same ids",
    fixed.sections.length === site.sections.length &&
      fixed.sections.every((s, i) => s.id === site.sections[i].id && s.type === site.sections[i].type));
  record("no strings were touched", JSON.stringify(fixed.i18n) === JSON.stringify(site.i18n));
  record("each correction is reported in a readable line", notes.length === applied.length && notes.every((n) => n.length > 10));

  const after = reviewDesign(fixed, { signals: NEUTRAL_SIGNALS });
  record("the corrected page scores better than the original",
    designScore(after) > designScore(findings), `${designScore(findings)} → ${designScore(after)}`);
}

{
  // A page that already works must be left completely alone.
  const site = makeSite([hero("i"), about("split", "i"), services(4, "index"), contact(), footer()]);
  site.theme.tokens = deriveTokens({ architectureId: "editorial", kind: "business", signals: readSignals({ text: "architecture studio" }) });
  const findings = reviewDesign(site, { signals: readSignals({ text: "architecture studio" }) });
  const corrections = correctionsFromFindings(findings);
  const { site: after, applied } = applyCorrections(site, corrections, findings);
  record("a page that already reads as designed gets no corrections", applied.length === 0, corrections.join(", "));
  record("and is returned byte-identical", JSON.stringify(after) === JSON.stringify(site));
  record("its score is above the threshold for asking for a second opinion",
    designScore(findings) >= 90, String(designScore(findings)));
}

{
  // The critic may not invent an image-led hero where there is no image.
  const site = makeSite([hero(""), services(3, "cards"), contact(), footer()]);
  site.theme.tokens = deriveTokens({ architectureId: "modern", kind: "business", signals: NEUTRAL_SIGNALS });
  const { site: after, applied } = applyCorrections(site, ["image-led-hero"], []);
  record("an image-led hero is refused when there is no photograph",
    !applied.includes("image-led-hero") && after.sections.find((s) => s.type === "hero").layout === undefined);
}

{
  // Corrections outside the vocabulary do nothing at all.
  const site = makeSite([hero(), services(3, "cards"), contact(), footer()]);
  const { applied } = applyCorrections(site, ["make-it-pop", "add-parallax"], []);
  record("an unknown correction is ignored rather than interpreted", applied.length === 0);
}

/* ------------------------------------------------------------ rendering */

console.log("\n=== Rendering ===\n");

{
  const cards = makeSite([hero(), services(3, "cards"), contact(), footer()], { strings: {} });
  const list = makeSite([hero(), services(3, "list"), contact(), footer()]);
  const index = makeSite([hero(), services(5, "index"), contact(), footer()]);
  for (const s of [cards, list, index]) {
    s.theme.tokens = deriveTokens({ architectureId: "modern", kind: "business", signals: NEUTRAL_SIGNALS });
  }
  const htmlCards = renderSite(cards, "en", {});
  const htmlList = renderSite(list, "en", {});
  const htmlIndex = renderSite(index, "en", {});

  record("the card layout renders cards", htmlCards.includes('class="card"'));
  record("the list layout renders a ruled list instead", htmlList.includes("lay-list") && !htmlList.includes('<article class="card"'));
  record("the index layout renders a numbered index", htmlIndex.includes("lay-index"));
  record("three layouts produce three different documents",
    new Set([htmlCards, htmlList, htmlIndex]).size === 3);

  // Tokens must actually reach the stylesheet.
  const airy = makeSite([hero(), services(3, "cards"), contact(), footer()]);
  airy.theme.tokens = { ...cards.theme.tokens, space: { ...cards.theme.tokens.space, section: 6.5 } };
  record("a change in the spacing token changes the rendered CSS",
    renderSite(airy, "en", {}) !== htmlCards);
}

{
  // A document with no tokens at all — everything generated before this
  // system existed — must still render.
  const legacy = makeSite([hero(), services(3), contact(), footer()]);
  delete legacy.theme.tokens;
  const html = renderSite(legacy, "en", {});
  record("a document with no design system still renders", html.includes("<!doctype html") && html.length > 2000);
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}`);
  process.exit(1);
}
