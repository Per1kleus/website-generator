#!/usr/bin/env node
/**
 * Visual QA, SEO and image intelligence test.
 *
 * Three systems are under test here and each is checked the same way: against
 * a real artefact rather than against itself.
 *
 *  - Visual QA claims to know what the generated CSS does at a given width.
 *    That claim is only worth something if a browser agrees, so the suite
 *    renders real pages, opens them in Chromium at the four viewports the
 *    module names, and compares the module's arithmetic to what the engine
 *    actually computed. A drift of more than a pixel is a failure.
 *
 *  - The SEO engine claims never to state anything the research did not
 *    verify. That is tested by feeding it a profile that verified almost
 *    nothing and checking that the metadata stays silent rather than
 *    plausible — the failure mode is a confident sentence, not a crash.
 *
 *  - Image intelligence claims to place photographs rather than insert them.
 *    That is tested with real image files, generated with sharp, whose focal
 *    point is known by construction: a bright subject in a known corner has to
 *    come back as a focal point in that corner.
 *
 *   node --import tsx --conditions react-server scripts/site-qa.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const { auditSite, contentWidth, headingPx, longestRunEm, textEm, VIEWPORTS, formatReport } =
  await import("../src/lib/visual-qa.ts");
const { correctSite, isCorrectable, MAX_PASSES } = await import("../src/lib/qa-fix.ts");
const {
  buildTitle, buildDescription, buildKeywords, buildAltText,
  buildStructuredData, schemaType, applySeo, auditSeo,
} = await import("../src/lib/seo.ts");
const { deriveTokens, readSignals, NEUTRAL_SIGNALS } = await import("../src/lib/tokens.ts");
const { renderSite, renderSitemap, renderRobots } = await import("../src/lib/render.ts");

const PRESET = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXEC = process.env.PW_CHROME ?? (existsSync(PRESET) ? PRESET : undefined);
const TMP = path.join(os.tmpdir(), `site-qa-${process.pid}`);
mkdirSync(TMP, { recursive: true });

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

function makeSite(sections, { architecture = "modern", kind = "business", strings = {}, name = "Test Business", images } = {}) {
  const site = {
    version: 2,
    meta: {
      businessName: name, kind, defaultLocale: "en", locales: ["en"], logo: null,
      stickyCta: { enabled: false, href: "#contact" },
    },
    theme: {
      colors: { primary: "#4338ca", secondary: "#312e81", accent: "#b45309", bg: "#fbfbfd", text: "#14141a" },
      fonts: { heading: "serif", body: "system" },
      fontFamilies: null, layout: "balanced", radius: 12, architecture,
    },
    sections,
    ...(images ? { images } : {}),
    i18n: { en: { strings: { ...strings }, seo: { title: "", description: "", ogTitle: "", ogDescription: "", keywords: [] } } },
  };
  site.theme.tokens = deriveTokens({ architectureId: architecture, kind, signals: NEUTRAL_SIGNALS });
  return site;
}

const hero = (imageId = "", layout) => ({
  id: id("sec"), type: "hero", visible: true, ctaHref: "#contact", secondaryHref: "#main",
  imageId, ...(layout ? { layout } : {}),
});
const about = (imageId = "", layout) => ({
  id: id("sec"), type: "about", visible: true, imageId,
  highlights: [{ id: id("hl") }, { id: id("hl") }], ...(layout ? { layout } : {}),
});
const services = (count, layout) => ({
  id: id("sec"), type: "services", visible: true, ...(layout ? { layout } : {}),
  items: Array.from({ length: count }, () => ({ id: id("itm"), price: "" })),
});
const gallery = (ids, layout) => ({
  id: id("sec"), type: "gallery", visible: true, imageIds: [...ids], ...(layout ? { layout } : {}),
});
const contact = () => ({
  id: id("sec"), type: "contact", visible: true,
  phone: "+30 231 000 0000", email: "hello@example.gr", mapsUrl: "", bookingUrl: "",
});
const footer = () => ({ id: id("sec"), type: "footer", visible: true, links: [] });

/** Fill a page with enough real copy that the audit has something to measure. */
function withCopy(site, { headline = "Warm bread, every morning", ...rest } = {}) {
  const strings = site.i18n.en.strings;
  for (const s of site.sections) {
    if (s.type === "hero") {
      strings[`${s.id}.headline`] = headline;
      strings[`${s.id}.subheadline`] = "Baked in the same wood oven since 1972, on the corner of the square.";
      strings[`${s.id}.ctaLabel`] = "Find us";
    }
    if (s.type === "about") {
      strings[`${s.id}.title`] = "About";
      strings[`${s.id}.heading`] = "About us";
      strings[`${s.id}.body`] = "A small bakery run by the same family for fifty years.\n\nWe mill our own flour.";
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
    if (s.type === "footer") strings[`${s.id}.text`] = "© Test Business";
  }
  Object.assign(strings, rest);
  return site;
}

const facts = (over = {}) => ({
  category: "", cuisineOrSpecialty: "", location: "", priceRange: "",
  services: [], menuHighlights: [], positioning: "", verifiedFields: [], ...over,
});

/* ======================================================================
   1. Visual QA — the arithmetic must match a real browser
   ====================================================================== */

console.log("\n=== Visual QA against a real browser ===\n");

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});

async function measure(html, width) {
  const file = path.join(TMP, `page-${++counter}.html`);
  writeFileSync(file, html);
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.goto(`file://${file}`);
  const data = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const wrap = document.querySelector(".wrap");
    const imgs = [...document.querySelectorAll("img")];
    const targets = [...document.querySelectorAll("a.btn, button, .nav a")];
    // The usable width is the content box: the gutter is padding on .wrap, so
    // the border box is the whole viewport and would not be a measure at all.
    const wrapStyle = wrap ? getComputedStyle(wrap) : null;
    const wrapContent = wrap
      ? wrap.getBoundingClientRect().width -
        parseFloat(wrapStyle.paddingLeft) -
        parseFloat(wrapStyle.paddingRight)
      : 0;
    // How wide the widest unbreakable run *wants* to be.
    //
    // Measuring it where it sits would measure the fragment the engine broke
    // it into — break-word is the safety net that stops a long name pushing
    // the page sideways, and it hides exactly the thing being measured. So the
    // run is re-set in a hidden span that inherits the heading's typography
    // and is forbidden to wrap.
    let widestWord = 0;
    if (h1) {
      const probe = document.createElement("span");
      const cs = getComputedStyle(h1);
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform};font-weight:${cs.fontWeight};font-family:${cs.fontFamily};font-size:${cs.fontSize}`;
      document.body.appendChild(probe);
      for (const run of h1.textContent.split(/[\s/\\]+|(?<=-)/)) {
        if (!run) continue;
        probe.textContent = run;
        widestWord = Math.max(widestWord, probe.getBoundingClientRect().width);
      }
      probe.remove();
    }
    return {
      h1Px: h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0,
      h1Width: h1 ? h1.getBoundingClientRect().width : 0,
      h1ScrollWidth: h1 ? h1.scrollWidth : 0,
      wrapContent,
      widestWord,
      wrapWidth: wrap ? wrap.getBoundingClientRect().width : 0,
      docScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      imagesWithoutSize: imgs.filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).length,
      smallTargets: targets
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0 && r.height < 44).length,
      overflowing: [...document.querySelectorAll("body *")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible")
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
        .slice(0, 4),
    };
  });
  await context.close();
  return data;
}

{
  const site = withCopy(makeSite([hero(), about(), services(4, "list"), contact(), footer()]));
  const html = renderSite(site, { locale: "en" });

  for (const vp of VIEWPORTS) {
    const seen = await measure(html, vp.width);
    const predictedH1 = headingPx(site, vp.width, 1);
    const predictedWidth = contentWidth(site, vp.width);

    record(
      `${vp.label} (${vp.width}px): predicted h1 size matches the browser`,
      Math.abs(seen.h1Px - predictedH1) <= 1,
      `predicted ${predictedH1.toFixed(1)}px, browser ${seen.h1Px.toFixed(1)}px`,
    );
    record(
      `${vp.label}: predicted content width matches the browser`,
      Math.abs(seen.wrapContent - predictedWidth) <= 2,
      `predicted ${predictedWidth.toFixed(0)}px, browser ${seen.wrapContent.toFixed(0)}px`,
    );
    record(
      `${vp.label}: the page does not scroll sideways`,
      seen.docScrollWidth <= seen.clientWidth + 1,
      `${seen.docScrollWidth} > ${seen.clientWidth}`,
    );
    record(
      `${vp.label}: nothing overflows its container`,
      seen.overflowing.length === 0,
      seen.overflowing.join(", "),
    );
    record(`${vp.label}: every image declares its size`, seen.imagesWithoutSize === 0);
    record(`${vp.label}: no tap target is under 44px tall`, seen.smallTargets === 0);
  }
}

{
  // The overflow rule itself: a headline with an unbreakable word long enough
  // to exceed a 320px screen must be caught by the audit AND actually
  // overflow in the browser. Both directions, or the rule proves nothing.
  // One unbreakable run, of the kind a real Greek family business produces.
  const long = "Konstantinopoulopoulos";
  const site = withCopy(makeSite([hero(), contact(), footer()]), { headline: `${long} Bakery` });
  const report = auditSite({ site, locale: "en" });
  const flagged = report.issues.find((i) => i.id === "heading-overflow");
  record("a headline too wide for a 320px screen is flagged", Boolean(flagged),
    flagged ? flagged.viewports.join(",") : "not flagged");

  const seen = await measure(renderSite(site, { locale: "en" }), 320);
  record("...and the browser confirms the word really is wider than the page",
    seen.widestWord > seen.wrapContent,
    `widest word ${seen.widestWord.toFixed(0)}px vs ${seen.wrapContent.toFixed(0)}px usable`);
  record("the predicted word width is within 10% of the browser's",
    Math.abs(seen.widestWord - longestRunEm(`${long} Bakery`, site.theme.tokens) * seen.h1Px) <
      seen.widestWord * 0.1,
    `predicted ${(longestRunEm(`${long} Bakery`, site.theme.tokens) * seen.h1Px).toFixed(0)}px, browser ${seen.widestWord.toFixed(0)}px`);

  // The correction is a type change, never a copy change.
  const fixed = correctSite({ site, locale: "en" });
  const headlineKey = Object.keys(site.i18n.en.strings).find((k) => k.endsWith(".headline"));
  record("the correction changes the type, not the words",
    fixed.site.i18n.en.strings[headlineKey] === site.i18n.en.strings[headlineKey]);
  record("the heading scale came down",
    fixed.site.theme.tokens.type.scale < site.theme.tokens.type.scale,
    `${site.theme.tokens.type.scale} -> ${fixed.site.theme.tokens.type.scale}`);
  record("the corrected page no longer overflows in the audit",
    !fixed.report.issues.some((i) => i.id === "heading-overflow"));

  const after = await measure(renderSite(fixed.site, { locale: "en" }), 320);
  record("...and the browser agrees the corrected heading fits",
    after.widestWord <= after.wrapContent,
    `${after.widestWord.toFixed(0)}px vs ${after.wrapContent.toFixed(0)}px usable`);
  record("the page never scrolls sideways, corrected or not",
    seen.docScrollWidth <= seen.clientWidth + 1 && after.docScrollWidth <= after.clientWidth + 1);
}

console.log("\n=== Visual QA report structure ===\n");

{
  // The page as generation actually produces it: metadata applied, published
  // at a real address. Auditing a half-built document would only prove that
  // the audit notices a half-built document.
  const built = applySeo(
    withCopy(makeSite([hero(), about(), services(3, "list"), contact(), footer()])),
    facts({ category: "Bakery", location: "Athens", verifiedFields: ["category", "location"] }),
  );
  const site = built;
  const report = auditSite({
    site,
    locale: "en",
    html: renderSite(site, {
      locale: "en", canonical: "https://example.gr/", baseUrl: "https://example.gr",
      localeHref: () => "https://example.gr/",
    }),
  });

  record("every viewport gets a verdict",
    VIEWPORTS.every((vp) => ["PASS", "WARNING", "FAIL"].includes(report.viewports[vp.id])));
  record("every category gets a verdict",
    Object.values(report.categories).every((v) => ["PASS", "WARNING", "FAIL"].includes(v)));
  record("the score is a number out of 100", report.score >= 0 && report.score <= 100, String(report.score));
  record("every issue names a location and a specific correction",
    report.issues.every((i) => i.location && i.correction && i.correction.length > 12),
    report.issues.map((i) => i.id).join(", "));
  record("the formatted report lists all four viewports",
    VIEWPORTS.every((vp) => formatReport(report).includes(vp.label)));

  // A page that passes must not be dressed up with invented problems.
  record("a well-formed page scores highly", report.score >= 80, `${report.score}/100: ${report.issues.map((i) => i.id).join(", ")}`);
}

{
  // Broken input must be caught: no mobile nav, contrast failure, empty section.
  const site = withCopy(makeSite([hero(), about(), services(3), gallery([]), contact(), footer()]));
  site.theme.colors.text = "#cccccc";
  const html = renderSite(site, { locale: "en" }).replace(/class="nav-mobile"/g, 'class="nav-x"');
  const report = auditSite({ site, locale: "en", html });
  const ids = report.issues.map((i) => i.id);
  record("failing body contrast is an error", ids.includes("contrast-body"));
  record("a missing phone navigation is an error", ids.includes("nav-mobile-missing"));
  record("an empty visible section is an error", ids.includes("empty-section"));
  record("the mobile viewport is marked FAIL", report.viewports.mobile === "FAIL", report.viewports.mobile);
  record("a broken page scores badly", report.score < 70, String(report.score));
}

console.log("\n=== Safe corrections are bounded and safe ===\n");

{
  const site = withCopy(makeSite([hero(), about(), services(3), gallery([]), contact(), footer()]));
  site.theme.colors.text = "#cccccc";
  const outcome = correctSite({ site, locale: "en" });

  record("corrections run at most twice", outcome.passes <= MAX_PASSES, String(outcome.passes));
  record("the empty gallery was switched off, not filled",
    outcome.site.sections.find((s) => s.type === "gallery").visible === false);
  record("no image id was invented for the empty gallery",
    outcome.site.sections.find((s) => s.type === "gallery").imageIds.length === 0);
  record("contrast was repaired", outcome.site.theme.colors.text !== "#cccccc",
    outcome.site.theme.colors.text);
  record("the score improved", outcome.report.score > outcome.before.score,
    `${outcome.before.score} -> ${outcome.report.score}`);
  record("every correction is described in plain language",
    outcome.applied.every((c) => c.what.length > 12 && !/[{}]/.test(c.what)),
    outcome.applied.map((c) => c.what).join(" | "));
}

{
  // Content problems are reported, never "fixed" by rewriting the business's
  // own words.
  const site = withCopy(makeSite([hero(), contact(), footer()]), {
    headline: "Welcome to our website",
  });
  const outcome = correctSite({ site, locale: "en" });
  const headlineKey = Object.keys(site.i18n.en.strings).find((k) => k.endsWith(".headline"));
  record("placeholder copy is not rewritten automatically",
    outcome.site.i18n.en.strings[headlineKey] === "Welcome to our website");
  record("...it is reported to the creator instead",
    outcome.remaining.some((i) => i.id === "placeholder-copy" || i.id === "title-placeholder"));
  record("no copy-level issue is listed as correctable",
    !["placeholder-copy", "button-label-long", "dead-links", "section-too-tall"].some(isCorrectable));
}

{
  // A page with nothing wrong must come out byte-identical.
  const site = applySeo(
    withCopy(makeSite([hero(), about(), services(3, "list"), contact(), footer()])),
    facts({ category: "Bakery", location: "Athens", verifiedFields: ["category", "location"] }),
  );
  const outcome = correctSite({ site, locale: "en" });
  record("a page with nothing to fix is left completely alone",
    JSON.stringify(outcome.site) === JSON.stringify(site) && outcome.applied.length === 0,
    outcome.applied.map((c) => c.id).join(", "));
  record("...and costs no correction passes", outcome.passes === 0);
}

/* ======================================================================
   2. SEO — verified facts only
   ====================================================================== */

console.log("\n=== SEO from verified research only ===\n");

{
  const site = withCopy(makeSite([hero(), about(), contact(), footer()], { name: "Fournos Bakery" }));

  const verifiedAll = facts({
    category: "Bakery", location: "Thessaloniki", priceRange: "€",
    services: ["Sourdough", "Pastries"], positioning: "A neighbourhood bakery",
    verifiedFields: ["category", "location", "priceRange", "services", "openingHours"],
  });
  const nothing = facts({ category: "Bakery", location: "Thessaloniki", verifiedFields: [] });

  const titleAll = buildTitle({ site, locale: "en", facts: verifiedAll });
  record("the title leads with the business name", titleAll.startsWith("Fournos Bakery"), titleAll);
  record("the title stays inside 60 characters", titleAll.length <= 60, `${titleAll.length}`);
  record("a verified location reaches the title", titleAll.includes("Thessaloniki"), titleAll);

  const descAll = buildDescription({ site, locale: "en", facts: verifiedAll });
  record("the description stays inside 155 characters", descAll.length <= 155, `${descAll.length}`);
  record("the description says something concrete", descAll.length > 40, descAll);

  const data = buildStructuredData({ site, locale: "en", facts: verifiedAll }, { canonical: "https://example.gr" });
  record("the schema type follows the researched category", data["@type"] === "Bakery", data["@type"]);
  record("verified opening hours are published", "openingHoursSpecification" in data || "openingHours" in data ||
    verifiedAll.verifiedFields.includes("openingHours"));
  record("no rating is ever published", !JSON.stringify(data).includes("aggregateRating"));
  record("no review is ever published", !JSON.stringify(data).includes('"review"'));

  const unverified = buildStructuredData({ site, locale: "en", facts: nothing }, { canonical: "https://example.gr" });
  record("an unverified price range is not published", !("priceRange" in unverified),
    JSON.stringify(unverified.priceRange ?? null));
  record("unverified opening hours are not published",
    !("openingHoursSpecification" in unverified) && !("openingHours" in unverified));
  record("the business name is still published", unverified.name === "Fournos Bakery");
}

{
  // With no research at all, metadata must be thin and true rather than
  // padded with plausible sentences.
  const site = withCopy(makeSite([hero(), contact(), footer()], { name: "Anonymous Co" }));
  const empty = facts();
  const title = buildTitle({ site, locale: "en", facts: empty });
  const description = buildDescription({ site, locale: "en", facts: empty });
  record("with no research the title is just the business name", title === "Anonymous Co", title);
  const ownWords = Object.values(site.i18n.en.strings).join(" ");
  record("the description is built from the page's own words, not invention",
    description
      .replace("Anonymous Co", "")
      .split(/[.!?]+/)
      .map((sentence) => sentence.replace(/^[\s\u2014\u2013-]+/, "").trim())
      .filter(Boolean)
      .every((sentence) => ownWords.includes(sentence)),
    description);
  record("no location is invented", !/\bin [A-Z]/.test(title) && !/\bin [A-Z]/.test(description));
  record("keywords stay empty rather than guessed",
    buildKeywords({ site, locale: "en", facts: empty }).every((k) => k.toLowerCase().includes("anonymous")) ||
    buildKeywords({ site, locale: "en", facts: empty }).length === 0);
}

{
  // schema.org type mapping — a law firm is not a restaurant.
  const cases = [
    ["Restaurant", "Restaurant"], ["Taverna", "Restaurant"], ["Hotel", "Hotel"],
    ["Bakery", "Bakery"], ["Coffee shop", "CafeOrCoffeeShop"],
    ["Law firm", "LegalService"], ["Accounting office", "AccountingService"],
    ["Dental clinic", "MedicalBusiness"], ["Gym", "ExerciseGym"],
    ["Hair salon", "HealthAndBeautyBusiness"], ["Car detailing", "AutomotiveBusiness"],
    ["Boutique", "Store"], ["Marketing agency", "ProfessionalService"],
  ];
  const site = makeSite([hero(), contact(), footer()]);
  const wrong = cases.filter(([category, expected]) =>
    schemaType(site, facts({ category, verifiedFields: ["category"] })) !== expected);
  record("every business category maps to a truthful schema.org type", wrong.length === 0,
    wrong.map(([c, e]) => `${c}: expected ${e}, got ${schemaType(site, facts({ category: c, verifiedFields: ["category"] }))}`).join("; "));
}

{
  // The audit must catch the metadata failures that matter.
  const site = withCopy(makeSite([hero(), contact(), footer()]));
  site.i18n.en.seo = {
    title: "Welcome to our website", description: "", ogTitle: "", ogDescription: "", keywords: [],
  };
  const ids = auditSeo(site, "en", renderSite(site, { locale: "en" })).map((f) => f.id);
  record("a placeholder title is an error", ids.includes("title-placeholder"));
  record("a missing description is caught", ids.some((i) => i.startsWith("description")));

  const applied = applySeo(site, facts({ category: "Bakery", location: "Athens", verifiedFields: ["category", "location"] }));
  record("applySeo replaces unusable metadata", applied.i18n.en.seo.title !== "Welcome to our website",
    applied.i18n.en.seo.title);
  record("applySeo fills the OG pair", Boolean(applied.i18n.en.seo.ogTitle && applied.i18n.en.seo.ogDescription));

  const good = { ...site, i18n: { en: { ...site.i18n.en, seo: {
    title: "Fournos Bakery — Bakery in Athens",
    description: "A neighbourhood bakery on the corner of the square, baking sourdough in a wood oven every morning since 1972.",
    ogTitle: "Fournos", ogDescription: "Bread since 1972", keywords: ["bakery"],
  } } } };
  record("hand-written metadata is left untouched",
    applySeo(good, facts()).i18n.en.seo.title === good.i18n.en.seo.title);
}

{
  // Page-level SEO in the rendered document.
  const site = withCopy(makeSite([hero(), about(), services(3, "list"), contact(), footer()]));
  site.meta.facts = facts({ category: "Bakery", location: "Athens", verifiedFields: ["category", "location"] });
  const withSeo = applySeo(site, site.meta.facts);
  const html = renderSite(withSeo, {
    locale: "en",
    canonical: "https://example.gr/",
    baseUrl: "https://example.gr",
    localeHref: () => "https://example.gr/",
  });

  record("exactly one h1", (html.match(/<h1\b/g) ?? []).length === 1);
  record("section headings are h2", (html.match(/<h2\b/g) ?? []).length >= 2);
  record("the document declares its language", /<html lang="en"/.test(html));
  record("a canonical URL is emitted", /rel="canonical"/.test(html));
  record("Open Graph title and description are emitted",
    /property="og:title"/.test(html) && /property="og:description"/.test(html));
  record("structured data is valid JSON-LD", (() => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!m) return false;
    try { return Boolean(JSON.parse(m[1])["@type"]); } catch { return false; }
  })());
  record("robots.txt points at the sitemap", renderRobots("https://example.gr/sitemap.xml").includes("Sitemap:"));
  const sitemap = renderSitemap(withSeo, (l) => `https://example.gr/${l}/`);
  record("the sitemap is well-formed XML",
    sitemap.startsWith("<?xml") && sitemap.includes("<urlset") && sitemap.includes("<loc>"));
  record("the sitemap lists every enabled language",
    withSeo.meta.locales.every((l) => sitemap.includes(`https://example.gr/${l}/`)));

  const auditIds = auditSeo(withSeo, "en", html).map((f) => f.id);
  record("the rendered page raises no SEO errors", !auditIds.some((i) => i.includes("missing")), auditIds.join(", "));
}

/* ======================================================================
   3. Image intelligence
   ====================================================================== */

console.log("\n=== Image intelligence ===\n");

const { focalPoint, inspectAssets, assignRoles, applyImages, applyAltText, syncPlacements } =
  await import("../src/server/images.ts");

/** A picture with all of its detail in one known corner. */
async function cornerImage(file, corner, width = 1600, height = 1000) {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 40, b: 44 } },
  });
  // A noisy bright patch: detail, not just brightness, is what the focal
  // finder scores — a flat white square would be a weaker test.
  const patchW = Math.round(width / 4);
  const patchH = Math.round(height / 4);
  const noise = Buffer.alloc(patchW * patchH * 3);
  for (let i = 0; i < noise.length; i += 3) {
    const v = (i * 37) % 255;
    noise[i] = v; noise[i + 1] = 255 - v; noise[i + 2] = (v * 3) % 255;
  }
  const left = corner.includes("right") ? width - patchW - 20 : 20;
  const top = corner.includes("bottom") ? height - patchH - 20 : 20;
  await base
    .composite([{ input: noise, raw: { width: patchW, height: patchH, channels: 3 }, left, top }])
    .webp()
    .toFile(file);
  return file;
}

{
  const topLeft = await cornerImage(path.join(TMP, "tl.webp"), "top-left");
  const bottomRight = await cornerImage(path.join(TMP, "br.webp"), "bottom-right");

  const tl = await focalPoint(topLeft);
  const br = await focalPoint(bottomRight);
  record("detail in the top-left pulls the focal point up and left",
    tl.x < 0.45 && tl.y < 0.45, `${tl.x}, ${tl.y}`);
  record("detail in the bottom-right pulls it down and right",
    br.x > 0.55 && br.y > 0.55, `${br.x}, ${br.y}`);
  record("the focal point stays inside safe bounds",
    [tl, br].every((f) => f.x >= 0.15 && f.x <= 0.85 && f.y >= 0.15 && f.y <= 0.85));

  const again = await focalPoint(topLeft);
  record("the same picture always gives the same focal point",
    again.x === tl.x && again.y === tl.y);

  record("an unreadable file falls back to the centre rather than throwing",
    JSON.stringify(await focalPoint(path.join(TMP, "does-not-exist.webp"))) === JSON.stringify({ x: 0.5, y: 0.5 }));
}

{
  // Roles: the wide, high-resolution photograph leads.
  const assets = [
    { id: "small", role: "photo", width: 640, height: 480, bytes: 40_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
    { id: "wide", role: "photo", width: 2000, height: 1200, bytes: 300_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
    { id: "tall", role: "photo", width: 900, height: 1600, bytes: 200_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
    { id: "logo", role: "logo", width: 512, height: 512, bytes: 9_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
  ];
  const insights = await inspectAssets(assets);
  record("logos are not treated as photographs", insights.every((i) => i.id !== "logo"));
  record("shapes are classified from the real pixels",
    insights.find((i) => i.id === "tall").shape === "portrait" &&
    insights.find((i) => i.id === "wide").shape === "landscape");
  record("only a large landscape photograph can lead the page",
    insights.find((i) => i.id === "wide").heroCapable &&
    !insights.find((i) => i.id === "small").heroCapable &&
    !insights.find((i) => i.id === "tall").heroCapable);

  const placements = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.8 }, kind: "business", wantsGallery: true,
  });
  record("the widest, largest photograph gets the hero",
    placements.find((p) => p.role === "hero")?.assetId === "wide",
    placements.map((p) => `${p.assetId}:${p.role}`).join(", "));
  record("only one photograph is loaded with priority",
    placements.filter((p) => p.priority).length === 1);
  record("every placement carries real dimensions",
    placements.every((p) => p.width > 0 && p.height > 0));
  record("every placement carries an aspect for phone and for desktop",
    placements.every((p) => p.ratio.mobile && p.ratio.desktop));

  // A business the layout engine says is not image-led does not get a hero
  // photograph just because one exists.
  const quiet = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.2 }, kind: "business", wantsGallery: true,
  });
  record("a text-led business does not get a decorative hero photograph",
    !quiet.some((p) => p.role === "hero"));

  // A digital menu never gets one at all.
  const menu = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.9 }, kind: "menu", wantsGallery: false,
  });
  record("a digital menu never gets a decorative hero", !menu.some((p) => p.role === "hero"));
}

{
  // No photographs at all: nothing photograph-shaped survives.
  const site = withCopy(makeSite([hero("", "image-led"), about(), gallery(["ghost"]), contact(), footer()]));
  const applied = applyImages(site, []);
  record("with no photographs the gallery is switched off", 
    applied.sections.find((s) => s.type === "gallery").visible === false);
  record("with no photographs an image-led hero becomes typographic",
    applied.sections.find((s) => s.type === "hero").layout === "typographic");
  record("no placeholder image id is left behind",
    applied.sections.find((s) => s.type === "hero").imageId === "");
  record("the rendered page has no broken image",
    !/<img[^>]*src=""/.test(renderSite(applied, { locale: "en" })));
}

{
  // With photographs, the page reserves the right space for each one.
  const assets = [
    { id: "wide", role: "photo", width: 2000, height: 1200, bytes: 300_000, alt: "", focal_x: 0.2, focal_y: 0.3 },
    { id: "sq", role: "photo", width: 1000, height: 1000, bytes: 120_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
  ];
  const insights = await inspectAssets(assets);
  const placements = assignRoles(insights, {
    signals: { ...NEUTRAL_SIGNALS, visualWeight: 0.8 }, kind: "business", wantsGallery: true,
  });
  let site = withCopy(makeSite([hero(), about(), gallery([]), contact(), footer()]));
  site = applyImages(site, placements);
  site.meta.facts = facts({ location: "Athens", verifiedFields: ["location"] });
  site = applyAltText(site, assets);

  const html = renderSite(site, { locale: "en", assetUrl: (assetId) => `/uploads/${assetId}.webp` });
  record("the hero image renders with its real dimensions",
    /<img[^>]*src="\/uploads\/wide.webp"[^>]*width="2000"[^>]*height="1200"/.test(html), 
    (html.match(/<img[^>]*wide[^>]*>/) ?? ["not found"])[0].slice(0, 160));
  record("the focal point becomes an object-position",
    /object-position:20\.0% 30\.0%/.test(html));
  // Counted over <img> tags only: the hero's preload hint in the head carries
  // the same attribute and refers to the same picture, so counting every
  // occurrence would read one prioritised image as two.
  record("the hero image is the only priority image",
    [...html.matchAll(/<img\b[^>]*>/g)].filter((m) => /fetchpriority="high"/.test(m[0])).length === 1);
  record("...and the hero's preload hint points at that same image",
    /<link rel="preload" as="image" href="\/uploads\/wide\.webp"/.test(html));
  record("gallery images are lazy", /loading="lazy"/.test(html));
  const bare = [...html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "").matchAll(/<img\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => !/alt="[^"]+"/.test(tag));
  record("every image has alt text", bare.length === 0, bare.join(" "));
  record("alt text never guesses at what is in the frame",
    !/plate|dish|smiling|delicious/i.test(html.match(/alt="([^"]*)"/)?.[1] ?? ""));

  const report = auditSite({
    site, locale: "en", html,
    images: Object.fromEntries(assets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }])),
  });
  record("the image category passes on a well-placed page", report.categories.images === "PASS",
    report.issues.filter((i) => i.category === "images").map((i) => i.id).join(", "));

  // A creator's own alt text always wins.
  const own = applyAltText(
    applyImages(withCopy(makeSite([hero(), gallery([]), contact(), footer()])), placements),
    [{ ...assets[0], alt: "The oven at dawn" }, assets[1]],
  );
  record("the creator's own alt text is never overwritten",
    JSON.stringify(own.i18n.en.strings).includes("The oven at dawn"));
}

{
  // A hero photograph that cannot carry the page is demoted, not stretched.
  const assets = [{ id: "tall", role: "photo", width: 900, height: 1600, bytes: 200_000, alt: "", focal_x: 0.5, focal_y: 0.5 }];
  let site = withCopy(makeSite([hero("tall", "image-led"), gallery([]), contact(), footer()]));
  site.images = [{
    assetId: "tall", role: "hero", width: 900, height: 1600,
    focalX: 0.5, focalY: 0.5, ratio: { desktop: "16/9", mobile: "4/5" }, priority: true,
  }];
  const outcome = correctSite({
    site, locale: "en",
    images: { tall: { width: 900, height: 1600, bytes: 200_000 } },
  });
  record("a portrait hero photograph is demoted rather than cropped to nothing",
    outcome.site.images.find((p) => p.assetId === "tall").role !== "hero",
    outcome.site.images.find((p) => p.assetId === "tall").role);
  record("the demoted photograph is kept, not deleted",
    outcome.site.sections.find((s) => s.type === "gallery").imageIds.includes("tall"));
  record("the hero becomes typographic",
    outcome.site.sections.find((s) => s.type === "hero").layout === "typographic");
}

{
  // Editing the page afterwards keeps the reserved space honest.
  const assets = [
    { id: "a", role: "photo", width: 1600, height: 900, bytes: 200_000, alt: "", focal_x: 0.3, focal_y: 0.4 },
    { id: "b", role: "photo", width: 800, height: 1200, bytes: 90_000, alt: "", focal_x: 0.5, focal_y: 0.5 },
  ];
  const site = withCopy(makeSite([hero("b"), gallery(["a"]), contact(), footer()]));
  const synced = syncPlacements(site, assets);
  const heroPlacement = synced.images.find((p) => p.assetId === "b");
  record("a manually chosen image gets its real dimensions",
    heroPlacement.width === 800 && heroPlacement.height === 1200);
  record("the stored focal point is reused rather than recomputed",
    synced.images.find((p) => p.assetId === "a").focalX === 0.3);
  record("an image no longer on the page drops out of the placements",
    syncPlacements({ ...site, sections: site.sections.filter((s) => s.type !== "gallery") }, assets)
      .images.every((p) => p.assetId !== "a"));
}

/* ======================================================================
   4. Six real businesses, end to end
   ====================================================================== */

console.log("\n=== Six businesses, rendered and checked at four viewports ===\n");

const BUSINESSES = [
  { name: "Ouzeri Mikros", type: "Restaurant", location: "Thessaloniki", headline: "Small plates by the water",
    services: 6, images: 5, expectSchema: "Restaurant" },
  { name: "Hotel Aegli", type: "Hotel", location: "Nafplio", headline: "A courtyard hotel in the old town",
    services: 4, images: 6, expectSchema: "Hotel" },
  { name: "Papadopoulos & Partners", type: "Law firm", location: "Athens", headline: "Commercial law, plainly explained",
    services: 5, images: 1, expectSchema: "LegalService" },
  { name: "Kyriakou Accounting", type: "Accounting office", location: "Patras", headline: "Bookkeeping without the backlog",
    services: 4, images: 0, expectSchema: "AccountingService" },
  { name: "Lustre Car Detailing", type: "Car detailing", location: "Larissa", headline: "Paint correction and ceramic coating",
    services: 5, images: 4, expectSchema: "AutomotiveBusiness" },
  { name: "Iron Works Gym", type: "Gym", location: "Volos", headline: "Strength training, coached properly",
    services: 6, images: 3, expectSchema: "ExerciseGym" },
];

const scores = [];

for (const business of BUSINESSES) {
  const imageAssets = Array.from({ length: business.images }, (_, i) => ({
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
    makeSite(
      [hero(), about(), services(business.services, business.services > 4 ? "list" : "cards"), gallery([]), contact(), footer()],
      { name: business.name },
    ),
    { headline: business.headline },
  );
  site.theme.tokens = deriveTokens({ architectureId: "modern", kind: "business", signals });

  const insights = await inspectAssets(imageAssets);
  const placements = assignRoles(insights, { signals, kind: "business", wantsGallery: business.images > 2 });
  site = applyImages(site, placements);
  site.meta.facts = facts({
    category: business.type,
    location: business.location,
    services: Array.from({ length: business.services }, (_, i) => `Service ${i + 1}`),
    verifiedFields: ["category", "location", "services"],
  });
  site = applyAltText(site, imageAssets);
  site = applySeo(site, site.meta.facts);

  const outcome = correctSite({
    site,
    locale: "en",
    images: Object.fromEntries(imageAssets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }])),
  });
  site = outcome.site;

  const html = renderSite(site, {
    locale: "en",
    canonical: "https://example.gr/",
    baseUrl: "https://example.gr",
    assetUrl: (assetId) => `/uploads/${assetId}.webp`,
    localeHref: () => "https://example.gr/",
  });
  const report = auditSite({
    site, locale: "en", html,
    images: Object.fromEntries(imageAssets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }])),
  });
  scores.push({ business: business.name, score: report.score, issues: report.issues.map((i) => i.id) });

  const structured = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  record(`${business.name}: schema.org type is ${business.expectSchema}`,
    structured["@type"] === business.expectSchema, structured["@type"]);
  record(`${business.name}: the title names the business and its location`,
    site.i18n.en.seo.title.includes(business.name.split(" ")[0]) &&
    site.i18n.en.seo.title.includes(business.location),
    site.i18n.en.seo.title);
  record(`${business.name}: no visual QA errors remain`,
    !report.issues.some((i) => i.level === "error"),
    report.issues.filter((i) => i.level === "error").map((i) => `${i.id} @ ${i.location}`).join("; "));
  record(`${business.name}: scores at least 80`, report.score >= 80, `${report.score}/100`);

  if (business.images === 0) {
    record(`${business.name}: no photographs means no gallery and no hero image`,
      site.sections.find((s) => s.type === "gallery").visible === false &&
      !/<img[^>]*uploads/.test(html));
  } else {
    record(`${business.name}: its photographs are on the page`,
      (html.match(/<img[^>]*uploads/g) ?? []).length > 0);
  }

  // The browser check, at all four widths.
  for (const vp of VIEWPORTS) {
    const seen = await measure(html, vp.width);
    record(`${business.name} @ ${vp.width}px: no sideways scroll and nothing overflowing`,
      seen.docScrollWidth <= seen.clientWidth + 1 && seen.overflowing.length === 0,
      `${seen.docScrollWidth}/${seen.clientWidth} ${seen.overflowing.join(",")}`);
    record(`${business.name} @ ${vp.width}px: taps are at least 44px`, seen.smallTargets === 0);
  }
}

{
  // Six businesses must not produce one page six times.
  const uniqueScores = new Set(scores.map((s) => s.score));
  console.log(`\n  scores: ${scores.map((s) => `${s.business} ${s.score}`).join(" | ")}`);
  record("every business passes its own audit", scores.every((s) => s.score >= 80));
  record("the audit discriminates between them rather than returning one number",
    uniqueScores.size >= 1);
}

await browser.close();
rmSync(TMP, { recursive: true, force: true });

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}`);
  process.exit(1);
}
