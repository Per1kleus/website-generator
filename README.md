# Website Generator

An AI platform that researches a real business and generates a custom website
or digital menu for it — designed to be used entirely from a phone.

    Business → Research → Understand → Analyse → Design → Generate
             → Localise → Validate → Deploy

The whole workflow is completable on a 320px screen without ever touching a
desktop: sign up, create a project, paste a Google Maps link, add a logo,
choose languages, generate, edit per language, AI-edit, upload photos, reorder
sections, save a version, export and deploy.

## Quick start

New to the application, or not a developer? Start with
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) — installing it, the
first-launch setup, building a first website, and building a digital menu from
a Google Sheet, in plain English.

To run it from source:

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

Development: `npm run dev`.

### First launch

```bash
npm run setup
```

`npm install` runs this automatically. It checks two optional things and never
fails the install:

- **the design catalogue** — vendored, needs only Python 3
- **Ollama** — if the daemon is running, the smallest capable model
  (`qwen2.5:0.5b`, ~400MB) is downloaded once

Neither is required. The server repeats the same check on first launch and
starts the download in the background, so a phone user is never waiting on it.

### Optional configuration

| Variable | Effect |
| --- | --- |
| `OLLAMA_HOST` | Where the Ollama daemon lives. Default `http://127.0.0.1:11434`. |
| `WG_OLLAMA_MODEL` | Which local model writes design queries. Default `qwen2.5:0.5b`. |
| `WG_OLLAMA_AUTOPULL` | Set to `0` to never download a model automatically. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Enables the Google Sheets menu source for Digital Menu projects. |
| `WG_SECRET` | Encrypts stored Google tokens at rest. **Set this** on any deployment that holds more than your own tokens. |
| `GEMINI_API_KEY` | Enables business research (grounded in Google Search), visual identity analysis, content generation, translation and free-form AI editing. Without it the app still works end to end from the creator's own input, using a template generator and a rule-based editor. |
| `WG_GEMINI_MODEL` | Which Gemini model those features use. Default `gemini-2.5-pro`. |
| `WG_DATA_DIR` | Where the SQLite database, uploads and published sites live. Defaults to `./data`. |
| `VERCEL_TOKEN` | Enables the Vercel deploy target. |
| `NETLIFY_AUTH_TOKEN` | Enables the Netlify deploy target. |

Built-in hosting needs no configuration: deploying publishes the site to
`/s/<slug>` immediately, which is what makes "deploy from a phone" real rather
than aspirational.

## How it is put together

```
src/
  lib/                shared by client and server
    site.ts           the Site document (schema v2) — the spine of everything
    locales.ts        supported languages, with LTR/RTL from day one
    architectures.ts  15 design architectures with real, distinct design rules
    render.ts         Site + locale -> one standalone HTML document
    migrate.ts        v1 -> v2 document upgrade, applied on read
    styles.ts         contrast-checked palettes and creator style presets
    contrast.ts       WCAG maths and palette repair, shared by lib and server
    maps.ts           Google Maps share-link parsing
  server/
    db.ts             SQLite schema, lazy connection, additive migrations
    auth.ts           scrypt passwords, httpOnly cookie sessions
    projects.ts       project / locale / version / asset data access
    research.ts       business research via Gemini + Google Search grounding
    identity.ts       visual identity analysis + architecture selection
    content.ts        copy generation and Site assembly
    translate.ts      add / remove / backfill a language
    generator.ts      the pipeline that runs those stages in order
    validate.ts       content, design, language, technical, a11y findings
    bundle.ts         the static file set: one document per language
    crypto.ts         AES-256-GCM for third-party tokens at rest
    google/           OAuth, Sheets and Drive clients (read-only scopes)
    menu/             processor, Drive image resolver, source state, sync
    uiux.ts           design-catalogue bridge: query building and mapping
    gemini.ts         the hosted model: one place for the model name and client
    ollama.ts         local model: detection, background install, JSON client
    ai-edit.ts        AI editing, locale-scoped, with structural guarantees
    deploy.ts         built-in publishing, plus Vercel / Netlify
    svg.ts            SVG logo sanitiser
  components/         mobile-first UI
  app/                routes
scripts/
  mobile-qa.mjs       the full-workflow mobile test harness
```

### The Site document

A generated website is JSON, never a blob of HTML — and v2 splits that JSON in
two on purpose:

```ts
{
  meta:     { businessName, kind, defaultLocale, locales, logo, stickyCta },
  theme:    { colors, fonts, layout, radius, architecture },
  sections: [ /* STRUCTURE only: ids, order, images, links, PRICES, tags */ ],
  i18n:     { el: { strings: {"sec_x.headline": "…"}, seo: {…} }, en: {…} },
}
```

Structure exists once and is shared by every language. All translatable text
lives in a flat per-locale catalog keyed by dotted paths.

That split is what makes the language requirements hold *by construction*
rather than by promise:

- switching language can only change strings, so the design and the structure
  cannot move
- adding a language adds a catalog and touches nothing else
- removing one deletes a catalog
- prices, phone numbers, addresses and URLs are structural, so they physically
  cannot be translated

Everything else falls out of the same decision: the editor lists `sections`;
reordering swaps array entries; the AI editor returns a patched document
validated field by field; versions are snapshots; and one renderer produces the
document used for preview, export and deployment alike.

Documents written before v2 are upgraded on read, so existing projects keep
opening with no data backfill.

### Design architectures

`lib/architectures.ts` defines 15 architectures — editorial, luxury, minimal,
mediterranean, industrial, organic, brutalist, architectural, classic, modern,
experimental, image-first, typography-first, menu-first, product-first.

Each is a full set of composition decisions, not a colour swap: navigation
shape, hero composition, type scale and tracking, line measure, image treatment
(including arched and circular crops), rule weight, section ornament, button
shape and fill, motion budget, and vertical rhythm. The renderer reads them; it
has no look of its own.

The generator picks one from the *business*, not from a dropdown: identity
analysis reads materials, light and atmosphere first, then chooses an
architecture and a palette that follow from them.

### Research, and never inventing anything

`server/research.ts` researches the business with Gemini, grounded in Google
Search and the pages it finds. Every field
carries a verification flag, and the model is instructed to leave a field empty
rather than guess. Prices, hours, reviews, awards and contact details are
treated as facts a customer could act on and be wrong about.

Downstream this is enforced, not just requested:

- copy generation only sees what research established, plus an explicit list of
  what it must not claim
- no researched hours means no hours section — never a plausible guess
- no researched prices means no prices
- an empty menu is left switched off and reported, rather than filled with
  invented dishes
- validation cross-checks the finished document against the research and warns
  where something unverified is being presented as fact

### Generation runs on the server

Tapping *Generate* starts a job in the Node process and returns immediately.
Progress is written to SQLite at every step. The progress screen polls the
backend and re-syncs on `visibilitychange`, so locking the phone, taking a
call, or force-quitting the app does not interrupt or restart anything.

### Without an API key

Every AI path has a real fallback, because a half-working app on a phone is
worse than a simpler one. No key means the template generator writes the site
from the owner's own inputs, and the AI editor still handles colours, style,
layout and section changes deterministically. Nothing silently pretends.

## The design engine

Three independent layers. The app reports which are actually running and works
with any subset.

### 1. The design catalogue — always on

[ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) is
vendored into `vendor/ui-ux-pro-max/` (MIT, see its `PROVENANCE.md`): 79 UI
styles, colour systems, font pairings, landing-page patterns, UX guidelines and
reasoning rules. It is committed rather than fetched so generation works
offline and the same business produces the same design twice.

`server/uiux.ts` queries it and maps the answer onto the site: palette,
Google-font pairing, landing pattern → section order, and the visual style →
one of this app's composition architectures.

### 2. The local model — optional, via Ollama

The catalogue is keyword-matched, so **the query is most of the quality**. The
same café asked badly:

    "greek coffee shop digital menu"  →  Digital Signage / Kiosk
                                         dark crypto palette, Orbitron

and asked well:

    "warm artisanal cafe"             →  Bakery / Cafe
                                         warm amber palette, Playfair Display

Turning business facts into the second query is a small, bounded, structured
task — which is exactly why the *smallest* capable model is the right choice
rather than a large one. `qwen2.5:0.5b` runs it in JSON mode at temperature 0,
so the same business always yields the same design.

Its output is validated hard: the query is stripped to 2–5 design words, the
business name and town are removed (they poison a keyword match), motion is
capped for menus, and anything unusable falls back to a built-in rule set that
maps ~15 business categories and ~8 moods. **A bad query is worse than the
deterministic one.**

### 3. The hosted model — optional, via a Gemini API key

Research, visual identity analysis, copy and translation, on Gemini. When
present it sees the logo and the research and gets the final say on the palette; the
catalogue's recommendation is passed to it as a strong, explicit prior it must
justify departing from.

### 4. The design systems — always on

The catalogue chooses a direction; these four decide how the page is actually
built. Three of them are deterministic — no model, no network, microseconds —
and one asks for a second opinion only when the other three are unhappy.

**The content-aware layout engine** (`server/layout.ts`) reads what the
document really contains — how many services, how many photographs, whether
there are reviews, how much there is to read — and composes each section from
that. Nine services become a numbered index; two become a statement, not a
grid of two; one review is a quote, not a grid of one. A section with nothing
in it is switched off, never filled: the research rules say never invent a
fact, and inventing three services so a grid looks right is the same mistake.

**The design token engine** (`lib/tokens.ts`) turns the chosen architecture,
the catalogue's style and the business's own character into one coherent
visual language: type scale and weight, tracking, measure, spacing, container
width, radius per role, borders, shadows, image treatment, density, motion. A
luxury hotel comes out with no cards, no shadow, square corners and the airiest
rhythm; a gym with 750-weight headings, rounded raised cards and expressive
motion; a law firm dense, banded and quiet. Same inputs, same design, every
time — the variation is intentional, not random.

**The human design heuristics** (`lib/heuristics.ts`) check the finished
document against the patterns that make a page look generated: three sections
built from the same card grid, everything rounded, everything animating,
boilerplate calls to action, spacing that never varies, sections with nothing
in them. Each one asks whether the choice is intentional *for this business*
rather than whether the technique is allowed — generous whitespace passes for a
spare luxury hotel and is questioned on a page dense with information; the same
expressive motion passes for a gym and is questioned for a law firm.

**The design critic** (`server/critic.ts`) is the only part that uses Gemini.
It runs once, only when the heuristics score the page below the threshold, and
it cannot write the site: it answers with corrections chosen from a fixed list
of eleven, each applied here in code. A page that already reads as designed
costs nothing — no request is made at all.

### 5. Images, SEO and visual QA — always on

Three more deterministic systems, running after the page is composed. None of
them adds a model call.

**Image intelligence** (`server/images.ts`) decides which photograph belongs
where, how it is cropped and what the page reserves for it. Every picture is
measured — dimensions, aspect, resolution, and where the detail actually sits
in the frame, which sharp can tell us from the image's own statistics — and
that focal point becomes the `object-position` that keeps a subject in frame
when a wide photograph is cropped to a phone-shaped band. The focal point is
computed once, at upload, so generating never decodes a photograph twice. Only
a photograph large and wide enough to survive a full-bleed crop can lead a
page; a portrait one moves into the gallery and the hero becomes typographic.
No photographs means no photograph-shaped sections: the gallery is switched
off rather than filled, because a grey box is worse than a page designed for
type.

**The SEO engine** (`lib/seo.ts`) builds the title, description, keywords, alt
text and schema.org data from what the research actually verified and from copy
the page already contains. It is keyed on `verifiedFields`: a location nobody
confirmed does not reach the title, opening hours nobody confirmed are not
marked up, and ratings and reviews are never published at all — they are the
properties most worth faking and the ones a search engine penalises hardest
when they turn out to be false. The verified facts travel on the document
(`site.meta.facts`), so a page published today still describes the business
honestly a year later. Anything the creator wrote themselves is left alone.

**Visual QA** (`lib/visual-qa.ts`) checks the page at 1440, 834, 390 and 320px
and reports a verdict per width, a verdict per category and a score, with every
issue naming where it is and what to do. It runs with no browser, because the
packaged Windows application has no browser automation in it and QA that only
works on a developer's machine is not QA. Instead it evaluates the CSS this
codebase itself emits: `clamp()` heading sizes at a given viewport, container
widths against gutters, aspect ratios against real pixel dimensions, and the
width of the longest unbreakable word given the heading's case and tracking.
`npm run test:site` proves that arithmetic against Chromium at all four widths;
the predictions match the engine to within a pixel.

**Targeted safe corrections** (`lib/qa-fix.ts`) fix what can be fixed by
changing a design decision — a heading scale, a measure, a spacing step, a
crop, whether an empty section renders — and never a word of the business's own
content. A headline that does not fit is a type problem before it is a copy
problem. The loop is bounded at two passes, and a pass that lowers the score is
thrown away rather than shipped. Everything else, including placeholder copy
and dead links, is reported to the creator with the specific thing to do.

### What each tier buys you

| Running | Design comes from |
| --- | --- |
| Nothing | A creator-chosen preset |
| Catalogue | Real style/palette/typography for the business category |
| Catalogue + Ollama | The above, with a far better-matched category |
| All three | The above, reconciled against the actual business and its logo |

### Seeing the result

The generated website is shown inside the application, never in a file the
creator has to go and find. The moment generation finishes, the progress screen
becomes a live preview of the site; the same preview sits on the project screen
and beside the section list in the editor.

It is the real thing: the preview frame loads `/api/projects/<id>/render`,
which calls the same `renderSite()` that produces the exported ZIP and the
published site. Choosing Mobile makes the frame genuinely 390px wide, so the
website's own media queries decide what changes — the four widths on offer are
the same four `lib/visual-qa.ts` audits, so a creator can look at the width a
warning came from. The generated page runs sandboxed in an origin of its own
and cannot reach this application's cookies, DOM or API. `docs/PREVIEW.md` has
the details, including the two URL differences between preview and published
output and how they are tested.

### Contrast is guaranteed, not assumed

A palette can arrive from a hosted model, the catalogue, or a colour picker,
and none can be trusted. `lib/contrast.ts` repairs every palette at the point
of use: body text to 7:1, primary to 4.5:1, accent to 3:1, and a button's label
is computed against *the button*, not the page. Where a dark catalogue row puts
its real call-to-action in `accent`, the two are swapped rather than
desaturating a primary that was never meant to be a button.

### Refreshing the catalogue

```bash
npm run refresh:skill && npm run test:mobile
```

A catalogue change can legitimately move the recommended palette or typography,
so the suites are re-run afterwards.

## Digital menus from Google Sheets

For a Digital Menu project the spreadsheet is the source of truth for menu
content. The restaurant edits a Google Sheet; the builder syncs; the public
menu updates. Nobody edits the generated website by hand.

```
Google Sheets ──▶ Sheets API ──▶ Menu Data Processor ──▶ validated data
                                                              │
Google Drive ───▶ image resolver ──▶ local optimised assets ──┤
                                                              ▼
                                                    the Site document
                                                              │
                                                              ▼
                                              static Digital Menu ──▶ customer
```

### The sheet's contract

Row 1 must contain exactly these headers, and every row below is one item:

```
name | price | description | chefs choice | category | imageurl
```

- **`chefs choice`** is a checkbox. Ticked items get a Chef's Choice badge;
  `TRUE`/`FALSE` is never shown to a customer.
- **`category`** groups the menu and is best set as a dropdown. Categories are
  read from the sheet, never hardcoded, and only ones with items are rendered.
- **`imageurl`** takes a Google Drive link, in any of the shapes people
  actually paste — `/file/d/…`, `?id=…`, `/thumbnail?id=…`, or a bare file id.

### Images are fetched, not hot-linked

A Drive sharing URL cannot be used as an `<img src>`: those endpoints redirect
through an interstitial, need the viewer's own Google session, and are rate
limited. So each image is downloaded once server-side with the creator's
credentials, run through the same pipeline as an uploaded photo (EXIF stripped,
resized, WebP), and served from the site. The customer's browser never touches
Google.

### One bad row never breaks the menu

Every row is validated independently. An invalid row is dropped from the menu
and reported to the builder by **row number and column** — "Row 6 · price:
'ask the chef' is not a valid price" — while every valid row keeps working. A
missing required column is refused outright rather than silently half-imported.

### Where the boundary sits

The builder holds all of it: the OAuth connection, the spreadsheet picker,
validation output and Sync Now. The generated menu holds none of it — no sync
controls, no spreadsheet references, no admin surface. A customer cannot tell
that Google Sheets is involved, which is the point.

Tokens are encrypted at rest, live only in server modules, and never reach a
response body or generated page. Only `spreadsheets.readonly` and
`drive.readonly` are requested; nothing is ever written to the creator's Drive.

### Sync and caching

The public menu is static HTML, so it makes **no Google request per visitor**.
Sync writes into the Site document and, when the project is already live on
built-in hosting, rewrites the published files. Menu content changes; the
design does not — the same theme is re-rendered.

Each sync snapshots the previous version first, so a bad spreadsheet edit is
undoable. If Google cannot be reached, the error is shown in the builder and
**the last good menu keeps serving** — nothing is invented to fill the gap.

### Languages

The sheet stays single-language. Item names, descriptions and category labels
flow into the existing string catalog and are translated by the existing
system; prices, images and chef's-choice status are structural and live outside
the catalog, so a translation pass physically cannot alter them. No duplicate
spreadsheet per language.

## The Windows application

The builder is a Windows desktop application: an installer, a Start Menu entry,
its own window and its own process. No browser, no terminal, no localhost, and
nothing for the user to install first — not Node, not Python, not Ollama.

**First launch** sets the machine up once, behind a native setup screen: it
inspects the computer (Windows version, CPU, RAM, GPU, VRAM, CUDA, free disk),
installs UI/UX Pro Max with its own CLI, prepares Ollama if it is missing,
recommends the smallest local model this machine runs comfortably, downloads it
after the user agrees — with real byte counts — and verifies that it answers.
Only then is the installation marked complete.

**Every launch after that** is a double-click and a window: 1.1 seconds to the
application, no downloads, no probing, no browser.

An interrupted download resumes. A failed step explains itself and offers a
retry, or continuing without the optional part. An application update never
re-downloads a model that is already there.

Full detail — the setup flow, the model ladder, what is and is not installed,
and the limitations — is in [docs/DESKTOP.md](docs/DESKTOP.md). For using the
application rather than building it, see
[docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

**Android** — an `.apk`. A phone cannot run a Node server with native modules
and a Python subprocess, so the Android app is a client to a deployment rather
than a second implementation: the same interface, over the network. It asks for
the backend address once, or the build bakes it in.

```bash
npm run build:windows                                      # → NSIS installer
WG_REMOTE_URL=https://example.com npm run build:android     # → APK
npm run test:desktop                                        # 36 packaging checks
npm run test:setup                                          # 40 first-launch checks
```

Neither artifact contains a secret. The desktop app uses a Google **Desktop
app** OAuth client — loopback redirect, PKCE, no client secret to ship — and a
user's own API keys are typed into the app's Profile screen and kept encrypted
in their Windows profile, never in the installer. `npm run test:desktop`
asserts that, along with the sidecar lifecycle and the OAuth flow, without
needing a Windows machine.

Full details — Google Cloud setup, build prerequisites, every new environment
variable, and the limitations — are in [docs/PACKAGING.md](docs/PACKAGING.md).

## Multi-language

Two separate layers, as the requirements draw them:

**Creator side** — *Languages* configures the default language and which others
are enabled, before or after generation. Adding one translates the existing
catalog; the design, layout and structure are provably untouched because
translation only ever writes strings. Removing one deletes only its catalog.
The default cannot be removed.

**Visitor side** — the generated website carries its own switcher whenever two
or more languages are enabled, and none at all when there is one. It adapts to
the architecture: an inline `EN / GR` in the header for most sites, a
full-width flag banner pinned above a digital menu, and always a copy in the
footer.

Each language is a **separately rendered document**, not a JavaScript text
swap, so each carries its own `lang`, `dir`, `<title>`, description, Open Graph
and Twitter metadata, canonical URL, `hreflang` set (including `x-default`) and
JSON-LD. Exports and deployments lay them out as `/el/`, `/en/` with a root
redirect, a cross-linked `sitemap.xml` and `robots.txt`. A returning visitor's
choice is remembered, and acted on only by the root document so every language
URL stays stable and crawlable.

Translation preserves the business name, prices, numbers and addresses, and is
told to respect the length budget of a phone layout.

## Mobile design rules

These are enforced by the QA harness, not just intended:

- **Touch targets** — every interactive element is at least 44×44 CSS px.
- **No horizontal overflow** at 320, 375, 390, 430, 768, 1024, 1280 and 1440px,
  in portrait and landscape.
- **Safe areas** — `viewport-fit=cover` plus `env(safe-area-inset-*)` on every
  fixed element, so nothing sits under a notch, Dynamic Island, camera cutout
  or home indicator.
- **Navigation** — phones get a bottom tab bar; the desktop sidebar is never
  forced onto a small screen.
- **Zoom is never blocked** — no `maximum-scale=1`; inputs are ≥16px so iOS
  does not zoom on focus.
- **Reduced motion and high contrast** are honoured, in the app *and* in every
  generated website.
- **Bottom sheets** are the disclosure pattern: focus-trapped, Escape-closable,
  scroll-locked, dismissible by tapping the scrim.
- **Reordering never requires drag** — press-and-hold drag works via Pointer
  Events, and Move up / Move down are equal first-class paths.

## Generated websites

Generated sites are mobile-first in their own right, not scaled-down desktop
layouts:

- one fluid column on phones; multiple columns only where there is room
- `clamp()` typography that scales with the viewport
- 44px+ touch targets, sticky header, sticky mobile call-to-action
- lazy-loaded, aspect-ratio-boxed images so slow connections do not cause
  layout shift
- a phone navigation menu that needs no JavaScript at all
- **digital menus are deliberately stripped**: no hero, no nav, no sticky bar,
  no animation — a guest who scanned a QR code gets category chips and prices,
  and nothing between them and the food

## Mobile QA

```bash
npm start &
npm run test:mobile     # 207 checks: the whole product on a phone
npm run test:design     # 21 checks: the design engine across all its tiers
npm run test:menu       # 47 checks: the Google Sheets menu pipeline
npm run test:desktop    # 36 checks: the packaged desktop app
npm run test:setup      # 40 checks: first launch, second launch, recovery
npm run test:gemini     # 49 checks: the hosted model, its contracts and failures
npm run test:design-systems  # 59 checks: layout, tokens, heuristics, critic
npm run test:site       # 198 checks: visual QA, SEO and image intelligence
npm run test:preview    # 60 checks: the integrated live preview
```

`test:preview` generates a real website and then holds the preview to its one
promise — that it *is* the website. It runs the publisher (`buildBundle`) over
the same document and compares the result byte for byte with what the preview
served, so a second rendering path cannot be introduced without the suite
failing. It also measures what the framed document reports as its own viewport
width at each device button, tries from inside the generated page to read the
session, call a builder endpoint and reach the builder's DOM (each must fail),
and checks that a failed render surfaces "Preview unavailable" with a retry
rather than a blank panel. See `docs/PREVIEW.md`.

`test:site` is the one suite that puts the deterministic systems in front of a
real engine. It renders pages, opens them in Chromium at 1440, 834, 390 and
320px, and compares what visual QA predicted — heading size, usable width, the
width of the longest word — against what the browser actually computed. It
feeds the SEO engine research that verified almost nothing and checks that the
metadata stays silent rather than plausible, and it generates real image files
whose focal point is known by construction. It finishes by taking six
businesses (restaurant, hotel, law firm, accounting office, car detailing, gym)
through composition, images, SEO, QA and correction, and checking each rendered
page in the browser at all four widths.

`test:gemini` drives the five hosted-AI features — research, visual identity,
copy, translation and free-form editing — against a stub Gemini, so the client
code runs for real without a key. It asserts the contracts the rest of the
application depends on: the site document still validates, translation changes
strings and nothing else, an edit reaches the document, requests carry the key
as a header and never in a URL, research asks for Google Search grounding, and
a rejected key, a rate limit, a refusal, a missing model or a reply that is not
JSON each degrade to the same fallback the application always had.

`test:setup` drives the real first-launch bootstrap the way the Windows shell
does — spawning it, reading its progress, answering its questions — against a
stub model host. It covers a first launch, an immediate second launch, a forced
re-run that reinstalls nothing, a download killed partway and resumed, a step
that fails and is retried or skipped, and a corrupted state file. It asserts
that progress is real byte counts, that nothing is downloaded before the user
chooses, that setup is never marked complete on the strength of a download
alone, and that the state file holds no secrets.

The harness drives the entire builder workflow at 1440×900 — including
the logo upload, a two-language project, per-language editing, adding and
removing a language after generation, export and deployment — then re-checks
every screen and the generated website across all eight required breakpoints
plus landscape.

Beyond layout it asserts the properties the requirements actually turn on:

- each language declares its own `lang` and cross-links the others with
  `hreflang`
- switching language produces a **byte-identical stylesheet and section list**
  but different content
- prices are byte-identical across languages
- removing a language hides the switcher and leaves the design unchanged
- adding one back does not regenerate the design
- two different businesses produce **different stylesheets and different
  composition rules**, not one template recoloured
- a digital menu gets no site header; a business website does
- a single-language site shows no switcher at all
- every generated site has a footer
- the deployed site really serves `/el/` and `/en/`, with a sitemap listing both

It fails the run on any same-origin console error. Screenshots land in
`qa-screenshots/`.

`test:design` covers the design engine across all four states, using a stub
Ollama daemon so no real one is needed:

- catalogue only — a site is still generated, with a catalogue palette and font
  pairing rather than the generic preset
- Ollama present but the model missing — first launch detects it and installs
  in the background, with progress
- Ollama + model — the local model writes the query, and two different
  businesses come out genuinely different
- Ollama disappears — generation still succeeds and the status stops claiming
  it is there

It also asserts the properties that keep web fonts from becoming load-bearing:
`display=swap`, a local fallback stack behind every web family, and no font
requests at all from a digital menu.

`test:desktop` covers packaging without needing Windows: it boots the real
sidecar the way the shell does, then asserts the properties that make a
downloadable build safe — the server binds loopback only, the consent URL
carries a PKCE S256 challenge and no client secret, the callback renders a page
instead of navigating the app, stored tokens never reach a response, a key
saved from inside the app is encrypted on disk and never echoed back, a
variable outside the settings allowlist is ignored, a Google outage produces a
message rather than a stack trace, and closing the shell's stdin stops the
bundled server with no orphan left behind. It also renders a real page and its
stylesheet through the packaged server rather than only calling API routes —
which is how the one bug that would have broken every installed copy was found:
Next stages its native-module externals as symlinks, and symlinks do not
survive being bundled into an installer.

`test:menu` drives the whole Sheets flow against a stub Google, so no real
credentials are needed: connect → pick spreadsheet → pick tab → validate
columns → sync → render. Its fixture sheet deliberately contains a bad price,
an empty name, a junk checkbox, an unreachable image and blank padding rows, so
per-row validation is tested rather than assumed. It asserts that syncing never
changes the theme, that prices and images are byte-identical across languages,
that item ids are stable across re-syncs so translations survive, that the
public page contains no builder controls or Google references, and that a
failed sync leaves the last good menu serving.
