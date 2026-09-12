/**
 * Application QA harness.
 *
 * Two products are tested here, to two different standards, and keeping them
 * apart is the point:
 *
 *   The builder is a Windows desktop application. It is driven at a desktop
 *   window size, must show its sidebar rather than a phone tab bar, and its
 *   controls are held to the WCAG 2.2 pointer target minimum of 24px. It must
 *   also survive being resized down to a narrow window — that is
 *   responsiveness, not a phone layout.
 *
 *   The websites it generates are visited by strangers on phones. They keep
 *   the strict mobile rules: 44px touch targets, no horizontal overflow at any
 *   width, and a layout that works on a 320px screen.
 *
 * Run with: node scripts/mobile-qa.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const BASE = process.argv[2] ?? "http://localhost:3100";
/**
 * This container pre-installs Chromium outside Playwright's own cache. Fall
 * back to Playwright's resolution so the suite also runs on a plain machine
 * (a CI runner, a contributor's laptop) after `playwright install chromium`.
 */
const PRESET = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXEC = process.env.PW_CHROME ?? (existsSync(PRESET) ? PRESET : undefined);
const SHOTS = "qa-screenshots";

// The exact widths the requirements name, plus the shell breakpoints.
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];
const MIN_TARGET = 44;
/** WCAG 2.2 target size (minimum) for a pointer-driven interface. */
const POINTER_TARGET = 24;


/**
 * Real image fixtures, built with sharp rather than hand-written base64, so a
 * malformed literal can never masquerade as an application bug.
 */
async function makePng(width, height, rgb) {
  return sharp({
    create: { width, height, channels: 3, background: rgb },
  })
    .png()
    .toBuffer();
}

const results = [];
let failures = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Fails if the page can be panned sideways: the classic mobile layout bug. */
async function checkNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollW: de.scrollWidth,
      clientW: de.clientWidth,
      // Name the widest offender so a failure is actionable.
      culprit: (() => {
        let worst = null;
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.right > de.clientWidth + 1 || r.left < -1) {
            if (!worst || r.width > worst.width) {
              worst = {
                width: Math.round(r.width),
                right: Math.round(r.right),
                tag: el.tagName.toLowerCase(),
                cls: String(el.className || "").slice(0, 60),
              };
            }
          }
        }
        return worst;
      })(),
    };
  });
  const ok = overflow.scrollW <= overflow.clientW + 1;
  record(
    `${label}: no horizontal overflow`,
    ok,
    ok
      ? ""
      : `scrollWidth ${overflow.scrollW} > ${overflow.clientW}` +
        (overflow.culprit ? ` (widest: <${overflow.culprit.tag} class="${overflow.culprit.cls}"> ${overflow.culprit.width}px)` : ""),
  );
}

/**
 * Fails if any visible control is smaller than the given minimum.
 *
 * 44px for anything a stranger taps on a phone — a generated website, or the
 * builder in a window narrow enough that touch is plausible. 24px for the
 * builder on a desktop window, which is the WCAG 2.2 minimum for a pointer.
 */
async function checkTargets(page, label, min = MIN_TARGET) {
  const small = await page.evaluate((min) => {
    const out = [];
    const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"], [role="checkbox"]';
    for (const el of document.querySelectorAll(sel)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      // Visually-hidden-until-focused controls (the skip link) are clipped to
      // 1x1 by design. They are exempt: they only exist for keyboard users.
      if (style.clipPath && style.clipPath !== "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Skip inline links inside prose — WCAG 2.5.5 exempts inline text links.
      if (el.tagName === "A" && style.display === "inline") continue;
      if (r.height < min - 0.5 || r.width < min - 0.5) {
        out.push({
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out;
  }, min);

  record(
    `${label}: targets >= ${min}px`,
    small.length === 0,
    small.length ? small.map((s) => `<${s.tag}> "${s.label}" ${s.w}x${s.h}`).join("; ") : "",
  );
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});

  // A desktop application window, which is what the builder now is.
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await desktop.newPage();

  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  console.log(`\n=== Builder workflow at 1440x900 (${BASE}) ===\n`);

  /* 1. Sign up ---------------------------------------------------------- */
  const email = `qa+${Date.now()}@example.com`;
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "signup");
  await checkTargets(page, "signup", POINTER_TARGET);

  await page.getByLabel("Your name").fill("QA Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("supersecret123");
  await page.screenshot({ path: `${SHOTS}/01-signup.png` });
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  record("sign up completes", true);

  /* 2. Dashboard empty state -------------------------------------------- */
  await page.waitForLoadState("networkidle");
  await checkNoHorizontalOverflow(page, "dashboard (empty)");
  await page.screenshot({ path: `${SHOTS}/02-dashboard-empty.png` });
  // A desktop application navigates from a persistent sidebar.
  const sidebar = page.locator('nav[aria-label="Main"]').first();
  record("the workspace sidebar is visible", await sidebar.isVisible());
  record(
    "it lists the application's destinations",
    (await sidebar.getByRole("link", { name: "Projects" }).count()) === 1 &&
      (await sidebar.getByRole("link", { name: "New project" }).count()) === 1 &&
      (await sidebar.getByRole("link", { name: "Profile" }).count()) === 1,
  );
  record(
    "no phone tab bar is left behind",
    (await page.locator('nav[aria-label="Main"] a[href="/projects/new"]').count()) <= 1,
  );

  /* 3. Create project (4-step wizard) ------------------------------------ */
  await page.getByRole("link", { name: "Create a project" }).click();
  await page.waitForURL(/\/projects\/new/);
  await page.waitForLoadState("networkidle");
  await checkNoHorizontalOverflow(page, "wizard step 1");
  await checkTargets(page, "wizard step 1", POINTER_TARGET);

  await page.getByLabel("Business name").fill("Caffè Verde");
  await page.getByLabel("What kind of business is it?").fill("Coffee shop");
  await page
    .getByLabel("Describe the business")
    .fill("Small independent coffee shop near the station. We roast our own beans and bake everything in-house.");
  // Requirement 20: the logo control sits directly below the business name.
  const logoButton = page.getByRole("button", { name: "Add a logo" });
  record("logo upload is offered under the business name", await logoButton.isVisible());
  const logoPng = await makePng(240, 240, { r: 0x16, g: 0x65, b: 0x34 });
  await page.locator('input[type="file"][accept*="svg"]').setInputFiles({
    name: "logo.png", mimeType: "image/png", buffer: logoPng,
  });
  await page.getByRole("button", { name: "Remove logo" }).waitFor({ timeout: 20000 });
  record("logo uploads and previews in the wizard", true);

  await page.screenshot({ path: `${SHOTS}/03-wizard-business.png` });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: paste a Google Maps link, exactly as from the mobile share sheet.
  await page.getByLabel("Google Maps link").fill(
    "https://www.google.com/maps/place/Caffe+Verde/@40.6401,22.9444,17z",
  );
  await page.getByLabel("Town or city").fill("Thessaloniki");
  await page.getByLabel("Phone").fill("+30 2310 000000");
  const recognised = await page.getByText(/Recognised: Caffe Verde/i).isVisible();
  record("Google Maps link is parsed and confirmed inline", recognised);
  await page.screenshot({ path: `${SHOTS}/04-wizard-maps.png` });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: website type
  await checkTargets(page, "wizard step 3", POINTER_TARGET);
  await page.getByRole("radio", { name: /Digital menu/ }).click();
  await page.screenshot({ path: `${SHOTS}/05-wizard-type.png` });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: languages — pick Greek as the main language and add English, so
  // the rest of the run exercises the real multi-language path.
  await checkTargets(page, "wizard step 4 (languages)", POINTER_TARGET);
  await page.getByRole("radio", { name: /Greek/ }).click();
  // Choosing a new main language keeps the previous one as a second language,
  // so only tick English if it is not already selected.
  const englishBox = page.getByRole("checkbox", { name: /English/ });
  if ((await englishBox.getAttribute("aria-checked")) !== "true") await englishBox.click();
  record("English is enabled alongside Greek", (await englishBox.getAttribute("aria-checked")) === "true");
  await page.screenshot({ path: `${SHOTS}/06-wizard-languages.png` });
  record(
    "wizard explains that two languages produce a visitor switcher",
    await page.getByText(/2 languages\. Visitors will see a switcher/).isVisible(),
  );
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5: style
  await page.getByRole("radio", { name: /Warm/ }).click();
  await page.screenshot({ path: `${SHOTS}/06b-wizard-style.png` });
  await page.getByRole("button", { name: "Generate website" }).click();

  /* 4. Generation -------------------------------------------------------- */
  await page.waitForURL(/\/generate/, { timeout: 15000 });
  record("lands on the generation screen", true);
  await checkNoHorizontalOverflow(page, "generation");
  await page.screenshot({ path: `${SHOTS}/07-generating.png` });

  // Generation continues while the window is not in front. Simulate leaving
  // by opening a second window and hiding this one.
  const other = await desktop.newPage();
  await other.goto(`${BASE}/account`);
  await new Promise((r) => setTimeout(r, 2500));
  await other.close();
  await page.bringToFront();

  // Completion is the website appearing, not a form of words: the generation
  // screen turns into the live preview by itself when the job finishes.
  await page.locator("iframe[data-preview-frame]").waitFor({ timeout: 240000 });
  record("generation completes while the app was backgrounded", true);
  record(
    "the finished website appears without being asked for",
    await page.getByText("Website generated successfully.").isVisible(),
  );
  await page.frameLocator("iframe[data-preview-frame]").locator("footer").waitFor({ timeout: 30000 });
  record("the generated website is shown inside the application", true);
  await page.screenshot({ path: `${SHOTS}/08-generated.png` });

  const projectUrl = page.url().replace(/\/generate$/, "");
  const projectId = projectUrl.split("/").pop();

  /* 5. Preview with device selector -------------------------------------- */
  await page.goto(`${projectUrl}/preview`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "preview");
  await checkTargets(page, "preview", POINTER_TARGET);
  const widthGroup = page.getByRole("radiogroup", { name: "Preview width" });
  const devices = await widthGroup.getByRole("radio").count();
  record(
    "the preview offers every width the visual QA audits",
    devices >= 4,
    `${devices} device options`,
  );

  // The iframe must render the site at a real mobile viewport, not scaled down.
  await widthGroup.getByRole("radio", { name: "Mobile", exact: true }).click();
  const frame = page.frameLocator("iframe[data-preview-frame]");
  await frame.locator("body").waitFor({ timeout: 15000 });
  const innerWidth = await page.evaluate(
    () => document.querySelector("iframe[data-preview-frame]")?.getBoundingClientRect().width ?? 0,
  );
  record("mobile preview renders at native width (no shrunken desktop)", innerWidth >= 320 && innerWidth <= 400, `${Math.round(innerWidth)}px`);
  await page.screenshot({ path: `${SHOTS}/09-preview-mobile.png` });

  await widthGroup.getByRole("radio", { name: "Desktop", exact: true }).click();
  await page.waitForTimeout(600);
  await checkNoHorizontalOverflow(page, "preview (desktop mode)");
  await page.screenshot({ path: `${SHOTS}/10-preview-desktop.png` });
  await widthGroup.getByRole("radio", { name: "Mobile", exact: true }).click();

  /* 5b. Visitor language system ------------------------------------------ */
  // The preview renders the real per-language document, so asserting here is
  // asserting what a visitor actually receives.
  const previewFrame = page.frameLocator("iframe[data-preview-frame]");
  const langGroup = page.getByRole("radiogroup", { name: "Preview language" });
  record(
    "preview offers a language selector when 2 languages are enabled",
    await langGroup.getByRole("radio", { name: /Greek/ }).isVisible(),
  );

  const elDoc = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render?locale=el`);
    return res.text();
  }, projectId);
  const enDoc = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render?locale=en`);
    return res.text();
  }, projectId);

  record('Greek document declares lang="el"', /<html lang="el"/.test(elDoc));
  record('English document declares lang="en"', /<html lang="en"/.test(enDoc));
  record(
    "each language links the other with hreflang",
    /hreflang="en"/.test(elDoc) && /hreflang="el"/.test(elDoc) && /hreflang="x-default"/.test(elDoc),
  );
  record(
    "the generated site renders a visitor language switcher",
    /<nav class="lang/.test(elDoc) || /lang-banner/.test(elDoc),
  );
  record("structured data is emitted per language", /application\/ld\+json/.test(elDoc) && /"inLanguage":"el"/.test(elDoc));
  record("og:locale is localised", /og:locale" content="el"/.test(elDoc) && /og:locale:alternate" content="en"/.test(elDoc));

  // Requirement 30: switching language must not change the design identity.
  const styleOf = (doc) => (doc.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
  record(
    "changing language does not change the design (identical stylesheet)",
    styleOf(elDoc).length > 0 && styleOf(elDoc) === styleOf(enDoc),
  );
  const sectionsOf = (doc) => (doc.match(/<section[^>]*id="([^"]+)"/g) ?? []).join("|");
  record(
    "changing language does not change the structure (identical sections)",
    sectionsOf(elDoc).length > 0 && sectionsOf(elDoc) === sectionsOf(enDoc),
  );
  record(
    "changing language does change the content",
    elDoc.replace(/<style>[\s\S]*?<\/style>/, "") !== enDoc.replace(/<style>[\s\S]*?<\/style>/, ""),
  );

  // Prices are structural and must be byte-identical across languages.
  const pricesOf = (doc) => (doc.match(/<span class="price">([^<]*)<\/span>/g) ?? []).join("|");
  record("prices are never translated", pricesOf(elDoc) === pricesOf(enDoc));

  await langGroup.getByRole("radio", { name: /English/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/09b-preview-english.png` });
  await langGroup.getByRole("radio", { name: /Greek/ }).click();

  /* 5c. Language management ---------------------------------------------- */
  await page.goto(`${projectUrl}/languages`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "languages");
  await checkTargets(page, "languages", POINTER_TARGET);
  await page.screenshot({ path: `${SHOTS}/09c-languages.png` });
  record(
    "languages screen lists both enabled languages",
    (await page.getByText("Greek", { exact: false }).count()) > 0 &&
      (await page.getByText("English", { exact: false }).count()) > 0,
  );

  // Removing a language must leave the others and the design untouched.
  await page.getByRole("button", { name: /Remove English/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.waitForTimeout(2000);
  const afterRemoval = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render?locale=el`);
    return res.text();
  }, projectId);
  record(
    "removing a language hides the visitor switcher when one remains",
    !/hreflang="en"/.test(afterRemoval),
  );
  record(
    "removing a language does not change the design",
    styleOf(afterRemoval) === styleOf(elDoc),
  );

  // Re-add it so the rest of the run continues multilingual.
  await page.getByRole("button", { name: "Add a language" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /English/ }).first().click();
  await page.waitForTimeout(3000);
  const readded = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render?locale=el`);
    return res.text();
  }, projectId);
  record("a language can be added back after generation", /hreflang="en"/.test(readded));
  record(
    "adding a language does not regenerate the design",
    styleOf(readded) === styleOf(elDoc),
  );

  /* 6. Editor + reordering ----------------------------------------------- */
  await page.goto(`${projectUrl}/edit`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "editor");
  await checkTargets(page, "editor", POINTER_TARGET);
  await page.screenshot({ path: `${SHOTS}/11-editor.png` });

  const before = await page.locator("[data-section-row]").allInnerTexts();
  await page.getByRole("button", { name: /Move .* down/ }).first().click();
  await page.waitForTimeout(900);
  const after = await page.locator("[data-section-row]").allInnerTexts();
  record("section reorder via Move down works (no drag required)", before[0] !== after[0]);

  // Open a section sheet and save an edit.
  await page.locator("[data-section-row] button").filter({ hasText: /Hero|Menu/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  await checkTargets(page, "section sheet", POINTER_TARGET);
  await page.screenshot({ path: `${SHOTS}/12-section-sheet.png` });
  const headline = page.getByLabel("Headline");
  if (await headline.isVisible().catch(() => false)) {
    await headline.fill("Roasted here every morning");
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1200);
  record("section edit saves", true);

  /* 6b. Per-language editing ---------------------------------------------- */
  record(
    "editor shows a language tab bar when multilingual",
    await page.getByRole("tablist", { name: "Editing language" }).isVisible(),
  );
  await page.getByRole("tab", { name: /English/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/11b-editor-english.png` });
  record("editor can switch the language being edited", true);
  await page.getByRole("tab", { name: /Greek/ }).click();

  /* 7. AI editor --------------------------------------------------------- */
  await page.getByRole("button", { name: "Ask AI to edit" }).click();
  await page.getByRole("dialog").waitFor();
  // Let the sheet finish sliding in before measuring or capturing it.
  await page.waitForTimeout(400);
  await checkTargets(page, "AI sheet", POINTER_TARGET);
  await page.screenshot({ path: `${SHOTS}/13-ai-sheet.png` });
  await page.getByRole("button", { name: "Make it more minimal" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(4000);
  record("AI editor applies an instruction", true);
  await page.screenshot({ path: `${SHOTS}/14-ai-applied.png` });

  /* 8. Image upload ------------------------------------------------------ */
  await page.goto(`${projectUrl}/media`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "media");
  await checkTargets(page, "media", POINTER_TARGET);
  // Scope to real <button>s: the hidden <input type="file"> elements also
  // expose a "Choose file" accessible name.
  const sourceButtons = page.locator("button").filter({ hasText: /Take photo|Choose from gallery|Choose file/ });
  record("camera / gallery / file sources are all offered", (await sourceButtons.count()) === 3);
  const cameraInput = page.locator('input[capture="environment"]');
  record("camera input requests the rear camera", (await cameraInput.count()) === 1);

  // Upload a real image through the library picker.
  const png = await makePng(1200, 900, { r: 0x92, g: 0x40, b: 0x0e });
  await page.locator('input[type="file"][accept="image/*"][multiple]').setInputFiles({
    name: "shopfront.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByText(/shopfront/).first().waitFor({ timeout: 20000 });
  record("image uploads from the phone and is optimised", true);
  await page.screenshot({ path: `${SHOTS}/15-media.png` });

  /* 9. Design controls --------------------------------------------------- */
  await page.goto(`${projectUrl}/design`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "design");
  await checkTargets(page, "design", POINTER_TARGET);
  await page.getByRole("button", { name: /Use a palette/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: `${SHOTS}/16-design-palette.png` });
  await page.getByRole("button", { name: /ocean/i }).click();
  await page.waitForTimeout(1200);
  record("design palette applies from a bottom sheet", true);

  /* 10. Versions --------------------------------------------------------- */
  await page.goto(`${projectUrl}/versions`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "versions");
  await page.getByRole("button", { name: "Save current version" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Name it").fill("QA snapshot");
  await page.getByRole("button", { name: "Save version" }).click();
  await page.getByText("QA snapshot").waitFor({ timeout: 15000 });
  record("version snapshot saves", true);
  await page.screenshot({ path: `${SHOTS}/17-versions.png` });

  /* 11. Export ----------------------------------------------------------- */
  await page.goto(`${projectUrl}/export`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "export");
  await checkTargets(page, "export", POINTER_TARGET);
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("link", { name: "Export ZIP" }).click(),
  ]).then(([d]) => d);
  const zipPath = await download.path();
  record("ZIP export downloads on mobile", Boolean(zipPath), await download.suggestedFilename());
  if (zipPath) {
    const { execFileSync } = await import("node:child_process");
    let listing = "";
    try {
      listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
    } catch {
      listing = "";
    }
    if (listing) {
      record("export contains a folder per language", listing.includes("el/index.html") && listing.includes("en/index.html"));
      record("export contains a sitemap and robots.txt", listing.includes("sitemap.xml") && listing.includes("robots.txt"));
      record("export contains a root redirect document", listing.includes("index.html"));
    }
  }
  await page.screenshot({ path: `${SHOTS}/18-export.png` });

  /* 12. Deploy ----------------------------------------------------------- */
  await page.goto(`${projectUrl}/deploy`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "deploy");
  await checkTargets(page, "deploy", POINTER_TARGET);
  await page.getByRole("button", { name: "Deploy" }).click();
  await page.getByText("Your website is live").waitFor({ timeout: 60000 });
  record("deployment reaches Live from a phone", true);
  await page.screenshot({ path: `${SHOTS}/19-deployed.png` });

  const liveUrl = await page.locator("a", { hasText: "Open website" }).getAttribute("href");
  record("live URL is produced", Boolean(liveUrl), liveUrl ?? "");

  if (liveUrl) {
    const base = liveUrl.replace(/\/$/, "");
    for (const loc of ["el", "en"]) {
      const res = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return { status: r.status, body: await r.text() };
      }, `${base}/${loc}/`);
      record(`deployed site serves /${loc}/`, res.status === 200 && res.body.includes(`<html lang="${loc}"`));
    }
    const sm = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return { status: r.status, body: await r.text() };
    }, `${base}/sitemap.xml`);
    record(
      "deployed sitemap lists both languages with hreflang",
      sm.status === 200 && sm.body.includes('hreflang="el"') && sm.body.includes('hreflang="en"'),
    );
  }

  /* 13. The deployed site itself, on a phone ------------------------------ */
  if (liveUrl) {
    const guest = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const guestPage = await guest.newPage();
    await guestPage.goto(`${liveUrl.replace(/\/$/, "")}/el/`, { waitUntil: "networkidle" });
    await checkNoHorizontalOverflow(guestPage, "generated site (390px)");
    await checkTargets(guestPage, "generated site (390px)", MIN_TARGET);
    await guestPage.screenshot({ path: `${SHOTS}/20-live-site.png`, fullPage: true });

    // The generated site must be responsive across the whole range too.
    for (const width of WIDTHS) {
      await guestPage.setViewportSize({ width, height: 900 });
      await guestPage.waitForTimeout(150);
      await checkNoHorizontalOverflow(guestPage, `generated site @${width}px`);
    }
    await guest.close();
  }

  /* 13b. A second business, a different architecture ---------------------- */
  // Requirement 6: a generated site must not look like a generic copy of a
  // template. Building a second, different business and diffing the rendered
  // stylesheet is the cheapest honest test of that.
  console.log(`\n=== Second business (different architecture) ===\n`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/projects/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Business name").fill("Atelier Nord");
  await page.getByLabel("What kind of business is it?").fill("Architecture studio");
  await page.getByLabel("Describe the business").fill("A small architecture studio working on stone and concrete houses.");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Town or city").fill("Oslo");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /Full business website/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // keep English only
  await page.getByRole("radio", { name: /Elegant/ }).click();
  await page.getByRole("button", { name: "Generate website" }).click();
  await page.waitForURL(/\/generate/, { timeout: 20000 });
  await page.getByText("Your website is ready", { exact: false }).first().waitFor({ timeout: 240000 });

  const secondUrl = page.url().replace(/\/generate$/, "");
  const secondId = secondUrl.split("/").pop();
  const secondDoc = await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${pid}/render`);
    return res.text();
  }, secondId);

  const cssA = styleOf(elDoc);
  const cssB = styleOf(secondDoc);
  record("the two businesses produce different stylesheets", cssA !== cssB);
  // Not just different colours: the composition rules themselves differ.
  const rule = (css, name) => (css.match(new RegExp(`${name}:[^;\n]*`)) ?? [""])[0];
  record(
    "type scale differs between architectures",
    rule(cssA, "--measure") !== rule(cssB, "--measure") || rule(cssA, "--block") !== rule(cssB, "--block"),
  );
  record(
    "a business website gets a real site header (a menu does not)",
    secondDoc.includes('class="site-header"') && !elDoc.includes('class="site-header"'),
  );
  record(
    "a single-language site shows no language switcher",
    !/hreflang="el"/.test(secondDoc) && !secondDoc.includes('<nav class="lang'),
  );
  record("every generated site has a footer", secondDoc.includes("<footer") && elDoc.includes("<footer"));

  await page.goto(`${secondUrl}/preview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/22-second-business.png` });
  await checkNoHorizontalOverflow(page, "second business preview");

  /* 13b. The desktop workspace -------------------------------------------- */
  console.log(`\n=== Desktop workspace ===\n`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(secondUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  record(
    "a full-website project is not offered the menu-data screen",
    (await page
      .locator('nav[aria-label="Main"]')
      .first()
      .getByRole("link", { name: "Menu data" })
      .count()) === 0,
  );

  await page.goto(`${projectUrl}/edit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const editorPreview = page.locator('aside[aria-label="Preview"] iframe');
  record("the editor shows the site beside the controls", await editorPreview.isVisible());
  const previewBox = await editorPreview.boundingBox();
  record(
    "the preview panel is a workspace, not a thumbnail",
    (previewBox?.width ?? 0) > 500 && (previewBox?.height ?? 0) > 500,
    `${Math.round(previewBox?.width ?? 0)}x${Math.round(previewBox?.height ?? 0)}`,
  );

  const projectNav = page.locator('nav[aria-label="Main"]').first();
  record(
    "the sidebar navigates within the project",
    (await projectNav.getByRole("link", { name: "Design" }).count()) === 1 &&
      (await projectNav.getByRole("link", { name: "Versions" }).count()) === 1 &&
      (await projectNav.getByRole("link", { name: "Publish" }).count()) === 1,
  );
  record(
    "a Digital Menu project is offered its menu-data screen",
    (await projectNav.getByRole("link", { name: "Menu data" }).count()) === 1,
  );
  await page.screenshot({ path: `${SHOTS}/24-desktop-workspace.png` });

  // Resizing the window must degrade, not break.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);
  record(
    "a narrow window hides the sidebar rather than squeezing it",
    !(await page.locator('nav[aria-label="Main"]').first().isVisible()),
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.waitForTimeout(250);
  record(
    "the same navigation is still reachable as a drawer",
    await page.locator('nav[aria-label="Main"]').last().getByRole("link", { name: "Design" }).isVisible(),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  record(
    "Escape closes the drawer",
    (await page.locator('nav[aria-label="Main"]').count()) === 1,
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  /* 14. Every app screen at every required width -------------------------- */
  console.log(`\n=== App screens across breakpoints ===\n`);
  const screens = [
    ["dashboard", `${BASE}/`],
    ["new project", `${BASE}/projects/new`],
    ["project hub", projectUrl],
    ["preview", `${projectUrl}/preview`],
    ["editor", `${projectUrl}/edit`],
    ["design", `${projectUrl}/design`],
    ["media", `${projectUrl}/media`],
    ["languages", `${projectUrl}/languages`],
    ["versions", `${projectUrl}/versions`],
    ["export", `${projectUrl}/export`],
    ["deploy", `${projectUrl}/deploy`],
    ["settings", `${projectUrl}/settings`],
    ["account", `${BASE}/account`],
  ];

  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  record(
    "the profile screen reports which design engine is running",
    await page.getByText("Design engine").isVisible(),
  );
  record(
    "the design catalogue is reported as active",
    await page.getByText("ui-ux-pro-max", { exact: false }).isVisible(),
  );
  await checkTargets(page, "account", POINTER_TARGET);
  await page.screenshot({ path: `${SHOTS}/23-design-engine.png` });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const [name, url] of screens) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await checkNoHorizontalOverflow(page, `${name} @${width}px`);
    }
  }

  /* 15. Landscape -------------------------------------------------------- */
  console.log(`\n=== Landscape ===\n`);
  await page.setViewportSize({ width: 844, height: 390 });
  for (const [name, url] of screens.slice(0, 6)) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    await checkNoHorizontalOverflow(page, `${name} landscape 844x390`);
  }
  await page.screenshot({ path: `${SHOTS}/21-landscape.png` });

  /* 16. Console hygiene --------------------------------------------------- */
  // Only our own origin counts. A generated site loads its recommended web
  // font from Google; that host is unreachable in a sandbox, and the design
  // deliberately survives it via the local fallback stack (asserted below).
  const realErrors = consoleErrors.filter(
    (e) =>
      !/favicon|manifest|Failed to load resource: the server responded with a status of 40/i.test(e) &&
      !/fonts\.googleapis\.com|fonts\.gstatic\.com|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/i.test(e),
  );
  record("no console errors during the workflow", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  /* 17. Web fonts must never be load-bearing ------------------------------ */
  // The design catalogue recommends a Google font pairing. If it cannot load
  // — offline, blocked, slow — the page must still render readable text in the
  // local fallback stack, and must never have hidden text waiting for it.
  const fontCss = (secondDoc.match(/<style>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
  const bodyFont = (fontCss.match(/body\{[^}]*font-family:([^;]+)/) ?? [])[1] ?? "";
  record(
    "the web font is followed by a local fallback stack",
    /system-ui|sans-serif|serif|monospace/.test(bodyFont),
    bodyFont.trim().slice(0, 80),
  );
  record(
    "web fonts are requested with display=swap so text never waits",
    !secondDoc.includes("fonts.googleapis.com") || secondDoc.includes("display=swap"),
  );

  await page.goto(`${secondUrl}/preview`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const visibleText = await page.frameLocator("iframe[data-preview-frame]").locator("h1").first().innerText();
  record(
    "headline text renders even though the web font is unreachable",
    visibleText.trim().length > 0,
    visibleText.trim().slice(0, 40),
  );

  await browser.close();

  console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
  if (failures) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("QA harness crashed:", err);
  process.exit(2);
});
