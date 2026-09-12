# The live preview

The application shows the generated website inside itself. This note records
how, because the property that makes it worth anything — that the preview and
the published site are the same artefact — is easy to lose by accident.

## One renderer

```
                        site document
                              │
                      lib/render.ts  renderSite()
                              │
              ┌───────────────┴───────────────┐
              │                               │
  /api/projects/<id>/render          server/bundle.ts
       (live preview)                  │           │
                                  ZIP export   /s/<slug>
                                               (published)
```

`renderSite()` is the only thing that turns a site document into HTML. The
preview endpoint calls it; `buildBundle()` calls it for the export and for the
publish directory. There is no preview renderer, no preview model, and no
simplified preview mode — the preview is the website, served from the same
function with the same tokens, the same layout decisions, the same images and
the same metadata.

`scripts/preview-qa.mjs` holds that to account: it runs `buildBundle()` over
the document the application is holding and compares it byte for byte with what
the preview endpoint served. If a second rendering path is ever introduced,
that check fails.

### The two differences, and why they exist

Only URLs differ, because the two are served from different places:

| | Preview | Published |
| --- | --- | --- |
| Images | `/api/assets/<id>?pt=…` | `../images/<id>.webp` |
| Other languages | `/api/projects/<id>/render?locale=…` | `../en/`, `./` |

Everything else — every tag, attribute, byte of CSS, word of copy — is
identical, and the test normalises exactly these two and nothing else.

## Where the preview appears

One component, `components/SitePreview.tsx`, used in four places:

- **the generation screen**, which becomes the preview the moment the job
  finishes — no click, no navigation, no hunting for a file;
- **the project hub**, so arriving at a project shows the website;
- **the editor's right-hand panel**, which reloads after every save;
- **the full-screen preview**, for when the site deserves the whole window.

## Device widths

The frame is really the width the button says. Choosing Mobile sets the iframe
to 390 CSS pixels, so the website's own media queries fire exactly as they will
on a phone — its hamburger appears because *its* breakpoint said so, not
because the builder swapped in a mobile rendering.

Scaling only ever fits a wide frame into a narrow panel: a 1440px frame in a
1100px space is drawn at 76%, still believing it is 1440 wide, so what is on
screen is the real desktop layout at a smaller size. The percentage is stated
under the frame whenever it is not 100%. A frame narrower than the space it has
is never enlarged.

The four presets are `lib/viewports.ts` — the same list `lib/visual-qa.ts`
audits, so the width a QA warning came from is a button away. Automated QA
still does the checking; the preview is for looking.

## Isolation

The generated website runs in a frame sandboxed **without** `allow-same-origin`,
so it has an opaque origin of its own. From inside it:

- `fetch('/api/…')` is refused — `connect-src 'none'` in the response CSP;
- `parent.document` throws — different origin;
- the session cookie is neither readable nor sent;
- `localStorage` belongs to nobody (the renderer's use of it is already
  wrapped in `try/catch`, so the language switcher degrades quietly);
- forms cannot be submitted anywhere — `form-action 'none'`;
- nothing may frame it but this application — `frame-ancestors 'self'`.

That isolation costs the frame its cookies, which is a problem for the two
things a generated page legitimately needs from the server: its own
photographs, and the next page when someone uses the language switcher. Those
are authorised instead by a **preview token** (`server/preview-token.ts`): an
HMAC naming one project, valid for two hours, accepted only by the render and
asset endpoints, and useless for writing anything or for reading any other
project. `scripts/preview-qa.mjs` asserts each of those.

Web fonts are the one outbound request allowed, to Google Fonts, because that
is what the generated site does in production too.

## Refreshing

Saving in the editor calls `refresh()` on the preview, which reloads the
frame's document in place. The application itself does not reload, the section
list does not re-render, and nothing is regenerated: a save writes the document
and the frame asks for it again. No AI call is involved in a preview, ever.

When the editor has unsaved changes it says so above the frame, because a page
that looks right while the newest edit is missing is worse than no preview.

## Failure

If a render fails, the endpoint returns a small HTML page that reports the
problem to the builder, which shows **Preview unavailable**, the reason, and a
**Retry preview** button, inside the preview area. The rest of the application
keeps working. Nothing silently shows an old version.

## Known limitations

- A `target="_blank"` link inside the preview opens a window that is still
  sandboxed, so an external site (a map, a booking page) may not run correctly
  there. On the published site those links are ordinary links and work
  normally. Use *Open in a new tab* to follow one for real.
- The preview always shows the **saved** document. Unsaved editor changes are
  not in it, and the preview says so rather than implying otherwise.
- Scaling is a visual fit, so text in a scaled desktop frame is drawn smaller
  than it will be on a real desktop. The reported percentage says by how much;
  a 1:1 reading needs a window at least as wide as the chosen preset.
- `form-action 'none'` costs nothing today because the renderer emits no forms
  at all — contact details are `tel:` and `mailto:` links. If a generated site
  ever gains a real form, that directive has to be widened to the endpoint it
  posts to, or the form will render correctly in the preview and refuse to
  submit there.
