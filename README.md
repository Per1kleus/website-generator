# Website Generator

A mobile-first platform for generating, editing and deploying a business
website or digital menu — designed to be used entirely from a phone.

The whole workflow (sign up → create a project → paste a Google Maps link →
generate → edit → AI edit → upload photos → reorder sections → save a version
→ export → deploy) is completable on a 320px screen without ever touching a
desktop.

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
| `ANTHROPIC_API_KEY` | Enables AI content generation and free-form AI editing. Without it the app still works end to end using a deterministic template generator and a rule-based editor. |
| `WG_DATA_DIR` | Where the SQLite database, uploads and published sites live. Defaults to `./data`. |
| `VERCEL_TOKEN` | Enables the Vercel deploy target. |
| `NETLIFY_AUTH_TOKEN` | Enables the Netlify deploy target. |

Built-in hosting needs no configuration: deploying publishes the site to
`/s/<slug>` immediately, which is what makes "deploy from a phone" real rather
than aspirational.

## How it is put together

```
src/
  lib/            code shared by client and server
    site.ts       the Site document model — the spine of the whole app
    render.ts     Site -> standalone mobile-first HTML
    styles.ts     curated, contrast-checked palettes and style presets
    maps.ts       Google Maps share-link parsing
  server/         server-only modules
    db.ts         SQLite schema and lazily-opened connection
    auth.ts       scrypt passwords, httpOnly cookie sessions
    projects.ts   project / version / asset data access
    jobs.ts       background generation runner + mobile QA checks
    generator.ts  Claude-powered content generation, template fallback
    ai-edit.ts    AI editing with validation and a deterministic fallback
    deploy.ts     built-in publishing, plus Vercel / Netlify
  components/     mobile-first UI
  app/            routes
scripts/
  mobile-qa.mjs   the full-workflow mobile test harness
```

### The Site document

A generated website is JSON, never a blob of HTML:

```ts
{ meta: {...}, theme: { colors, fonts, layout, radius }, sections: [...] }
```

Everything downstream falls out of that one decision. The editor lists
`sections`; reordering swaps array entries; the AI editor returns a patched
document that is validated field by field before it is stored; versions are
snapshots of it; and the renderer turns it into a self-contained site for
preview, export and deployment. Editing a website from a phone is only
tractable because there is no HTML to edit.

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

The harness drives the entire workflow on a 390×844 touch viewport, then
re-checks every screen — and the generated website — across all eight required
breakpoints plus landscape. It asserts touch-target sizes and horizontal
overflow at each one, and fails the run on any console error. Screenshots land
in `qa-screenshots/`.
