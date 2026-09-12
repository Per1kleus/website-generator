# Client readiness and performance

Two scores, both out of 100, both this application's own. Neither is a
Lighthouse result and neither claims to be — every screen that shows them says
so. What they are is deterministic: the same document scores the same number
every time, computed from properties the application can actually see, with
every point taken off attached to a finding that says what and why.

## Why there are two scores

Visual QA (`lib/visual-qa.ts`) answers *does this page hold together*. It is
the layout engine's own conscience and it stays that.

Readiness (`lib/checklist.ts`) answers the different question that decides
whether a job is finished: *can I send this to the client?* A page can hold
together perfectly and still be unsendable — a phone number nobody filled in,
a button pointing at `#`, a headline still reading "Welcome to our website".

## The 100 points

| Category | Points | What it reads |
| --- | ---: | --- |
| Rendering & functionality | 25 | The rendered document, section visibility, every link's destination |
| Mobile & responsive | 20 | Visual QA's verdict at 1440 / 834 / 390 / 320 |
| SEO | 15 | `lib/seo.ts` — the same audit, nothing re-implemented |
| Content integrity | 15 | Placeholder copy, broken characters, contact details, translations |
| Images | 10 | `site.images`, the assets table, visual QA's image findings |
| Accessibility | 10 | Contrast, headings, touch targets, alt text |
| Performance | 5 | `lib/performance.ts`, scaled from its own 100 |

The score is the sum of the categories; each category is its weight minus the
cost of everything found in it, floored at zero. Nothing is averaged: a
subsystem's own score is never divided into this one, because an average lets
a strong category quietly pay for a broken one.

## Severity, and the rule that matters

- **Critical** — do not publish. A site that fails to render, a navigation a
  visitor cannot use, no way at all to contact the business, placeholder copy
  still on the page, a link that goes nowhere, a language promised and never
  translated, body text below 4.5:1.
- **Warning** — publishable, worth a look. A long meta description, an image
  larger than it needs to be, a tap target under 44px, an implausible phone
  number.
- **Info** — nothing to do. The one that matters here: a business that
  supplied no photographs. That is a legitimate outcome, not a fault, and it
  costs nothing.

**A critical failure overrides the number.** A site scoring 96 with no contact
details is `NOT READY`, and the reason is printed under the score. This is the
property that makes the number worth trusting — a high score can never hide a
broken site.

Otherwise: 95+ `READY`, 85+ `READY WITH WARNINGS`, 70+ `NEEDS REVIEW`, below
that `NOT READY`.

## What it never does

It never edits the site. Safe corrections belong to `lib/qa-fix.ts`, which
changes design decisions — a heading scale, a spacing step — and never a word
of the business's own content. A checklist that rewrote copy in order to score
itself higher would be worthless, so placeholder text is reported and left
exactly where it is.

When a correction *has* run, the checklist assesses the corrected document:
the project screen renders the site as it currently stands and scores that.

## Performance

`lib/performance.ts` measures six things, all of them properties of what is
about to be shipped:

| Category | Points | Measured from |
| --- | ---: | --- |
| Image optimisation | 30 | Per-image bytes against a per-role budget, oversized sources, priority and lazy hints |
| Asset weight | 20 | Document and image bytes against a page budget |
| Critical resource loading | 15 | Hero preload, render-blocking stylesheets, external scripts |
| Layout stability | 20 | Width/height on every image, aspect ratios, `display=swap` |
| Font efficiency | 10 | Weights requested against weights the tokens set, request count, preconnect |
| Generated-code efficiency | 5 | Stylesheet and script size |

A category that does not apply — image optimisation on a site with no
photographs — is removed from the denominator rather than given away, so the
score is out of the points that site could actually earn.

### The two optimisations in the renderer

Measuring is not enough on its own, so `lib/render.ts` does two things the
measurements then confirm:

- **The hero is preloaded.** It is an `<img>` deep in the body behind the
  stylesheet, and it is almost always the largest contentful paint. One
  `<link rel="preload" as="image">` starts it in parallel with the CSS. Only
  ever the hero — preloading more would make them compete.
- **Only the font weights the design uses are requested.** The catalogue hands
  over a family URL carrying every weight the family offers, one font file
  each. The token engine names two. The rest are dropped from the URL, and
  only from the standard `wght@a;b;c` form: an unfamiliar shape, or a result
  that would be empty, is left exactly as it was found. Removing a weight the
  design uses would be worse than shipping one it does not.

Everything else was already right and is left alone: images are capped at
2000px WebP at upload, width and height are emitted from the recorded
dimensions, below-fold images are lazy, the font sheet is non-blocking with
`display=swap`, and the stylesheet is inline so there is nothing to block the
first paint.

## Project state

`lib/project-status.ts` derives one of seven states from the stored status,
the readiness report and the deployment record. Derived, not stored, so it
cannot go stale: a project that was ready yesterday and lost its phone number
this morning says so the next time anybody looks.

The rule worth knowing: a **published** site with a critical failure reads as
**Needs attention**, not as published. A live site that broke is the most
urgent case there is, not the calmest.
