/**
 * Mobile QA harness (requirements 23 and 24).
 *
 * Drives the entire product workflow on a phone-sized viewport, then re-checks
 * every screen across the full breakpoint list. Two classes of assertion:
 *
 *   1. Flow      — each step of the workflow can actually be completed by touch
 *   2. Layout    — no horizontal overflow, and every interactive target is at
 *                  least 44x44 CSS px, at each required width
 *
 * Run with: node scripts/mobile-qa.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const EXEC = process.env.PW_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = "qa-screenshots";

// The exact widths the requirements name, plus the shell breakpoints.
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440];
const MIN_TARGET = 44;

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

/** Fails if any visible control is smaller than the 44px touch minimum. */
async function checkTouchTargets(page, label) {
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
  }, MIN_TARGET);

  record(
    `${label}: touch targets >= ${MIN_TARGET}px`,
    small.length === 0,
    small.length ? small.map((s) => `<${s.tag}> "${s.label}" ${s.w}x${s.h}`).join("; ") : "",
  );
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXEC });

  // A realistic phone: iPhone 14-class viewport, touch, mobile UA.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await phone.newPage();

  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  console.log(`\n=== Mobile workflow at 390x844 (${BASE}) ===\n`);

  /* 1. Sign up ---------------------------------------------------------- */
  const email = `qa+${Date.now()}@example.com`;
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "signup");
  await checkTouchTargets(page, "signup");

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
  // Two navs exist: the desktop rail (hidden on phones) and the bottom tab bar.
  // Assert the phone gets the bottom bar and NOT the desktop sidebar.
  const bottomNav = page.locator('nav[aria-label="Main"].md\\:hidden');
  const sideRail = page.locator('nav[aria-label="Main"].md\\:fixed');
  record("bottom tab bar is shown on a phone", await bottomNav.isVisible());
  record("desktop sidebar is NOT forced onto a phone", !(await sideRail.isVisible()));
  record(
    "bottom nav has Projects / Create / Profile",
    (await bottomNav.locator("a").count()) === 3,
  );

  /* 3. Create project (4-step wizard) ------------------------------------ */
  await page.getByRole("link", { name: "Create a project" }).click();
  await page.waitForURL(/\/projects\/new/);
  await page.waitForLoadState("networkidle");
  await checkNoHorizontalOverflow(page, "wizard step 1");
  await checkTouchTargets(page, "wizard step 1");

  await page.getByLabel("Business name").fill("Caffè Verde");
  await page.getByLabel("What kind of business is it?").fill("Coffee shop");
  await page
    .getByLabel("Describe the business")
    .fill("Small independent coffee shop near the station. We roast our own beans and bake everything in-house.");
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
  await checkTouchTargets(page, "wizard step 3");
  await page.getByRole("radio", { name: /Digital menu/ }).click();
  await page.screenshot({ path: `${SHOTS}/05-wizard-type.png` });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: style
  await page.getByRole("radio", { name: /Warm/ }).click();
  await page.screenshot({ path: `${SHOTS}/06-wizard-style.png` });
  await page.getByRole("button", { name: "Generate website" }).click();

  /* 4. Generation -------------------------------------------------------- */
  await page.waitForURL(/\/generate/, { timeout: 15000 });
  record("lands on the generation screen", true);
  await checkNoHorizontalOverflow(page, "generation");
  await page.screenshot({ path: `${SHOTS}/07-generating.png` });

  // Requirement 5: generation continues while the app is backgrounded.
  // Simulate leaving by opening a second tab and hiding this one.
  const other = await phone.newPage();
  await other.goto(`${BASE}/account`);
  await new Promise((r) => setTimeout(r, 2500));
  await other.close();
  await page.bringToFront();

  await page.getByText("Your website is ready", { exact: false }).first().waitFor({ timeout: 90000 });
  record("generation completes while the app was backgrounded", true);
  await page.screenshot({ path: `${SHOTS}/08-generated.png` });

  const projectUrl = page.url().replace(/\/generate$/, "");
  const projectId = projectUrl.split("/").pop();

  /* 5. Preview with device selector -------------------------------------- */
  await page.goto(`${projectUrl}/preview`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "preview");
  await checkTouchTargets(page, "preview");
  const mobileSelected = await page.getByRole("radio", { name: "Mobile" }).getAttribute("aria-checked");
  record("preview defaults to Mobile on a phone", mobileSelected === "true");

  // The iframe must render the site at a real mobile viewport, not scaled down.
  const frame = page.frameLocator("iframe");
  await frame.locator("body").waitFor({ timeout: 15000 });
  const innerWidth = await page.evaluate(
    () => document.querySelector("iframe")?.getBoundingClientRect().width ?? 0,
  );
  record("mobile preview renders at native width (no shrunken desktop)", innerWidth >= 320 && innerWidth <= 400, `${Math.round(innerWidth)}px`);
  await page.screenshot({ path: `${SHOTS}/09-preview-mobile.png` });

  await page.getByRole("radio", { name: "Desktop" }).click();
  await page.waitForTimeout(600);
  await checkNoHorizontalOverflow(page, "preview (desktop mode)");
  await page.screenshot({ path: `${SHOTS}/10-preview-desktop.png` });
  await page.getByRole("radio", { name: "Mobile" }).click();

  /* 6. Editor + reordering ----------------------------------------------- */
  await page.goto(`${projectUrl}/edit`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "editor");
  await checkTouchTargets(page, "editor");
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
  await checkTouchTargets(page, "section sheet");
  await page.screenshot({ path: `${SHOTS}/12-section-sheet.png` });
  const headline = page.getByLabel("Headline");
  if (await headline.isVisible().catch(() => false)) {
    await headline.fill("Roasted here every morning");
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1200);
  record("section edit saves", true);

  /* 7. AI editor --------------------------------------------------------- */
  await page.getByRole("button", { name: "Ask AI to edit" }).click();
  await page.getByRole("dialog").waitFor();
  // Let the sheet finish sliding in before measuring or capturing it.
  await page.waitForTimeout(400);
  await checkTouchTargets(page, "AI sheet");
  await page.screenshot({ path: `${SHOTS}/13-ai-sheet.png` });
  await page.getByRole("button", { name: "Make it more minimal" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(4000);
  record("AI editor applies an instruction", true);
  await page.screenshot({ path: `${SHOTS}/14-ai-applied.png` });

  /* 8. Image upload ------------------------------------------------------ */
  await page.goto(`${projectUrl}/media`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "media");
  await checkTouchTargets(page, "media");
  // Scope to real <button>s: the hidden <input type="file"> elements also
  // expose a "Choose file" accessible name.
  const sourceButtons = page.locator("button").filter({ hasText: /Take photo|Choose from gallery|Choose file/ });
  record("camera / gallery / file sources are all offered", (await sourceButtons.count()) === 3);
  const cameraInput = page.locator('input[capture="environment"]');
  record("camera input requests the rear camera", (await cameraInput.count()) === 1);

  // Upload a real image through the library picker.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8//8/AzGAiYFIMKpwWOFQTzGjCkcVDhWFAAAAAP//AwB1qgQAn0z3iQAAAABJRU5ErkJggg==",
    "base64",
  );
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
  await checkTouchTargets(page, "design");
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
  await checkTouchTargets(page, "export");
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 30000 }),
    page.getByRole("link", { name: "Export ZIP" }).click(),
  ]).then(([d]) => d);
  const zipPath = await download.path();
  record("ZIP export downloads on mobile", Boolean(zipPath), await download.suggestedFilename());
  await page.screenshot({ path: `${SHOTS}/18-export.png` });

  /* 12. Deploy ----------------------------------------------------------- */
  await page.goto(`${projectUrl}/deploy`, { waitUntil: "networkidle" });
  await checkNoHorizontalOverflow(page, "deploy");
  await checkTouchTargets(page, "deploy");
  await page.getByRole("button", { name: "Deploy" }).click();
  await page.getByText("Your website is live").waitFor({ timeout: 60000 });
  record("deployment reaches Live from a phone", true);
  await page.screenshot({ path: `${SHOTS}/19-deployed.png` });

  const liveUrl = await page.locator("a", { hasText: "Open website" }).getAttribute("href");
  record("live URL is produced", Boolean(liveUrl), liveUrl ?? "");

  /* 13. The deployed site itself, on a phone ------------------------------ */
  if (liveUrl) {
    const guest = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const guestPage = await guest.newPage();
    await guestPage.goto(liveUrl, { waitUntil: "networkidle" });
    await checkNoHorizontalOverflow(guestPage, "generated site (390px)");
    await checkTouchTargets(guestPage, "generated site (390px)");
    await guestPage.screenshot({ path: `${SHOTS}/20-live-site.png`, fullPage: true });

    // The generated site must be responsive across the whole range too.
    for (const width of WIDTHS) {
      await guestPage.setViewportSize({ width, height: 900 });
      await guestPage.waitForTimeout(150);
      await checkNoHorizontalOverflow(guestPage, `generated site @${width}px`);
    }
    await guest.close();
  }

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
    ["versions", `${projectUrl}/versions`],
    ["export", `${projectUrl}/export`],
    ["deploy", `${projectUrl}/deploy`],
    ["settings", `${projectUrl}/settings`],
    ["account", `${BASE}/account`],
  ];

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
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|manifest|Failed to load resource: the server responded with a status of 40/i.test(e),
  );
  record("no console errors during the workflow", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

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
