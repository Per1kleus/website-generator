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
| `ANTHROPIC_API_KEY` | Enables business research (web search), visual identity analysis, content generation, translation and free-form AI editing. Without it the app still works end to end from the creator's own input, using a template generator and a rule-based editor. |
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
    research.ts       business research via web search, no-fabrication rules
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

`server/research.ts` researches the business with web search. Every field
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

### 3. The hosted model — optional, via API key

Research, visual identity analysis, copy and translation. When present it sees
the logo and the research and gets the final say on the palette; the
catalogue's recommendation is passed to it as a strong, explicit prior it must
justify departing from.

### What each tier buys you

| Running | Design comes from |
| --- | --- |
| Nothing | A creator-chosen preset |
| Catalogue | Real style/palette/typography for the business category |
| Catalogue + Ollama | The above, with a far better-matched category |
| All three | The above, reconciled against the actual business and its logo |

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
```

The harness drives the entire workflow on a 390×844 touch viewport — including
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

`test:menu` drives the whole Sheets flow against a stub Google, so no real
credentials are needed: connect → pick spreadsheet → pick tab → validate
columns → sync → render. Its fixture sheet deliberately contains a bad price,
an empty name, a junk checkbox, an unreachable image and blank padding rows, so
per-row validation is tested rather than assumed. It asserts that syncing never
changes the theme, that prices and images are byte-identical across languages,
that item ids are stable across re-syncs so translations survive, that the
public page contains no builder controls or Google references, and that a
failed sync leaves the last good menu serving.
