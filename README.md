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

### Optional configuration

| Variable | Effect |
| --- | --- |
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

### Where the UI/UX layer lives

There is no "UI/UX Pro Max" skill installed in this environment, so its intent
is written down instead of assumed: the copy rules, hierarchy rules and touch
rules are codified in `server/content.ts` (`UX_RULES`) and applied on every
generation, and the compositional half lives in `lib/architectures.ts`. Both
are checked by the QA harness rather than left as aspiration. If you have that
skill available, point it at those two files — they are the seam it should
replace.

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
npm run test:mobile
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

It fails the run on any console error. Screenshots land in `qa-screenshots/`.
