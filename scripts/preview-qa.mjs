#!/usr/bin/env node
/**
 * Live preview test.
 *
 * The preview makes one promise — that what the creator is looking at is the
 * website, not a picture of it — and this suite is built to catch that promise
 * being broken in either direction:
 *
 *   It compares the preview's bytes to the bytes the publisher writes. If a
 *   preview-only rendering path ever appears, these stop matching and the
 *   suite fails. That is the check the whole feature rests on.
 *
 *   It drives the device buttons in a real browser and measures what the
 *   framed document reports as its own width, so "Mobile" meaning 390 real CSS
 *   pixels is a measured fact rather than a styling intention.
 *
 *   It tries, from inside the generated page, to do the things the generated
 *   page must never be able to do: read the session, call a builder endpoint,
 *   reach the builder's DOM. Each of those is asserted to fail.
 *
 * Run against a server started with a throwaway data directory:
 *   node --import tsx --conditions react-server scripts/preview-qa.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import sharp from "sharp";

// The publisher itself, not a description of it. Comparing the preview against
// this is what makes "one renderer" a tested fact rather than a claim.
const { buildBundle } = await import("../src/server/bundle.ts");

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

const photo = (w, h, rgb) =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();

async function main() {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  /* ------------------------------------------------------- a real project */

  console.log(`\n=== Generating a website to preview (${BASE}) ===\n`);

  const email = `preview+${Date.now()}@example.com`;
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Preview Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("supersecret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });

  await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Business name").fill("Thalassa Taverna");
  await page.getByLabel("What kind of business is it?").fill("Seafood restaurant");
  await page
    .getByLabel("Describe the business")
    .fill("A family seafood taverna on the waterfront, open since 1978. Grilled fish, meze and local wine.");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Town or city").fill("Nafplio");
  await page.getByLabel("Phone").fill("+30 2752 000000");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("radio", { name: /Full business website/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Two languages, so the visitor-facing switcher is exercised for real.
  await page.getByRole("radio", { name: /Greek/ }).click();
  const english = page.getByRole("checkbox", { name: /English/ });
  if ((await english.getAttribute("aria-checked")) !== "true") await english.click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("radio", { name: /Warm/ }).click();
  await page.getByRole("button", { name: "Generate website" }).click();
  await page.waitForURL(/\/generate/, { timeout: 15000 });

  /* ----------------------------------- 1. the site appears by itself */

  console.log("\n=== The finished website appears without being asked for ===\n");

  // No click, no navigation: the generation screen itself must become the
  // preview. Waiting on the frame rather than on any wording means this
  // asserts the website arrived, not that a label changed.
  const previewFrame = page.locator("iframe[data-preview-frame]");
  await previewFrame.waitFor({ timeout: 240000 });
  record("the generation screen turns into the live preview on its own", true);

  record(
    "it says the generation succeeded",
    await page.getByText("Website generated successfully.").isVisible(),
  );
  record(
    "the URL never left the generation screen",
    /\/generate$/.test(page.url()),
    page.url(),
  );

  const frame = page.frameLocator("iframe[data-preview-frame]");
  await frame.locator("footer").waitFor({ timeout: 20000 });
  record("the generated website is rendered inside the application", true);

  const headline = (await frame.locator("h1").first().innerText()).trim();
  record("the website's own headline is on screen", headline.length > 0, headline.slice(0, 48));
  await page.waitForFunction(
    () => !document.querySelector("[data-preview-loading]"),
    null,
    { timeout: 20000 },
  );
  record("the loading state clears once it has rendered", true);
  record(
    "no error state is shown for a healthy site",
    (await page.locator("[data-preview-error]").count()) === 0,
  );

  const projectUrl = page.url().replace(/\/generate$/, "");
  const projectId = projectUrl.split("/").pop();

  /* ------------------------------- 2. one renderer, one source of truth */

  console.log("\n=== Preview and published output come from one renderer ===\n");

  // Take the document the application is holding, run the *publisher* over it
  // here, and compare with what the preview served. If a preview-only
  // rendering path is ever introduced, these two stop agreeing.
  const siteDoc = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/site`, { cache: "no-store" });
    return (await res.json()).site;
  }, projectId);

  const previewHtml = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render?locale=el`, { cache: "no-store" });
    return res.text();
  }, projectId);

  record("the preview returns a full HTML document", /^<!doctype html/i.test(previewHtml.trim()));

  {
    const bundle = buildBundle(siteDoc);
    const published = bundle.find((f) => f.name === "el/index.html")?.content ?? "";
    record("the publisher produced a page for the same language", published.length > 0);

    /**
     * Normalise only what is *meant* to differ: where links and images point.
     *
     * A published page reaches its sibling languages with a relative path and
     * its images from a folder beside it; a preview reaches both through this
     * application's endpoints. Those are the two documented differences, so
     * both sides are rewritten to a neutral form. Everything else — every tag,
     * attribute, byte of CSS and word of copy — must match exactly, and the
     * comparison below is what proves it does.
     */
    const LOCALE = "el";
    const normalise = (html) =>
      html
        // Images: "../images/<id>.webp" and "/api/assets/<id>?pt=…" both mean
        // "this asset".
        .replace(/src="[^"]*?([A-Za-z0-9-]+)\.webp[^"]*"/g, 'src="ASSET:$1"')
        .replace(/src="\/api\/assets\/([A-Za-z0-9-]+)[^"]*"/g, 'src="ASSET:$1"')
        // Language links: "../en/", "./" and "…render?locale=en&pt=…" all mean
        // "this language's page".
        .replace(/href="[^"]*?render\?locale=([a-z]{2})[^"]*"/g, 'href="LANG:$1"')
        .replace(/href="\.\.\/([a-z]{2})\/"/g, 'href="LANG:$1"')
        .replace(/href="\.\/"/g, `href="LANG:${LOCALE}"`);

    const a = normalise(previewHtml);
    const b = normalise(published);
    let where = "";
    if (a !== b) {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
      where = `first difference at ${i}: preview ${JSON.stringify(a.slice(i - 40, i + 60))} vs published ${JSON.stringify(b.slice(i - 40, i + 60))}`;
    }
    record("preview and published HTML are identical once URLs are normalised", a === b, where);

    const styleOf = (html) => (html.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
    record(
      "the design tokens reach both identically",
      styleOf(previewHtml).length > 0 && styleOf(previewHtml) === styleOf(published),
    );
    const sectionsOf = (html) => (html.match(/<section[^>]*id="([^"]+)"/g) ?? []).join("|");
    record(
      "the layout decisions reach both identically",
      sectionsOf(previewHtml).length > 0 && sectionsOf(previewHtml) === sectionsOf(published),
    );
    const ldOf = (html) => (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) ?? [])[1] ?? "";
    record("the SEO metadata reaches both identically", ldOf(previewHtml) === ldOf(published));

    record(
      "the published HTML has no builder chrome either",
      !bundle.some(
        (f) => f.kind === "text" && f.name.endsWith(".html") && /data-preview-|Preview width/.test(f.content),
      ),
    );
  }

  /* ------------------------ 3. builder controls stay out of the website */

  console.log("\n=== The builder's controls are not in the website ===\n");

  for (const marker of ["data-preview-frame", "data-preview-caption", "Preview width", "radiogroup"]) {
    record(
      `the generated HTML contains no "${marker}"`,
      !previewHtml.includes(marker),
    );
  }
  /* --------------------------------------------- 4. device preview modes */

  console.log("\n=== Device widths are real viewport widths ===\n");

  await page.goto(`${projectUrl}/preview`, { waitUntil: "networkidle" });
  await page.locator("iframe[data-preview-frame]").waitFor({ timeout: 20000 });
  const widths = page.getByRole("radiogroup", { name: "Preview width" });

  for (const [label, expected] of [
    ["Desktop", 1440],
    ["Tablet", 834],
    ["Mobile", 390],
    ["Narrow mobile", 320],
  ]) {
    await widths.getByRole("radio", { name: label, exact: true }).click();
    await page.waitForTimeout(350);

    // What the *document inside* believes its viewport is. A shrunken desktop
    // would report 1440 here whatever the box around it looked like.
    const inner = await page
      .frameLocator("iframe[data-preview-frame]")
      .locator("body")
      .evaluate(() => window.innerWidth);
    record(`${label}: the website's own viewport is ${expected}px`, inner === expected, `${inner}px`);

    const overflow = await page
      .frameLocator("iframe[data-preview-frame]")
      .locator("body")
      .evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth - de.clientWidth;
      });
    record(`${label}: the website does not scroll sideways`, overflow <= 1, `${overflow}px over`);
  }

  // Responsive CSS really fires: the phone navigation exists at 390 and the
  // desktop navigation is the one on screen at 1440.
  await widths.getByRole("radio", { name: "Mobile", exact: true }).click();
  await page.waitForTimeout(300);
  const mobileNav = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("body")
    .evaluate(() => {
      const toggle = document.querySelector(".nav-toggle");
      const desktop = document.querySelector(".nav-desktop");
      return {
        toggle: toggle ? getComputedStyle(toggle).display !== "none" : false,
        desktop: desktop ? getComputedStyle(desktop).display !== "none" : false,
      };
    });
  await widths.getByRole("radio", { name: "Desktop", exact: true }).click();
  await page.waitForTimeout(300);
  const desktopNav = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("body")
    .evaluate(() => {
      const toggle = document.querySelector(".nav-toggle");
      const desktop = document.querySelector(".nav-desktop");
      return {
        toggle: toggle ? getComputedStyle(toggle).display !== "none" : false,
        desktop: desktop ? getComputedStyle(desktop).display !== "none" : false,
      };
    });
  record(
    "the website's own breakpoints decide the navigation, not the builder",
    mobileNav.toggle && !mobileNav.desktop && desktopNav.desktop && !desktopNav.toggle,
    `mobile ${JSON.stringify(mobileNav)} desktop ${JSON.stringify(desktopNav)}`,
  );

  // Touch targets at the two phone widths — the standard the generated sites
  // are held to, checked where a person would actually look at them.
  for (const label of ["Mobile", "Narrow mobile"]) {
    await widths.getByRole("radio", { name: label, exact: true }).click();
    await page.waitForTimeout(300);
    const small = await page
      .frameLocator("iframe[data-preview-frame]")
      .locator("body")
      .evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('a[href], button, [role="button"]')) {
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (style.clipPath && style.clipPath !== "none") continue;
          if (el.tagName === "A" && style.display === "inline") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 43.5) {
            out.push(
              `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 28)}">` +
                `"${(el.textContent || "").trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      });
    record(`${label}: every tap target is at least 44px tall`, small.length === 0, small.join("; "));
  }

  const custom = page.getByLabel("Custom preview width in pixels");
  await custom.fill("1024");
  await page.waitForTimeout(500);
  const customInner = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("body")
    .evaluate(() => window.innerWidth);
  record("a custom width is honoured exactly", customInner === 1024, `${customInner}px`);

  /* ------------------------------------------ 5. the website really works */

  console.log("\n=== The website behaves like a website ===\n");

  // Tablet, not Desktop: a 1440px frame in a narrower panel is drawn through a
  // CSS transform, and driving clicks through one is a test-harness problem
  // rather than a product one. At 834px the frame is 1:1, so a click here is
  // the click a person makes.
  await widths.getByRole("radio", { name: "Tablet", exact: true }).click();
  await page.waitForTimeout(400);
  const site = page.frameLocator("iframe[data-preview-frame]");

  const beforeLang = await site.locator("html").getAttribute("lang");
  // The switcher inside the page is the website's own, not a builder control.
  // The link for the language already showing goes nowhere by design, so the
  // one worth clicking is the other language's.
  const switcher = site.locator('[data-lang-link]:not([aria-current="true"])').first();
  if (await switcher.count()) {
    await switcher.click();
    await page.waitForTimeout(1200);
    const afterLang = await site.locator("html").getAttribute("lang");
    record(
      "the website's own language switcher navigates the preview",
      Boolean(beforeLang) && Boolean(afterLang) && beforeLang !== afterLang,
      `${beforeLang} → ${afterLang}`,
    );
  } else {
    record("the website's own language switcher navigates the preview", false, "no switcher found");
  }

  // In-page navigation: the nav links are anchors into the same document.
  await widths.getByRole("radio", { name: "Tablet", exact: true }).click();
  await page.waitForTimeout(400);
  const anchors = await site.locator('.nav-desktop a[href^="#"]').count();
  record("in-page navigation links are present", anchors > 0, `${anchors} links`);
  if (anchors > 0) {
    await site.locator('.nav-desktop a[href^="#"]').first().click();
    await page.waitForTimeout(500);
    const scrolled = await site.locator("body").evaluate(() => window.scrollY);
    record("clicking a navigation link moves the page", scrolled > 0, `${scrolled}px`);
    await site.locator("body").evaluate(() => window.scrollTo(0, 0));
  }

  record(
    "telephone and email links are real links",
    (await site.locator('a[href^="tel:"]').count()) > 0 ||
      (await site.locator('a[href^="mailto:"]').count()) > 0,
  );

  /* ------------------------------------------------------ 6. images load */

  console.log("\n=== Images load inside the sandboxed frame ===\n");

  await page.goto(`${projectUrl}/media`, { waitUntil: "networkidle" });
  const upload = page.locator('input[type="file"]').first();
  for (const file of [
    { name: "boat.png", mimeType: "image/png", buffer: await photo(1800, 1100, { r: 20, g: 80, b: 120 }) },
    { name: "plate.png", mimeType: "image/png", buffer: await photo(1400, 1050, { r: 190, g: 120, b: 60 }) },
  ]) {
    await upload.setInputFiles(file);
    await page.waitForTimeout(2500);
  }

  // Put the photographs on the page. Done through the site document rather
  // than the picker because what is under test here is whether an image
  // reaches a frame that has no cookies — the picker has its own coverage.
  const placed = await page.evaluate(async (pid) => {
    const assets = await (await fetch(`/api/projects/${pid}/assets`, { cache: "no-store" })).json();
    const ids = (assets.assets ?? []).filter((a) => a.role !== "logo").map((a) => a.id);
    if (!ids.length) return 0;

    const { site } = await (await fetch(`/api/projects/${pid}/site`, { cache: "no-store" })).json();
    for (const section of site.sections) {
      if (section.type === "hero") section.imageId = ids[0];
      if (section.type === "gallery") {
        section.imageIds = ids;
        section.visible = true;
      }
    }
    const res = await fetch(`/api/projects/${pid}/site`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site }),
    });
    return res.ok ? ids.length : 0;
  }, projectId);
  record("the uploaded photographs are placed on the page", placed > 0, `${placed} images`);

  await page.goto(`${projectUrl}/edit`, { waitUntil: "networkidle" });
  await page.locator("iframe[data-preview-frame]").waitFor({ timeout: 20000 });
  record("the editor shows the live preview beside the section list", true);
  await page.frameLocator("iframe[data-preview-frame]").locator("footer").waitFor({ timeout: 20000 });

  const images = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("body")
    .evaluate(() =>
      [...document.images].map((img) => ({
        src: img.currentSrc || img.src,
        loaded: img.complete && img.naturalWidth > 0,
        w: img.getAttribute("width"),
        h: img.getAttribute("height"),
      })),
    );
  if (images.length) {
    record(
      "every image in the preview actually loaded",
      images.every((i) => i.loaded),
      images.filter((i) => !i.loaded).map((i) => i.src).join("; "),
    );
    record(
      "images are served through a preview capability, not the session",
      images.every((i) => /[?&]pt=/.test(i.src)),
      images.map((i) => i.src.slice(-40)).join(" "),
    );
    record(
      "images reserve their space before they load",
      images.every((i) => i.w && i.h),
    );
  } else {
    record("every image in the preview actually loaded", true, "no images on this page");
  }

  /* ---------------------------------------- 7. refresh reflects an edit */

  console.log("\n=== An edit reaches the preview ===\n");

  const newName = `Thalassa ${Date.now().toString().slice(-4)}`;
  const beforeEdit = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("h1")
    .first()
    .innerText();

  const applied = await page.evaluate(async ({ pid, name }) => {
    const res = await fetch(`/api/projects/${pid}/site`, { cache: "no-store" });
    const { site } = await res.json();
    const hero = site.sections.find((s) => s.type === "hero");
    site.i18n[site.meta.defaultLocale].strings[`${hero.id}.headline`] = name;
    const put = await fetch(`/api/projects/${pid}/site`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site }),
    });
    return put.ok;
  }, { pid: projectId, name: newName });
  record("an edit is saved to the site document", applied);

  await page.getByRole("button", { name: "Refresh the preview" }).first().click();
  await page.waitForTimeout(2500);
  const afterEdit = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("h1")
    .first()
    .innerText();
  record(
    "refreshing shows the edit",
    afterEdit.trim() === newName,
    `"${beforeEdit.trim().slice(0, 30)}" → "${afterEdit.trim().slice(0, 30)}"`,
  );

  // The workspace around it did not reload: the editor kept its own state.
  record(
    "the application itself did not reload",
    await page.locator("iframe[data-preview-frame]").isVisible(),
  );

  /* ---------------------------------------------------- 8. isolation */

  console.log("\n=== The website cannot reach the builder ===\n");

  const escape = await page
    .frameLocator("iframe[data-preview-frame]")
    .locator("body")
    .evaluate(async () => {
      const out = {};
      out.origin = window.origin ?? String(location.origin);
      try {
        out.cookie = document.cookie;
      } catch {
        out.cookie = "THREW";
      }
      try {
        out.storage = window.localStorage ? "reachable" : "absent";
      } catch {
        out.storage = "THREW";
      }
      try {
        // The decisive one: can the page call this application's API?
        const res = await fetch("/api/projects", { credentials: "include" });
        out.api = `status ${res.status}`;
      } catch (err) {
        out.api = `blocked: ${String(err).slice(0, 40)}`;
      }
      try {
        out.parentDom = parent.document.title;
      } catch {
        out.parentDom = "THREW";
      }
      try {
        out.parentOrigin = parent.location.href;
      } catch {
        out.parentOrigin = "THREW";
      }
      return out;
    });

  record(
    "the website runs in an origin of its own",
    escape.origin === "null" || escape.origin === "",
    String(escape.origin),
  );
  record(
    "it cannot call a builder API",
    escape.api.startsWith("blocked"),
    escape.api,
  );
  record(
    "it cannot read the builder's DOM",
    escape.parentDom === "THREW",
    String(escape.parentDom),
  );
  record(
    "it cannot read the builder's location",
    escape.parentOrigin === "THREW",
    String(escape.parentOrigin),
  );
  record(
    "it carries no session cookie",
    !String(escape.cookie).includes("wg_session"),
    String(escape.cookie).slice(0, 40),
  );

  // The headers that back those guarantees, asserted directly.
  const headers = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render`, { cache: "no-store" });
    const out = {};
    res.headers.forEach((v, k) => (out[k] = v));
    return out;
  }, projectId);
  const csp = headers["content-security-policy"] ?? "";
  record("the preview response forbids outbound connections", csp.includes("connect-src 'none'"), csp.slice(0, 60));
  record("the preview response forbids form submission", csp.includes("form-action 'none'"));
  record("the preview response may only be framed by this app", csp.includes("frame-ancestors 'self'"));
  record("the preview response is never cached", (headers["cache-control"] ?? "").includes("no-store"));

  // A preview capability is scoped to one project and read-only.
  const assetSrc = images.find((i) => /[?&]pt=/.test(i.src))?.src ?? "";
  if (assetSrc) {
    const token = new URL(assetSrc, BASE).searchParams.get("pt");
    // A context of its own, with no session cookie: otherwise this would be
    // testing the signed-in user's access and calling it the token's.
    const anonContext = await browser.newContext();
    const other = await anonContext.newPage();
    await other.goto(`${BASE}/login`);
    const cross = await other.evaluate(
      async ({ base, token }) => {
        const res = await fetch(`${base}/api/projects/some-other-project/render?pt=${encodeURIComponent(token)}`);
        return res.status;
      },
      { base: BASE, token },
    );
    record("a preview token is useless for another project", cross === 401 || cross === 404, `status ${cross}`);

    const write = await other.evaluate(
      async ({ base, pid, token }) => {
        const res = await fetch(`${base}/api/projects/${pid}/site?pt=${encodeURIComponent(token)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: {} }),
        });
        return res.status;
      },
      { base: BASE, pid: projectId, token },
    );
    record("a preview token cannot write anything", write === 401, `status ${write}`);
    await anonContext.close();
  } else {
    record("a preview token is useless for another project", false, "no tokenised asset URL seen");
  }

  /* ------------------------------------------------- 9. error handling */

  console.log("\n=== Failure is shown, not hidden ===\n");

  // A project that was never generated has no document to render.
  await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Business name").fill("Never Generated");
  await page.getByLabel("What kind of business is it?").fill("Bookshop");
  await page.getByLabel("Describe the business").fill("A second-hand bookshop that has not been generated yet.");
  const blank = await page.evaluate(async () => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: "Never Generated", businessType: "Bookshop", siteKind: "business",
        mapsUrl: "", location: "Athens", phone: "", email: "",
        description: "A second-hand bookshop.", style: "classic", designNotes: "",
        logoAssetId: "", defaultLocale: "en", locales: ["en"],
      }),
    });
    return res.ok ? (await res.json()).project?.id ?? null : null;
  });

  if (blank) {
    const status = await page.evaluate(async (pid) => {
      const res = await fetch(`/api/projects/${pid}/render`, { cache: "no-store" });
      return { code: res.status, type: res.headers.get("content-type") ?? "" };
    }, blank);
    record(
      "an ungenerated project reports a real failure status",
      status.code === 404,
      `status ${status.code}`,
    );
    record(
      "...as a document the frame can display",
      status.type.includes("text/html"),
      status.type,
    );
  } else {
    record("an ungenerated project reports a real failure status", false, "could not create a project");
  }

  // A signed-out request must not render somebody's unpublished website.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE}/login`);
  const anonStatus = await anonPage.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render`, { cache: "no-store" });
    return res.status;
  }, projectId);
  record("a signed-out visitor cannot render the project", anonStatus === 401, `status ${anonStatus}`);
  await anon.close();

  // And the preview surfaces a failure rather than a blank panel.
  await page.goto(`${projectUrl}/preview`, { waitUntil: "networkidle" });
  await page.locator("iframe[data-preview-frame]").waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    const frame = document.querySelector("iframe[data-preview-frame]");
    // Point the frame at a project that is not ours: the same failure the
    // creator would hit if their document could not be rendered.
    frame.src = "/api/projects/does-not-exist/render";
  });
  await page.locator("[data-preview-error]").waitFor({ timeout: 15000 });
  record("a failed render shows 'Preview unavailable' in the preview area", true);
  record(
    "it offers a retry",
    await page.getByRole("button", { name: "Retry preview" }).isVisible(),
  );
  record(
    "the rest of the application is still usable",
    await page.getByRole("radiogroup", { name: "Preview width" }).isVisible(),
  );

  await page.getByRole("button", { name: "Retry preview" }).click();
  await page.waitForTimeout(2500);
  record(
    "retry brings the website back",
    (await page.locator("[data-preview-error]").count()) === 0,
  );

  await browser.close();

  console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
  if (failures) {
    console.log("\nFailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Preview QA harness crashed:", err);
  process.exit(2);
});
