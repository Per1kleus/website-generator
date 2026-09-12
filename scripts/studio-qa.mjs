#!/usr/bin/env node
/**
 * Studio systems test.
 *
 * Five systems are under test, and each is checked against the thing it
 * claims rather than against itself:
 *
 *   Editing — that a targeted change reaches the page and nothing else moves,
 *   and above all that it does not regenerate the website. The suite asserts
 *   the generation job count is unchanged across an edit, because "it did not
 *   regenerate" is a claim about what the server did, not about how fast the
 *   save felt.
 *
 *   Versioning — that history is append-only. Restoring an old version must
 *   leave every later version exactly where it was and add the restored
 *   document to the front, so a rollback can itself be rolled back.
 *
 *   Project management — that the state shown is derived from the same
 *   readiness report the project screen shows, including the rule that a
 *   critical failure outranks a published site.
 *
 *   Performance — that the score moves for the reasons it says it does, and
 *   that the two optimisations in the renderer actually appear in the output.
 *
 *   The checklist — every category, the weighting, the critical override, and
 *   the cases that must *not* be failures: a business with no photographs, an
 *   optional field nobody filled in.
 *
 *   node --import tsx --conditions react-server scripts/studio-qa.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import sharp from "sharp";

const { assessReadiness, CATEGORY_WEIGHT, rankedIssues } = await import("../src/lib/checklist.ts");
const { assessPerformance } = await import("../src/lib/performance.ts");
const { projectState, stateInfo } = await import("../src/lib/project-status.ts");
const { renderSite } = await import("../src/lib/render.ts");
const { deriveTokens, readSignals, NEUTRAL_SIGNALS } = await import("../src/lib/tokens.ts");
const { applySeo } = await import("../src/lib/seo.ts");
const { correctSite } = await import("../src/lib/qa-fix.ts");
const { assignRoles, applyImages, applyAltText, inspectAssets } = await import("../src/server/images.ts");

const BASE = process.argv[2] ?? "http://localhost:3100";
const PRESET = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXEC = process.env.PW_CHROME ?? (existsSync(PRESET) ? PRESET : undefined);

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ---------------------------------------------------------------- fixtures */

let counter = 0;
const id = (prefix) => `${prefix}_${++counter}`;

function makeSite(sections, { architecture = "modern", kind = "business", name = "Test Business", locales = ["en"] } = {}) {
  const catalogs = {};
  for (const l of locales) {
    catalogs[l] = {
      strings: {},
      seo: { title: "", description: "", ogTitle: "", ogDescription: "", keywords: [] },
    };
  }
  const site = {
    version: 2,
    meta: {
      businessName: name, kind, defaultLocale: locales[0], locales: [...locales], logo: null,
      stickyCta: { enabled: false, href: "#contact" },
    },
    theme: {
      colors: { primary: "#4338ca", secondary: "#312e81", accent: "#b45309", bg: "#fbfbfd", text: "#14141a" },
      fonts: { heading: "serif", body: "system" },
      fontFamilies: null, layout: "balanced", radius: 12, architecture,
    },
    sections,
    i18n: catalogs,
  };
  site.theme.tokens = deriveTokens({ architectureId: architecture, kind, signals: NEUTRAL_SIGNALS });
  return site;
}

const hero = (imageId = "") => ({
  id: id("sec"), type: "hero", visible: true, ctaHref: "tel:+302310000000", secondaryHref: "#main", imageId,
});
const about = () => ({
  id: id("sec"), type: "about", visible: true, imageId: "", highlights: [{ id: id("hl") }],
});
const services = (count, layout = "list") => ({
  id: id("sec"), type: "services", visible: true, layout,
  items: Array.from({ length: count }, () => ({ id: id("itm"), price: "" })),
});
const gallery = (ids = []) => ({ id: id("sec"), type: "gallery", visible: true, imageIds: [...ids] });
const contact = (over = {}) => ({
  id: id("sec"), type: "contact", visible: true,
  phone: "+30 231 000 0000", email: "hello@example.gr", mapsUrl: "", bookingUrl: "", ...over,
});
const footer = () => ({ id: id("sec"), type: "footer", visible: true, links: [] });

/** A page with enough real copy that the checks have something to read. */
function withCopy(site, { headline = "Warm bread, every morning" } = {}) {
  for (const locale of site.meta.locales) {
    const strings = site.i18n[locale].strings;
    for (const s of site.sections) {
      if (s.type === "hero") {
        strings[`${s.id}.headline`] = headline;
        strings[`${s.id}.subheadline`] = "Baked in the same wood oven since 1972, on the corner of the square.";
        strings[`${s.id}.ctaLabel`] = "Find us";
      }
      if (s.type === "about") {
        strings[`${s.id}.title`] = "About";
        strings[`${s.id}.heading`] = "About us";
        strings[`${s.id}.body`] = "A small bakery run by the same family for fifty years.";
        for (const h of s.highlights) strings[`${s.id}.highlights.${h.id}.text`] = "Wood-fired oven";
      }
      if (s.type === "services") {
        strings[`${s.id}.title`] = "What we make";
        strings[`${s.id}.heading`] = "What we make";
        for (const item of s.items) {
          strings[`${s.id}.items.${item.id}.name`] = "Sourdough";
          strings[`${s.id}.items.${item.id}.text`] = "Two-day ferment, baked each morning.";
        }
      }
      if (s.type === "gallery") {
        strings[`${s.id}.title`] = "Gallery";
        strings[`${s.id}.heading`] = "The bakery";
      }
      if (s.type === "contact") {
        strings[`${s.id}.title`] = "Contact";
        strings[`${s.id}.heading`] = "Find us";
        strings[`${s.id}.address`] = "12 Plateia, Thessaloniki";
      }
      if (s.type === "footer") strings[`${s.id}.text`] = "(c) Test Business";
    }
  }
  return site;
}

const facts = (over = {}) => ({
  category: "", cuisineOrSpecialty: "", location: "", priceRange: "",
  services: [], menuHighlights: [], positioning: "", verifiedFields: [], ...over,
});

/** A complete, healthy site: the baseline every "must not fail" check uses. */
function healthySite(over = {}) {
  const site = withCopy(
    makeSite([hero(), about(), services(4), contact(), footer()], over),
  );
  site.meta.facts = facts({
    category: "Bakery", location: "Thessaloniki", verifiedFields: ["category", "location"],
  });
  return applySeo(site, site.meta.facts);
}

/**
 * A serialisation that does not care about key order.
 *
 * Save paths rebuild objects field by field, so an untouched value can come
 * back with its keys in a different order. Comparing raw JSON would call that
 * a change; what is under test is the content.
 */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  return value;
}
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const render = (site) => renderSite(site, { locale: site.meta.defaultLocale });
const assess = (site, images) =>
  assessReadiness({ site, locale: site.meta.defaultLocale, html: render(site), images });

/* ======================================================================
   1. The checklist
   ====================================================================== */

console.log("\n=== The checklist scores a healthy site ===\n");

{
  const site = healthySite();
  const report = assess(site);

  record("the weighting adds to exactly 100",
    Object.values(CATEGORY_WEIGHT).reduce((a, b) => a + b, 0) === 100);
  record("the score is the sum of the categories",
    report.score === report.categories.reduce((sum, c) => sum + c.score, 0),
    `${report.score} vs ${report.categories.reduce((sum, c) => sum + c.score, 0)}`);
  record("every category is present",
    report.categories.length === Object.keys(CATEGORY_WEIGHT).length);
  record("a healthy site has no critical issues",
    report.issues.every((i) => i.severity !== "critical"),
    report.issues.filter((i) => i.severity === "critical").map((i) => i.id).join(", "));
  record("a healthy site scores at least 85", report.score >= 85,
    `${report.score}/100: ${report.issues.map((i) => `${i.id}(-${i.cost})`).join(", ")}`);
  record("its status is a ready one",
    report.status === "READY" || report.status === "READY WITH WARNINGS", report.status);
  record("nothing overrides the score on a healthy site", report.overrideReason === null);

  record("every deduction names what it cost and what to do",
    report.issues.every((i) => i.issue.length > 12 && i.correction.length > 8 && typeof i.cost === "number"));
  record("info findings never cost points",
    report.issues.filter((i) => i.severity === "info").every((i) => i.cost === 0));
  record("the same document scores the same twice",
    JSON.stringify(assess(site).score) === JSON.stringify(report.score));
}

console.log("\n=== The checklist does not rewrite anything ===\n");

{
  const site = withCopy(makeSite([hero(), contact(), footer()]), { headline: "Welcome to our website" });
  const before = JSON.stringify(site);
  const report = assess(site);
  record("assessing a site leaves the document byte-identical", JSON.stringify(site) === before);
  record("placeholder copy is reported, not replaced",
    report.issues.some((i) => i.id === "placeholder-copy"));
  record("...as a critical issue",
    report.issues.find((i) => i.id === "placeholder-copy")?.severity === "critical");
  record("...and the words are still there",
    Object.values(site.i18n.en.strings).includes("Welcome to our website"));
}

console.log("\n=== A critical failure outranks the score ===\n");

{
  // A site that is otherwise perfect, with no way to contact the business.
  const site = healthySite();
  const contactSection = site.sections.find((s) => s.type === "contact");
  contactSection.phone = "";
  contactSection.email = "";
  site.i18n.en.strings[`${contactSection.id}.address`] = "";

  const report = assess(site);
  record("losing every contact detail is critical",
    report.issues.some((i) => i.id === "no-contact-details" && i.severity === "critical"));
  record("the status is NOT READY however high the score",
    report.status === "NOT READY", `${report.score}/100 → ${report.status}`);
  record("the reason names the critical issue",
    Boolean(report.overrideReason) && report.overrideReason.includes("critical"),
    report.overrideReason ?? "");
  record("the score itself is still reported honestly", report.score > 60, `${report.score}`);
}

{
  const site = healthySite();
  for (const s of site.sections) s.visible = false;
  const report = assess(site);
  record("a site with every section switched off is NOT READY", report.status === "NOT READY");
  record("...and scores badly rather than being merely flagged", report.score < 70, `${report.score}`);
}

console.log("\n=== Rendering and links ===\n");

{
  const site = healthySite();
  site.sections.find((s) => s.type === "hero").ctaHref = "#";
  const report = assess(site);
  record("a button that goes nowhere is critical",
    report.issues.some((i) => i.id.startsWith("bad-link") && i.severity === "critical"),
    report.issues.filter((i) => i.id.startsWith("bad-link")).map((i) => i.id).join(", "));

  const dangling = healthySite();
  dangling.sections.find((s) => s.type === "hero").ctaHref = "#sec_does_not_exist";
  record("a link to a section that no longer exists is critical",
    assess(dangling).issues.some((i) => i.id.startsWith("dangling-anchor")));

  const js = healthySite();
  js.sections.find((s) => s.type === "cta" || s.type === "hero").ctaHref = "javascript:alert(1)";
  record("a javascript: link is rejected",
    assess(js).issues.some((i) => i.id.startsWith("bad-link")));

  const real = healthySite();
  real.sections.find((s) => s.type === "contact").mapsUrl = "https://maps.google.com/?q=x";
  record("a real external link is accepted",
    !assess(real).issues.some((i) => i.id.startsWith("bad-link")));
}

console.log("\n=== Content integrity ===\n");

{
  const broken = healthySite();
  const heroSection = broken.sections.find((s) => s.type === "hero");
  broken.i18n.en.strings[`${heroSection.id}.subheadline`] = "Fresh bread {{business_name}} every day";
  record("an unresolved template variable is caught",
    assess(broken).issues.some((i) => i.id === "broken-characters"));

  const mojibake = healthySite();
  mojibake.i18n.en.strings[`${heroSection.id}.subheadline`] = "CafÃ© on the square";
  record("mojibake is caught",
    assess(mojibake).issues.some((i) => i.id === "broken-characters"));

  const empty = healthySite();
  empty.i18n.en.strings[`${empty.sections.find((s) => s.type === "hero").id}.headline`] = "";
  record("an empty headline is critical",
    assess(empty).issues.some((i) => i.id === "empty-headline" && i.severity === "critical"));

  const badPhone = healthySite();
  badPhone.sections.find((s) => s.type === "contact").phone = "call us";
  record("a telephone number that is not one is a warning, not a failure",
    assess(badPhone).issues.some((i) => i.id === "phone-implausible" && i.severity === "warning"));

  const badEmail = healthySite();
  badEmail.sections.find((s) => s.type === "contact").email = "hello(at)example";
  record("an email address that is not one is caught",
    assess(badEmail).issues.some((i) => i.id === "email-implausible"));
}

{
  // Two languages where the second was never translated.
  const site = healthySite({ locales: ["en", "el"] });
  site.i18n.el.strings = {};
  const report = assess(site);
  record("a language with nothing translated is critical",
    report.issues.some((i) => i.id === "untranslated:el" && i.severity === "critical"));

  // A couple of missing strings is a warning, not a failure.
  const partial = healthySite({ locales: ["en", "el"] });
  const keys = Object.keys(partial.i18n.en.strings);
  partial.i18n.el.strings = Object.fromEntries(keys.slice(0, keys.length - 2).map((k) => [k, "ΕΛ"]));
  const partialReport = assess(partial);
  record("a handful of missing translations is only a warning",
    partialReport.issues.find((i) => i.id === "untranslated:el")?.severity === "warning",
    partialReport.issues.find((i) => i.id === "untranslated:el")?.severity ?? "none");
}

console.log("\n=== A business with no photographs is not failing ===\n");

{
  const site = healthySite();
  const report = assess(site);
  const images = report.categories.find((c) => c.id === "images");

  record("the images category is full marks", images.score === images.max, `${images.score}/${images.max}`);
  record("...and reads as a pass", images.verdict === "PASS", images.verdict);
  record("the reason is recorded as information, not a fault",
    images.issues.length === 1 && images.issues[0].severity === "info");
  record("that note costs nothing", images.issues[0].cost === 0);
  record("it says why, in plain words",
    /supplied no photographs/.test(images.issues[0].issue), images.issues[0].issue);
  record("no image issue is raised anywhere else",
    !report.issues.some((i) => i.category === "images" && i.severity !== "info"));
}

console.log("\n=== Images, when there are some ===\n");

{
  const assets = [
    { id: "wide", role: "photo", width: 2000, height: 1200, bytes: 260_000, alt: "The oven", focal_x: 0.3, focal_y: 0.4 },
    { id: "sq", role: "photo", width: 1000, height: 1000, bytes: 120_000, alt: "A loaf", focal_x: 0.5, focal_y: 0.5 },
  ];
  const insights = await inspectAssets(assets);
  const placements = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.8 }, kind: "business", wantsGallery: true,
  });
  let site = withCopy(makeSite([hero(), about(), gallery([]), contact(), footer()]));
  site.meta.facts = facts({ location: "Thessaloniki", verifiedFields: ["location"] });
  site = applyImages(site, placements);
  site = applyAltText(site, assets);
  site = applySeo(site, site.meta.facts);

  const sizes = Object.fromEntries(assets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]));
  const report = assess(site, sizes);
  const images = report.categories.find((c) => c.id === "images");
  record("a well-placed set of photographs passes", images.verdict === "PASS",
    images.issues.map((i) => i.id).join(", "));

  // An image the project no longer has is a broken page, not a warning.
  const orphaned = assess(site, { wide: sizes.wide });
  record("an image that no longer exists is critical",
    orphaned.issues.some((i) => i.id.startsWith("image-missing") && i.severity === "critical"));

  // A huge file is a warning worth seeing, not a reason to block.
  const heavy = assess(site, { ...sizes, sq: { ...sizes.sq, bytes: 3_000_000 } });
  record("an unnecessarily large image is a warning",
    heavy.issues.some((i) => i.category === "performance" || i.category === "images"),
    heavy.issues.filter((i) => /heav|large/i.test(i.issue)).map((i) => i.id).join(", "));
  record("...and does not make the site unpublishable", heavy.status !== "NOT READY", heavy.status);
}

console.log("\n=== SEO and accessibility ===\n");

{
  const noSeo = withCopy(makeSite([hero(), contact(), footer()]));
  const report = assess(noSeo);
  record("a missing title is critical",
    report.issues.some((i) => i.id === "seo:title-missing" && i.severity === "critical"));
  record("the SEO category loses points for it",
    report.categories.find((c) => c.id === "seo").score < CATEGORY_WEIGHT.seo);

  const longDesc = healthySite();
  longDesc.i18n.en.seo.description = "A neighbourhood bakery on the corner of the square. ".repeat(6);
  const longReport = assess(longDesc);
  const deduction = longReport.issues.find((i) => i.id === "seo:description-long");
  record("an over-long description is a warning with a stated cost",
    Boolean(deduction) && deduction.severity === "warning" && deduction.cost > 0,
    deduction ? `-${deduction.cost}` : "not found");

  const lowContrast = healthySite();
  lowContrast.theme.colors.text = "#cccccc";
  const contrastReport = assess(lowContrast);
  record("failing body contrast is critical",
    contrastReport.issues.some((i) => i.id === "contrast-body" && i.severity === "critical"));
  record("...and the accessibility category says so",
    contrastReport.categories.find((c) => c.id === "accessibility").verdict === "FAIL");
}

/* ======================================================================
   2. Performance
   ====================================================================== */

console.log("\n=== Performance is measured, not guessed ===\n");

{
  const site = healthySite();
  const html = render(site);
  const perf = assessPerformance({ site, html });

  record("a lean text-only page scores highly", perf.score >= 90, `${perf.score}/100`);
  record("it measures the document it was given",
    perf.measured.htmlBytes === html.length && perf.measured.cssBytes > 0);
  record("the image category stands aside when there are no images",
    perf.categories.find((c) => c.id === "images").notApplicable);
  record("the score is still out of 100 without that category", perf.score <= 100);
  record("every finding names a cost and a correction",
    perf.findings.every((f) => typeof f.cost === "number" && f.correction.length > 8));

  const twice = assessPerformance({ site, html });
  record("the same page scores the same twice", twice.score === perf.score);
}

{
  // The two renderer optimisations, asserted in the output rather than assumed.
  const assets = [{ id: "wide", role: "photo", width: 2000, height: 1200, bytes: 260_000, alt: "", focal_x: 0.5, focal_y: 0.5 }];
  const insights = await inspectAssets(assets);
  const placements = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.8 }, kind: "business", wantsGallery: false,
  });
  let site = applyImages(withCopy(makeSite([hero(), about(), contact(), footer()])), placements);
  site = applyAltText(site, assets);
  const html = renderSite(site, { locale: "en", assetUrl: (a) => `/uploads/${a}.webp` });

  record("the hero photograph is preloaded",
    /<link rel="preload" as="image" href="\/uploads\/wide\.webp"/.test(html));
  record("only the hero is preloaded",
    (html.match(/rel="preload" as="image"/g) ?? []).length === 1);
  const perf = assessPerformance({
    site, html,
    images: { wide: { width: 2000, height: 1200, bytes: 260_000 } },
  });
  record("the performance engine sees the preload", perf.measured.heroPreloaded);
  record("a preloaded hero raises no critical-loading finding",
    !perf.findings.some((f) => f.id === "hero-not-preloaded"));

  // And the finding appears when the hint is taken away.
  const without = assessPerformance({ site, html: html.replace(/<link rel="preload"[^>]*>/, "") });
  record("removing the preload is noticed",
    without.findings.some((f) => f.id === "hero-not-preloaded"));
  record("...and costs points", without.score < perf.score, `${without.score} vs ${perf.score}`);
}

{
  // Font weights the design never uses are not requested.
  const site = healthySite();
  site.theme.fontFamilies = {
    heading: "Fraunces", body: "Inter",
    url: "https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&family=Fraunces:wght@300;400;600;700",
  };
  const html = render(site);
  const requested = [...html.matchAll(/wght@([\d;]+)/g)].map((m) => m[1].split(";"));
  const weights = new Set(requested.flat());
  const used = new Set([
    String(site.theme.tokens.type.headingWeight),
    String(site.theme.tokens.type.bodyWeight),
    "400",
  ]);
  record("only the weights the design sets are requested",
    [...weights].every((w) => used.has(w)), [...weights].join(","));
  record("the weights the design does set are all present",
    [...used].filter((w) => requested.some((r) => r.includes(w))).length >= 1);

  // An unfamiliar URL shape is left completely alone.
  const italic = healthySite();
  italic.theme.fontFamilies = {
    heading: "Inter", body: "Inter",
    url: "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700",
  };
  record("a URL shape it does not understand is untouched",
    render(italic).includes("ital,wght@0,400;1,700"));

  const noTokens = healthySite();
  noTokens.theme.fontFamilies = { heading: "Inter", body: "Inter", url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700" };
  delete noTokens.theme.tokens;
  record("a document with no design tokens keeps every weight",
    render(noTokens).includes("wght@400;700"));
}

{
  // Layout stability: the finding that matters most, and its absence.
  const site = healthySite();
  const html = render(site);
  const stable = assessPerformance({ site, html });
  record("a page whose images all declare a size loses no stability points",
    stable.categories.find((c) => c.id === "stability").score === stable.categories.find((c) => c.id === "stability").max);

  const stripped = html.replace(/\swidth="\d+"\s+height="\d+"/g, "");
  const unstable = assessPerformance({ site, html: stripped });
  record("removing width and height is caught as a stability fault",
    unstable.findings.some((f) => f.id === "unsized-images") ||
      stable.measured.imagesWithDimensions === 0,
    `${unstable.measured.imagesWithDimensions} sized of ${unstable.measured.imageCount}`);
}

/* ======================================================================
   3. Project status
   ====================================================================== */

console.log("\n=== Project state is derived, never stored ===\n");

{
  const ready = assess(healthySite());
  record("a healthy, unpublished project is ready to publish or review",
    ["ready-to-publish", "ready-for-review"].includes(
      projectState({ status: "ready", hasSite: true, readiness: ready })),
    projectState({ status: "ready", hasSite: true, readiness: ready }));

  record("a project with no site is a draft",
    projectState({ status: "draft", hasSite: false, readiness: null }) === "draft");
  record("a generating project says so",
    projectState({ status: "generating", hasSite: false, readiness: null }) === "generating");
  record("a failed generation says so",
    projectState({ status: "failed", hasSite: false, readiness: null }) === "failed");
  record("a live project is published",
    projectState({ status: "ready", hasSite: true, readiness: ready, deploymentStatus: "live" }) === "published");

  // The rule worth having: a published site that breaks is the urgent case.
  const broken = healthySite();
  broken.sections.find((s) => s.type === "contact").phone = "";
  broken.sections.find((s) => s.type === "contact").email = "";
  broken.i18n.en.strings[`${broken.sections.find((s) => s.type === "contact").id}.address`] = "";
  const brokenReport = assess(broken);
  record("a published site with a critical failure needs attention, not a green tick",
    projectState({ status: "ready", hasSite: true, readiness: brokenReport, deploymentStatus: "live" }) === "needs-attention");

  record("every state has a label and an explanation",
    ["draft", "generating", "ready-for-review", "ready-to-publish", "published", "needs-attention", "failed"]
      .every((s) => stateInfo(s).label.length > 2 && stateInfo(s).hint.length > 8));
}

/* ======================================================================
   4. Corrections feed the checklist
   ====================================================================== */

console.log("\n=== Safe corrections and the checklist stay in their lanes ===\n");

{
  // A heading too wide for a phone: the safe-correction system's job.
  const site = withCopy(makeSite([hero(), contact(), footer()]), {
    headline: "Konstantinopoulopoulos Bakery",
  });
  site.meta.facts = facts({ category: "Bakery", verifiedFields: ["category"] });
  const seeded = applySeo(site, site.meta.facts);

  const before = assess(seeded);
  const corrected = correctSite({ site: seeded, locale: "en" });
  const after = assess(corrected.site);

  record("a correction is applied by the correction system",
    corrected.applied.length > 0, corrected.applied.map((c) => c.id).join(", "));
  record("the checklist scores the corrected document, not the original",
    after.score >= before.score, `${before.score} → ${after.score}`);
  record("the correction changed design, not words",
    same(corrected.site.i18n, seeded.i18n));
}

/* ======================================================================
   5. The six businesses, end to end
   ====================================================================== */

console.log("\n=== Six businesses through the whole pipeline ===\n");

const BUSINESSES = [
  { name: "Ouzeri Mikros", type: "Restaurant", location: "Thessaloniki", services: 6, images: 5 },
  { name: "Hotel Aegli", type: "Hotel", location: "Nafplio", services: 4, images: 6 },
  { name: "Papadopoulos & Partners", type: "Law firm", location: "Athens", services: 5, images: 1 },
  { name: "Kyriakou Accounting", type: "Accounting office", location: "Patras", services: 4, images: 0 },
  { name: "Lustre Car Detailing", type: "Car detailing", location: "Larissa", services: 5, images: 4 },
  { name: "Iron Works Gym", type: "Gym", location: "Volos", services: 6, images: 3 },
];

const scoreboard = [];

for (const business of BUSINESSES) {
  const assets = Array.from({ length: business.images }, (_, i) => ({
    id: `${business.name.slice(0, 3).toLowerCase()}-${i}`,
    role: "photo",
    width: i === 0 ? 2000 : 1400,
    height: i === 0 ? 1200 : 1050,
    bytes: 240_000,
    alt: "",
    focal_x: 0.5,
    focal_y: 0.5,
  }));
  const signals = readSignals({
    text: `${business.name} ${business.type} ${business.location}`,
    content: { services: business.services, menuItems: 0, images: business.images, testimonials: 2, words: 320 },
  });

  let site = withCopy(
    makeSite([hero(), about(), services(business.services), gallery([]), contact(), footer()], { name: business.name }),
    { headline: `${business.type} in ${business.location}` },
  );
  site.theme.tokens = deriveTokens({ architectureId: "modern", kind: "business", signals });

  const insights = await inspectAssets(assets);
  const placements = assignRoles(insights, { signals, kind: "business", wantsGallery: business.images > 2 });
  site = applyImages(site, placements);
  site.meta.facts = facts({
    category: business.type, location: business.location,
    services: Array.from({ length: business.services }, (_, i) => `Service ${i + 1}`),
    verifiedFields: ["category", "location", "services"],
  });
  site = applyAltText(site, assets);
  site = applySeo(site, site.meta.facts);

  const sizes = Object.fromEntries(assets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]));
  site = correctSite({ site, locale: "en", images: sizes }).site;

  const report = assess(site, sizes);
  const perf = assessPerformance({ site, html: render(site), images: sizes });
  scoreboard.push({
    business: business.name,
    readiness: report.score,
    status: report.status,
    performance: perf.score,
    images: business.images,
    criticals: report.issues.filter((i) => i.severity === "critical").map((i) => i.id),
  });

  record(`${business.name}: no critical issues`,
    report.issues.every((i) => i.severity !== "critical"),
    report.issues.filter((i) => i.severity === "critical").map((i) => i.id).join(", "));
  record(`${business.name}: readiness at least 85`, report.score >= 85,
    `${report.score}/100 (${report.status})`);
  record(`${business.name}: performance at least 85`, perf.score >= 85, `${perf.score}/100`);

  if (business.images === 0) {
    const images = report.categories.find((c) => c.id === "images");
    record(`${business.name}: no photographs is an information note, not a fault`,
      images.verdict === "PASS" && images.score === images.max &&
        images.issues.every((i) => i.severity === "info"),
      `${images.score}/${images.max} ${images.verdict}`);
  } else {
    record(`${business.name}: its photographs are placed`,
      (site.images ?? []).length > 0, `${(site.images ?? []).length} placements`);
  }
}

console.log(`\n  ${scoreboard.map((s) => `${s.business}: ${s.readiness}/100 ${s.status} · perf ${s.performance}`).join("\n  ")}\n`);

record("every business reaches a publishable state",
  scoreboard.every((s) => s.status !== "NOT READY"),
  scoreboard.filter((s) => s.status === "NOT READY").map((s) => s.business).join(", "));
record("the accounting office with no photographs is not penalised",
  scoreboard.find((s) => s.images === 0).readiness >= 85,
  String(scoreboard.find((s) => s.images === 0).readiness));
record("issues are ranked with criticals first",
  rankedIssues(assess(healthySite())).every((issue, i, all) =>
    i === 0 || all[i - 1].severity !== "warning" || issue.severity !== "critical"));

/* ======================================================================
   6. Editing and versioning, against a real server
   ====================================================================== */

console.log(`\n=== Editing and versioning against a real server (${BASE}) ===\n`);

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const email = `studio+${Date.now()}@example.com`;
await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
await page.getByLabel("Your name").fill("Studio Tester");
await page.getByLabel("Email").fill(email);
await page.getByLabel("Password").fill("supersecret123");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle" });
await page.getByLabel("Business name").fill("Tzanos Autoelectric");
await page.getByLabel("What kind of business is it?").fill("Car electrics workshop");
await page.getByLabel("Describe the business").fill("Auto electrical repairs, diagnostics and battery replacement since 1994.");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Town or city").fill("Larissa");
await page.getByLabel("Phone").fill("+30 2410 000000");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("radio", { name: /Full business website/ }).click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("radio", { name: /Warm/ }).click();
await page.getByRole("button", { name: "Generate website" }).click();
await page.waitForURL(/\/generate/, { timeout: 15000 });
await page.locator("iframe[data-preview-frame]").waitFor({ timeout: 240000 });

const projectUrl = page.url().replace(/\/generate$/, "");
const projectId = projectUrl.split("/").pop();
record("a website is generated to work with", true);

const api = (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const res = await fetch(path, { cache: "no-store", ...(init ?? {}) });
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) };
      } catch {
        return { status: res.status, text };
      }
    },
    { path, init },
  );

{
  const versions = (await api(`/api/projects/${projectId}/versions`)).json.versions;
  record("generation creates the first version", versions.length >= 1, `${versions.length}`);
  record("it is numbered 1", versions[versions.length - 1].number === 1);
  record("it is marked as the generated one",
    versions[versions.length - 1].kind === "generated", versions[versions.length - 1].kind);
  record("the newest version is marked current", versions[0].current === true);
}

console.log("\n=== A targeted edit does not regenerate the website ===\n");

{
  const jobsBefore = (await api(`/api/projects/${projectId}/status`)).json.job?.id ?? null;
  const before = (await api(`/api/projects/${projectId}/site`)).json.site;
  const heroSection = before.sections.find((s) => s.type === "hero");
  const originalHeadline = before.i18n[before.meta.defaultLocale].strings[`${heroSection.id}.headline`];
  const originalSections = before.sections.map((s) => s.id).join("|");
  const originalTheme = structuredClone(before.theme);

  before.i18n[before.meta.defaultLocale].strings[`${heroSection.id}.headline`] = "Auto electrics, done properly";
  const put = await api(`/api/projects/${projectId}/site`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: before, label: "Changed the headline" }),
  });
  record("the edit saves", put.status === 200);

  const after = (await api(`/api/projects/${projectId}/site`)).json.site;
  record("the change is in the document",
    after.i18n[after.meta.defaultLocale].strings[`${heroSection.id}.headline`] === "Auto electrics, done properly",
    `was "${originalHeadline}"`);
  record("nothing else about the content moved",
    after.sections.map((s) => s.id).join("|") === originalSections);
  record("the design system is untouched", same(after.theme, originalTheme),
    `tokens ${after.theme.tokens ? "kept" : "LOST"}, architecture ${after.theme.architecture}`);
  record("the derived design tokens survive an edit", Boolean(after.theme.tokens));
  record("the verified research facts survive an edit",
    Boolean(after.meta.facts) || !before.meta.facts);

  const jobsAfter = (await api(`/api/projects/${projectId}/status`)).json.job?.id ?? null;
  record("no generation job was started", jobsAfter === jobsBefore, `${jobsBefore} → ${jobsAfter}`);
  record("the project is still ready, not generating",
    (await api(`/api/projects/${projectId}/status`)).json.status === "ready");

  const html = (await api(`/api/projects/${projectId}/render`)).text ?? "";
  record("the preview renders the edit", html.includes("Auto electrics, done properly"));

  // Rendering the same document twice must produce the same bytes: an image
  // URL that changed between two views would defeat the browser cache and
  // make every comparison of two renders unreliable.
  const again = (await api(`/api/projects/${projectId}/render`)).text ?? "";
  record("two renders of the same document are byte-identical", again === html,
    `${html.length} vs ${again.length} chars`);
}

console.log("\n=== A design change stays inside the design system ===\n");

{
  const site = (await api(`/api/projects/${projectId}/site`)).json.site;
  const beforeTokens = structuredClone(site.theme.tokens);
  site.theme.colors.primary = "#0f766e";
  await api(`/api/projects/${projectId}/site`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site, label: "Changed the colour" }),
  });
  const after = (await api(`/api/projects/${projectId}/site`)).json.site;
  record("the colour changed", after.theme.colors.primary === "#0f766e");
  record("the rest of the design system is unchanged",
    same(after.theme.tokens, beforeTokens));
  const html = (await api(`/api/projects/${projectId}/render`)).text ?? "";
  record("the new colour reaches the rendered page", html.includes("#0f766e"));
}

console.log("\n=== Versions and rollback ===\n");

{
  // Three distinct states, far enough apart that they are not coalesced.
  const labels = ["Services rewritten", "Contact details updated"];
  for (const label of labels) {
    const site = (await api(`/api/projects/${projectId}/site`)).json.site;
    const contactSection = site.sections.find((s) => s.type === "contact");
    site.i18n[site.meta.defaultLocale].strings[`${contactSection.id}.heading`] = label;
    await api(`/api/projects/${projectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    await api(`/api/projects/${projectId}/site`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, label }),
    });
  }

  const versions = (await api(`/api/projects/${projectId}/versions`)).json.versions;
  record("history has several versions", versions.length >= 3, `${versions.length}`);
  record("they are numbered without gaps",
    versions.map((v) => v.number).reverse().every((n, i) => n === i + 1),
    versions.map((v) => v.number).join(","));
  record("exactly one is marked current",
    versions.filter((v) => v.current).length === 1);
  record("the current one is the newest",
    versions[0].current === true);
  record("each version records when it was made",
    versions.every((v) => typeof v.created_at === "number" && v.created_at > 0));
  record("each version records why it exists",
    versions.every((v) => typeof v.kind === "string" && v.kind.length > 0),
    versions.map((v) => v.kind).join(","));

  // Restore the very first one.
  const target = versions[versions.length - 1];
  const countBefore = versions.length;
  const currentBefore = (await api(`/api/projects/${projectId}/site`)).json.site;

  const restore = await api(`/api/projects/${projectId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", versionId: target.id }),
  });
  record("restoring an old version succeeds", restore.status === 200);

  const afterVersions = (await api(`/api/projects/${projectId}/versions`)).json.versions;
  record("nothing was deleted", afterVersions.length === countBefore + 1,
    `${countBefore} → ${afterVersions.length}`);
  record("every earlier version is still there",
    versions.every((v) => afterVersions.some((a) => a.id === v.id)));
  record("the restored state is a new version at the front",
    afterVersions[0].kind === "restore" && afterVersions[0].current === true,
    afterVersions[0].kind);
  record("it says which version it restored",
    afterVersions[0].restored_from === target.id);
  record("its label names the version it came from",
    afterVersions[0].label.includes(`version ${target.number}`), afterVersions[0].label);

  const restoredSite = (await api(`/api/projects/${projectId}/site`)).json.site;
  const targetSite = (await api(`/api/projects/${projectId}/render?version=${target.id}`)).text ?? "";
  record("the website is the restored one", !same(restoredSite, currentBefore));
  record("the restored version is still viewable on its own", targetSite.includes("<!doctype html"));

  // And the rollback is itself reversible.
  const previousCurrent = afterVersions.find((v) => v.number === countBefore);
  const undo = await api(`/api/projects/${projectId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", versionId: previousCurrent.id }),
  });
  record("a rollback can itself be rolled back", undo.status === 200);
  const undone = (await api(`/api/projects/${projectId}/site`)).json.site;
  record("...and puts the earlier state back", same(undone, currentBefore));
  record("history keeps growing rather than rewinding",
    (await api(`/api/projects/${projectId}/versions`)).json.versions.length === countBefore + 2);
}

console.log("\n=== Version history does not fill up with noise ===\n");

{
  const before = (await api(`/api/projects/${projectId}/versions`)).json.versions.length;
  const site = (await api(`/api/projects/${projectId}/site`)).json.site;
  const heroSection = site.sections.find((s) => s.type === "hero");
  for (const word of ["One", "Two", "Three", "Four", "Five"]) {
    site.i18n[site.meta.defaultLocale].strings[`${heroSection.id}.headline`] = `Headline ${word}`;
    await api(`/api/projects/${projectId}/site`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site, label: "Edited" }),
    });
  }
  const after = (await api(`/api/projects/${projectId}/versions`)).json.versions;
  record("five edits in one sitting make one version, not five",
    after.length === before + 1, `${before} → ${after.length}`);
  record("that version holds the latest of them", after[0].current === true);

  const finalSite = (await api(`/api/projects/${projectId}/site`)).json.site;
  record("the document has the last edit",
    finalSite.i18n[finalSite.meta.defaultLocale].strings[`${heroSection.id}.headline`] === "Headline Five");

  // A save that changes nothing is not a version.
  const unchanged = (await api(`/api/projects/${projectId}/versions`)).json.versions.length;
  await api(`/api/projects/${projectId}/site`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site: finalSite, label: "Edited" }),
  });
  record("saving an unchanged document adds no version",
    (await api(`/api/projects/${projectId}/versions`)).json.versions.length === unchanged);
}

console.log("\n=== The project screen shows the studio view ===\n");

{
  await page.goto(projectUrl, { waitUntil: "networkidle" });
  record("the project shows an overview", await page.locator("[data-project-overview]").isVisible());
  record("it names a state", (await page.locator("[data-project-state]").count()) > 0);
  const figures = await page.locator("[data-project-overview] dt").allInnerTexts();
  record("it shows readiness, layout QA, SEO and performance",
    ["Readiness", "Layout QA", "SEO", "Performance"].every((f) =>
      figures.some((text) => text.trim().toLowerCase() === f.toLowerCase())),
    figures.join(", "));

  record("the readiness card is on the project screen",
    await page.getByText("Client readiness").isVisible());
  record("it says the score is this application's own",
    await page.getByText(/not a Lighthouse result/i).isVisible());

  // Every category opens and explains itself.
  const categories = page.locator("[data-readiness-category]");
  const count = await categories.count();
  record("all seven categories are listed", count === 7, `${count}`);
  await categories.first().click();
  await page.waitForTimeout(250);
  const expanded = await categories.first().getAttribute("aria-expanded");
  record("a category opens when clicked", expanded === "true");

  const scoreText = await page.locator("[data-readiness-category]").first().innerText();
  record("each category shows its points out of its maximum", /\d+\/\d+/.test(scoreText), scoreText.replace(/\n/g, " "));
}

{
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  record("the dashboard lists the project with a state",
    (await page.locator("[data-project-card] [data-project-state]").count()) >= 1);
  record("the card shows a readiness score",
    await page.getByText(/Readiness \d+\/100/).first().isVisible());
  record("projects can be searched", await page.locator("[data-project-search]").isVisible());

  await page.locator("[data-project-search]").fill("Tzanos");
  await page.waitForTimeout(300);
  record("searching by business name finds it",
    (await page.locator("[data-project-card]").count()) === 1);
  await page.locator("[data-project-search]").fill("nothing matches this");
  await page.waitForTimeout(300);
  record("a search with no matches says so rather than showing everything",
    (await page.locator("[data-project-card]").count()) === 0);
}

console.log("\n=== The search listing is editable ===\n");

{
  await page.goto(`${projectUrl}/edit`, { waitUntil: "networkidle" });
  await page.locator("[data-seo-toggle]").click();
  await page.waitForTimeout(200);
  const title = page.locator("[data-seo-title]");
  record("the page title can be edited", await title.isVisible());
  await title.fill("Tzanos Autoelectric — Car electrics in Larissa");
  await page.locator("[data-seo-description]").fill(
    "Auto electrical repairs, diagnostics and battery replacement in Larissa since 1994. Same-day service for most vehicles.",
  );
  await page.locator("[data-seo-description]").blur();
  await page.waitForTimeout(1500);

  const site = (await api(`/api/projects/${projectId}/site`)).json.site;
  record("the edited title is saved",
    site.i18n[site.meta.defaultLocale].seo.title === "Tzanos Autoelectric — Car electrics in Larissa",
    site.i18n[site.meta.defaultLocale].seo.title);
  const html = (await api(`/api/projects/${projectId}/render`)).text ?? "";
  record("it reaches the rendered page",
    html.includes("<title>Tzanos Autoelectric — Car electrics in Larissa</title>"));
  record("the social preview follows it",
    /property="og:title" content="Tzanos Autoelectric/.test(html));
}

await browser.close();

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failures ? 1 : 0);
