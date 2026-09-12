import { architecture, RHYTHM_SPACING, type DesignArchitecture } from "./architectures";
import { readableOn } from "./contrast";
import { localeInfo, type Locale } from "./locales";
import { fontStack, key, t, type ImageRole, type Section, type SectionLayout, type Site } from "./site";
import { tokensForArchitecture } from "./tokens";
import { buildStructuredData } from "./seo";

/**
 * Renders one locale of a Site document to a standalone HTML page.
 *
 * Two properties matter most here:
 *
 *  - The visual result is driven by the chosen design architecture, not by a
 *    single template with swapped colours. Layout, type scale, image
 *    treatment, navigation, ornament and motion all change (requirement 6).
 *
 *  - A language is a separate rendered document, not a JavaScript text swap.
 *    That is what lets each language carry its own <html lang>, <title>,
 *    metadata, canonical URL and hreflang set, and be indexed properly
 *    (requirements 12 and 16).
 */

/**
 * The crop for each role, mirrored from server/images.ts.
 *
 * Kept here as data rather than imported because the renderer is shared with
 * the client bundle and must not pull a server module in; the design QA
 * asserts the two agree.
 */
export const ROLE_ASPECT: Record<ImageRole, { desktop: string; mobile: string }> = {
  hero: { desktop: "16/9", mobile: "4/5" },
  section: { desktop: "4/3", mobile: "3/2" },
  gallery: { desktop: "4/5", mobile: "1/1" },
  showcase: { desktop: "3/2", mobile: "4/3" },
  menu: { desktop: "1/1", mobile: "1/1" },
  supporting: { desktop: "3/2", mobile: "3/2" },
};

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Blocks javascript:/data: hrefs arriving from AI output or creator input. */
function safeHref(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "#";
  if (/^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i.test(v)) return esc(v);
  return "#";
}

export type RenderOptions = {
  /** Which language to render. Defaults to the site's default locale. */
  locale?: Locale;
  /** Maps an asset id to a URL. Preview uses API URLs; export uses relative. */
  assetUrl?: (id: string) => string;
  /** Where the switcher and hreflang point for a given locale. */
  localeHref?: (locale: Locale) => string;
  /** Absolute site origin, needed for canonical/OG URLs. */
  baseUrl?: string;
  /** Absolute URL of this exact page, for canonical. */
  canonical?: string;
};

function imageUrl(id: string, opts: RenderOptions): string | null {
  if (!id) return null;
  return (opts.assetUrl ? opts.assetUrl(id) : `/api/assets/${id}`) || null;
}


/**
 * Web font loading, kept to the minimum that is defensible on mobile data:
 * preconnect to both Google hosts, one stylesheet, and `display=swap` so text
 * paints immediately in the fallback stack rather than staying invisible.
 * A digital menu never reaches here — its fontFamilies is null by design.
 */
function fontLinks(site: Site): string {
  const url = site.theme.fontFamilies?.url?.trim();
  if (!url) return "";
  if (!/^https:\/\/fonts\.googleapis\.com\//.test(url)) return "";
  const trimmed = trimFontWeights(url, site);
  const withSwap = trimmed.includes("display=")
    ? trimmed
    : `${trimmed}${trimmed.includes("?") ? "&" : "?"}display=swap`;
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(withSwap)}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${esc(withSwap)}"></noscript>`;
}

/**
 * Ask Google only for the weights this design actually sets.
 *
 * The catalogue hands over a family URL with every weight the family offers,
 * which is a font file each — on a phone that is real bytes for glyphs no rule
 * ever references. The token engine names exactly two weights, and the
 * stylesheet below uses nothing else, so the rest can go.
 *
 * Conservative by construction: it only rewrites the standard `wght@a;b;c`
 * form, only ever removes, and leaves the URL exactly as it found it if the
 * result would be empty or the shape is unfamiliar. Removing a weight the
 * design uses would be worse than shipping one it does not.
 */
function trimFontWeights(url: string, site: Site): string {
  const tokens = site.theme.tokens;
  if (!tokens) return url;
  if (!/wght@[\d;,.]+/.test(url)) return url;

  const wanted = new Set([tokens.type.headingWeight, tokens.type.bodyWeight, 400]);

  return url.replace(/wght@([\d;,.]+)/g, (whole, list: string) => {
    const offered = list.split(";").filter(Boolean);
    // Italics and other axes come through as "0,400;1,400" — a shape this is
    // not confident about, so it is left alone.
    if (offered.some((w) => w.includes(","))) return whole;

    const kept = offered.filter((w) => wanted.has(Number(w)));
    // Nothing recognised means the assumption is wrong somewhere; keep them all.
    if (!kept.length) return whole;
    return `wght@${kept.join(";")}`;
  });
}

/**
 * Tell the browser about the one image that decides how fast the page feels.
 *
 * The hero is discovered late — it is an `<img>` deep in the body, behind the
 * stylesheet — and it is almost always the largest contentful paint. One
 * preload hint in the head starts it in parallel with the CSS instead of after
 * it. Only ever the hero: preloading more would make them compete, which is
 * the problem this is meant to solve.
 */
function heroPreload(site: Site, opts: RenderOptions): string {
  const hero = site.images?.find((p) => p.role === "hero" && p.priority);
  if (!hero) return "";
  const url = imageUrl(hero.assetId, opts);
  if (!url) return "";
  return `<link rel="preload" as="image" href="${esc(url)}" fetchpriority="high">`;
}

/* ------------------------------------------------------------------ CSS -- */

/**
 * Font stack for a role. When the design-intelligence stage picked a web font
 * pairing, that family leads and the local stack stays behind it as the
 * fallback — so the page is readable before the font arrives, and stays
 * readable if it never does.
 */
function stackFor(site: Site, role: "heading" | "body"): string {
  const local = fontStack(site.theme.fonts[role]);
  const family = site.theme.fontFamilies?.[role]?.trim();
  if (!family) return local;
  // Quote families containing spaces, as CSS requires.
  const quoted = /^[A-Za-z0-9-]+$/.test(family) ? family : `"${family.replace(/"/g, "")}"`;
  return `${quoted}, ${local}`;
}

function styles(site: Site, a: DesignArchitecture, dir: "ltr" | "rtl"): string {
  const c = site.theme.colors;

  /* The design system decides the values; the architecture decides the
     composition. A document generated before the token engine existed is
     rendered from its architecture alone, which reproduces exactly what it
     looked like then. */
  const tk = site.theme.tokens ?? tokensForArchitecture(site.theme.architecture, site.meta.kind);

  const radius = tk.shape.card;
  const imageRadius = tk.shape.image;

  // Motion budget, additionally overridden to zero by prefers-reduced-motion
  // further down.
  const dur = tk.motion === "none" ? "0ms" : tk.motion === "subtle" ? "160ms" : "280ms";

  const imageShape = {
    sharp: `border-radius:0`,
    soft: `border-radius:${imageRadius}px`,
    framed: `border-radius:0;border:${tk.shape.border}px solid var(--line);padding:6px;background:var(--bg)`,
    arch: `border-radius:${Math.max(imageRadius, 120)}px ${Math.max(imageRadius, 120)}px ${imageRadius}px ${imageRadius}px`,
    circle: `border-radius:50%`,
    duotone: `border-radius:${imageRadius}px;filter:saturate(.55) contrast(1.05)`,
  }[tk.image.treatment];

  const btnRadius =
    tk.shape.buttonShape === "pill" ? "999px" : tk.shape.buttonShape === "square" ? "0" : `${tk.shape.button}px`;

  const btnFill =
    tk.shape.buttonFill === "solid"
      ? `background:var(--primary);color:var(--on-primary);border:${tk.shape.border}px solid var(--primary)`
      : tk.shape.buttonFill === "outline"
        ? `background:transparent;color:var(--primary);border:${tk.shape.border}px solid var(--primary)`
        : `background:transparent;color:var(--primary);border:0;border-bottom:${tk.shape.border + 1}px solid var(--primary);padding-inline:0;border-radius:0`;

  /* Card surface. "none" is a real answer: for a formal, quiet business the
     right container for a list of services is no container at all. */
  const cardSurface = {
    none: `background:transparent;border:0;padding:0`,
    border: `background:transparent;border:${tk.shape.border}px solid var(--line);padding:1.25rem`,
    tint: `background:var(--card);border:${tk.shape.border}px solid var(--line);padding:1.25rem`,
    raised: `background:var(--card);border:0;padding:1.375rem`,
  }[tk.surface.card];

  const shadowValue = {
    none: "none",
    hairline: "0 1px 0 color-mix(in srgb,var(--text) 10%,transparent)",
    soft: "0 2px 10px color-mix(in srgb,var(--text) 8%,transparent)",
    lifted: "0 10px 30px color-mix(in srgb,var(--text) 14%,transparent)",
  }[tk.shape.shadow];

  /* The hero's composition comes from the layout engine when it has decided
     one, and from the architecture otherwise. */
  const heroSection = site.sections.find((s) => s.type === "hero");
  const heroStyle: DesignArchitecture["hero"] =
    heroSection?.layout === "image-led"
      ? "split"
      : heroSection?.layout === "typographic"
        ? "typographic"
        : heroSection?.layout === "poster"
          ? "poster"
          : heroSection?.layout === "editorial-hero"
            ? "editorial"
            : a.hero;

  return `
:root{
  --primary:${esc(c.primary)};
  --secondary:${esc(c.secondary)};
  --accent:${esc(c.accent)};
  --bg:${esc(c.bg)};
  --text:${esc(c.text)};
  /* Not simply the page background: a dark palette's primary can sit close to
     its background, which would make a solid button's label invisible. */
  --on-primary:${esc(readableOn(c.primary))};
  --on-accent:${esc(readableOn(c.accent))};
  --muted:color-mix(in srgb, ${esc(c.text)} 62%, ${esc(c.bg)});
  --line:color-mix(in srgb, ${esc(c.text)} ${tk.shape.border > 1 ? 40 : 16}%, ${esc(c.bg)});
  --card:color-mix(in srgb, ${esc(c.bg)} 94%, ${esc(c.text)});
  --radius:${radius}px;
  --block:clamp(${(tk.space.section * 0.55).toFixed(2)}rem,${(tk.space.section * 0.35).toFixed(2)}rem + ${(tk.space.section * 0.9).toFixed(2)}vw,${tk.space.section.toFixed(2)}rem);
  --gap:${tk.space.gap.toFixed(2)}rem;
  --measure:${tk.type.measure}ch;
  --rule:${tk.shape.border}px;
  --shadow:${shadowValue};
  --dur:${dur};
  --safe-t:env(safe-area-inset-top,0px);
  --safe-b:env(safe-area-inset-bottom,0px);
  --safe-l:env(safe-area-inset-left,0px);
  --safe-r:env(safe-area-inset-right,0px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;background:var(--bg);color:var(--text);
  font-family:${stackFor(site, "body")};
  font-size:clamp(1rem,.96rem + .2vw,1.125rem);
  font-weight:${tk.type.bodyWeight};
  letter-spacing:${tk.type.bodyTracking};
  line-height:${tk.type.bodyLeading};overflow-x:hidden;
}
h1,h2,h3{
  font-family:${stackFor(site, "heading")};
  font-weight:${tk.type.headingWeight};
  line-height:${tk.type.headingLeading};margin:0 0 .5em;text-wrap:balance;
  letter-spacing:${tk.type.headingTracking};
  /* A last resort, not a design decision: visual QA sizes headings so words
     fit, but a business name nobody anticipated must break rather than push
     the whole page sideways on a 320px phone. */
  overflow-wrap:break-word;
  ${tk.type.headingCase === "upper" ? "text-transform:uppercase;" : ""}
}
h1{font-size:clamp(${(1.85 * tk.type.scale).toFixed(2)}rem,${(1.2 * tk.type.scale).toFixed(2)}rem + ${(2.8 * tk.type.scale * tk.type.ratio / 1.25).toFixed(2)}vw,${(3.4 * tk.type.scale * tk.type.ratio / 1.25).toFixed(2)}rem)}
h2{font-size:clamp(${(1.4 * tk.type.scale).toFixed(2)}rem,${(1.1 * tk.type.scale).toFixed(2)}rem + ${(1.5 * tk.type.scale).toFixed(2)}vw,${(2.2 * tk.type.scale).toFixed(2)}rem)}
h3{font-size:clamp(1.05rem,1rem + .55vw,1.3rem);letter-spacing:0;text-transform:none}
p{margin:0 0 1em;text-wrap:pretty;max-width:var(--measure)}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary)}
:focus-visible{outline:2px solid var(--primary);outline-offset:3px}

.wrap{width:100%;max-width:${tk.space.container}rem;margin-inline:auto;
  padding-inline:max(1.25rem,var(--safe-l),var(--safe-r));}
section{padding-block:var(--block)}
.eyebrow{
  font-size:.8125rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--primary);font-weight:700;margin:0 0 .75rem;
}
.muted{color:var(--muted)}
.lead{font-size:1.0625em}

${a.headingOrnament === "rule" || tk.surface.divider === "rule"
  ? `section > .wrap > h2::before{content:"";display:block;width:3rem;height:var(--rule);background:var(--primary);margin-bottom:1rem}`
  : a.headingOrnament === "number"
    ? `main{counter-reset:sec}
       section > .wrap > h2{counter-increment:sec}
       section > .wrap > h2::before{
         content:counter(sec,decimal-leading-zero);display:block;
         font-size:.75rem;letter-spacing:.2em;color:var(--primary);
         margin-bottom:.6rem;font-family:${fontStack("mono")}}`
    : ""}

.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  min-height:3rem;padding:.75rem 1.5rem;border-radius:${btnRadius};
  font-weight:650;text-decoration:none;${btnFill};
  transition:transform var(--dur) ease,filter var(--dur) ease;
  ${tk.type.headingCase === "upper" ? "text-transform:uppercase;letter-spacing:.1em;font-size:.875rem;" : ""}
}
.btn:active{transform:scale(.98)}
.btn.ghost{background:transparent;color:var(--primary);border:var(--rule) solid var(--line)}
.btns{display:flex;flex-wrap:wrap;gap:.75rem}
@media (max-width:26rem){.btns .btn{flex:1 1 100%}}

/* ---------------------------------------------------------------- header */
.site-header{
  position:sticky;top:0;z-index:50;
  background:color-mix(in srgb,var(--bg) 90%,transparent);
  backdrop-filter:saturate(180%) blur(12px);
  border-bottom:var(--rule) solid var(--line);
  padding-top:var(--safe-t);
}
.site-header .bar{display:flex;align-items:center;gap:1rem;min-height:3.5rem}
.brand{
  /* The business name in the header is a link home, so it is something people
     tap — and a 27px-tall line of text is not a tap target. */
  display:inline-flex;align-items:center;gap:.6rem;min-height:2.75rem;
  font-family:${stackFor(site, "heading")};
  font-weight:750;font-size:1.0625rem;text-decoration:none;color:var(--text);
  ${a.headingCase === "upper" ? "text-transform:uppercase;letter-spacing:.12em;font-size:.9375rem;" : ""}
}
.brand img{max-height:2.25rem;width:auto}
.nav-desktop{display:none}
.header-actions{display:flex;align-items:center;gap:.5rem;margin-inline-start:auto}
@media (min-width:52rem){
  .nav-desktop{display:flex;gap:1.5rem;flex-wrap:wrap}
  .nav-desktop a{
    text-decoration:none;color:var(--text);font-weight:550;
    display:inline-flex;align-items:center;min-height:2.75rem;
    ${a.headingCase === "upper" ? "text-transform:uppercase;letter-spacing:.1em;font-size:.8125rem;" : ""}
  }
  .nav-desktop a:hover{color:var(--primary)}
}
${a.nav === "centered"
  ? `@media (min-width:52rem){
       .site-header .bar{flex-direction:column;gap:.5rem;padding-block:1rem}
       .header-actions{margin-inline-start:0}
       .nav-desktop{justify-content:center}
     }`
  : ""}
${a.nav === "sidebarish"
  ? `@media (min-width:64rem){
       .site-header{position:static;border-bottom:0}
       .site-header .bar{align-items:flex-start;padding-block:2rem}
       .brand{font-size:1.5rem}
       .nav-desktop{flex-direction:column;gap:.25rem}
     }`
  : ""}
.nav-toggle{
  display:inline-flex;align-items:center;justify-content:center;
  width:2.75rem;height:2.75rem;border:var(--rule) solid var(--line);
  border-radius:${btnRadius === "999px" ? "999px" : `${radius}px`};
  background:transparent;color:var(--text);cursor:pointer;
}
/* After the rule above, not inside the block with the desktop nav: two rules
   of equal specificity are settled by order, so hiding the toggle before
   declaring it left every desktop page with a hamburger beside its menu. */
@media (min-width:52rem){.nav-toggle{display:none}}
#nav-open{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.nav-mobile{display:none;padding-bottom:.75rem}
#nav-open:checked ~ .wrap .nav-mobile{display:block}
.nav-mobile a{
  display:flex;align-items:center;min-height:3rem;padding:0 .25rem;
  text-decoration:none;color:var(--text);
  border-top:var(--rule) solid var(--line);font-weight:550;
}
@media (min-width:52rem){.nav-mobile{display:none!important}}

/* ------------------------------------------------------- language switch */
.lang{display:flex;align-items:center;gap:.125rem}
.lang a{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:2.75rem;min-width:2.75rem;padding:0 .625rem;
  text-decoration:none;color:var(--muted);font-weight:650;font-size:.8125rem;
  letter-spacing:.06em;border-radius:${btnRadius === "999px" ? "999px" : `${radius}px`};
  transition:color var(--dur) ease,background var(--dur) ease;
}
.lang a[aria-current="true"]{color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent)}
.lang .sep{color:var(--line);user-select:none}
/* A menu's switcher sits above the fold, full width, impossible to miss. */
.lang-banner{
  display:flex;justify-content:center;gap:.25rem;
  padding:.5rem max(1rem,var(--safe-l)) .5rem max(1rem,var(--safe-r));
  border-bottom:var(--rule) solid var(--line);
  background:color-mix(in srgb,var(--bg) 94%,var(--text));
  position:sticky;top:0;z-index:60;padding-top:calc(.5rem + var(--safe-t));
}
.lang-banner a{
  display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1rem;
  text-decoration:none;font-weight:700;color:var(--muted);font-size:.9375rem;
  border-radius:999px;
}
.lang-banner a[aria-current="true"]{color:var(--on-primary);background:var(--primary)}

/* ------------------------------------------------------------------ grid */
.grid{display:grid;gap:var(--gap);grid-template-columns:1fr}
@media (min-width:40rem){.grid.two{grid-template-columns:repeat(2,1fr)}}
@media (min-width:64rem){.grid.three{grid-template-columns:repeat(3,1fr)}}
.card{
  ${cardSurface};border-radius:${radius}px;
  ${tk.shape.shadow === "none" ? "" : "box-shadow:var(--shadow);"}
}

/* ------------------------------------------------------------------ hero */
.hero{padding-block:calc(var(--block) * 1.15)}
.media{overflow:hidden;background:var(--card);${imageShape}}
.media img{width:100%;height:100%;object-fit:cover}
.hero-media{margin-top:1.5rem;aspect-ratio:4/3}
@media (min-width:52rem){.hero-media{aspect-ratio:16/9}}
${heroStyle === "split"
  ? `@media (min-width:64rem){
       .hero .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:3rem;align-items:center}
       .hero-media{margin-top:0;aspect-ratio:4/5}
     }`
  : ""}
${heroStyle === "stacked"
  ? `.hero{position:relative;padding:0}
     .hero .hero-media{margin:0;aspect-ratio:3/4;border-radius:0}
     @media (min-width:52rem){.hero .hero-media{aspect-ratio:21/9}}
     .hero .hero-copy{
       position:relative;margin-top:-30%;padding-block:2rem;
       background:linear-gradient(to top,var(--bg) 55%,transparent);
     }
     @media (min-width:52rem){.hero .hero-copy{margin-top:-18%}}`
  : ""}
${heroStyle === "typographic"
  ? `.hero h1{font-size:clamp(${(2.2 * tk.type.scale).toFixed(2)}rem,${(1.1 * tk.type.scale).toFixed(2)}rem + ${(6 * tk.type.scale).toFixed(2)}vw,${(5.5 * tk.type.scale).toFixed(2)}rem)}
     .hero-media{aspect-ratio:16/9;margin-top:2.5rem}`
  : ""}
${heroStyle === "editorial"
  ? `.hero .wrap{border-top:calc(var(--rule) * 3) solid var(--text);padding-top:2rem}
     .hero h1{max-width:14ch}
     @media (min-width:64rem){
       .hero .wrap{display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:start}
       .hero-media{margin-top:0;aspect-ratio:1}
     }`
  : ""}
${heroStyle === "poster"
  ? `.hero{text-align:center}
     .hero .wrap>div{margin-inline:auto}
     .hero p{margin-inline:auto}
     .hero .btns{justify-content:center}
     .hero-media{aspect-ratio:3/2;max-width:56rem;margin-inline:auto}`
  : ""}

/* ----------------------------------------------------------- image roles */
/* A hero and a gallery tile are different picture problems, so they are not
   cropped to the same box. The ratios come from server/images.ts, and the
   object-position on each <img> keeps the subject in frame when a wide
   photograph is cropped to a phone-shaped band. */
.img-hero{aspect-ratio:${ROLE_ASPECT.hero.mobile}}
.img-section{aspect-ratio:${ROLE_ASPECT.section.mobile}}
.img-gallery{aspect-ratio:${ROLE_ASPECT.gallery.mobile}}
.img-showcase{aspect-ratio:${ROLE_ASPECT.showcase.mobile}}
.img-supporting{aspect-ratio:${ROLE_ASPECT.supporting.mobile}}
@media (min-width:52rem){
  .img-hero{aspect-ratio:${ROLE_ASPECT.hero.desktop}}
  .img-section{aspect-ratio:${ROLE_ASPECT.section.desktop}}
  .img-gallery{aspect-ratio:${ROLE_ASPECT.gallery.desktop}}
  .img-showcase{aspect-ratio:${ROLE_ASPECT.showcase.desktop}}
  .img-supporting{aspect-ratio:${ROLE_ASPECT.supporting.desktop}}
}
/* The role class owns the box; the img fills it and is positioned by focus. */
.media.img-hero,.media.img-section{height:auto}
.thumbs figure.img-gallery,.thumbs figure.img-showcase{aspect-ratio:unset}
.thumbs figure.img-gallery{aspect-ratio:${ROLE_ASPECT.gallery.desktop}}
.thumbs figure.img-showcase{aspect-ratio:${ROLE_ASPECT.showcase.desktop}}

/* ------------------------------------------------- section compositions */
/* One set of items can be a card grid, a ruled list, an editorial column or
   a numbered index. Which one a section gets is decided per business in
   server/layout.ts — that decision is what stops every generated site
   sharing a silhouette. */

.lay-list{display:grid;gap:0}
.lay-list > *{
  padding-block:calc(var(--gap) * 1.1);
  border-top:var(--rule) solid var(--line);
}
.lay-list > *:last-child{border-bottom:var(--rule) solid var(--line)}
.lay-list h3{margin:0 0 .35em}
.lay-list p{margin:0}
@media (min-width:52rem){
  .lay-list > *{display:grid;grid-template-columns:minmax(12rem,18rem) 1fr;gap:2rem;align-items:baseline}
}

.lay-editorial{display:grid;gap:calc(var(--gap) * 1.6)}
.lay-editorial > *{max-width:var(--measure)}
.lay-editorial h3{margin:0 0 .4em}
.lay-editorial p{margin:0}
@media (min-width:64rem){
  .lay-editorial{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:4rem}
}

.lay-index{counter-reset:idx;display:grid;gap:0}
.lay-index > *{
  position:relative;padding-block:calc(var(--gap) * 1.15);padding-inline-start:3.25rem;
  border-top:var(--rule) solid var(--line);counter-increment:idx;
}
.lay-index > *:last-child{border-bottom:var(--rule) solid var(--line)}
.lay-index > *::before{
  content:counter(idx,decimal-leading-zero);position:absolute;inset-inline-start:0;top:calc(var(--gap) * 1.15);
  font-size:.75rem;letter-spacing:.18em;color:var(--primary);font-weight:700;
}
.lay-index h3{margin:0 0 .3em}
.lay-index p{margin:0}

.lay-split{display:grid;gap:var(--gap)}
@media (min-width:64rem){
  .lay-split{grid-template-columns:1fr 1fr;gap:3rem;align-items:start}
}

.lay-statement{max-width:34ch}
.lay-statement p{font-size:clamp(1.15rem,1rem + .9vw,1.6rem);line-height:1.35;max-width:none}
.lay-statement blockquote{margin:0;font-size:clamp(1.15rem,1rem + .9vw,1.6rem);line-height:1.35}

.lay-band{
  background:color-mix(in srgb,var(--primary) 8%,var(--bg));
  border-block:var(--rule) solid color-mix(in srgb,var(--primary) 25%,transparent);
  padding-block:calc(var(--gap) * 1.5);padding-inline:calc(var(--gap) * 1.2);
  border-radius:${radius}px;
}
.lay-band blockquote{margin:0;max-width:var(--measure)}

.lay-inline{display:grid;gap:calc(var(--gap) * 1.2)}
.lay-inline blockquote{margin:0;max-width:var(--measure);padding-inline-start:1rem;border-inline-start:calc(var(--rule) * 3) solid var(--primary)}

/* Alternating background, when the page is long enough to need chapters. */
${tk.surface.banding
  ? `main > section:nth-of-type(even):not(.hero):not(.cta-band){background:color-mix(in srgb,var(--text) 3%,var(--bg))}`
  : ""}

/* --------------------------------------------------------------- gallery */
.thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem}
@media (min-width:52rem){.thumbs{grid-template-columns:repeat(3,1fr);gap:.75rem}}
.thumbs figure{margin:0;aspect-ratio:${tk.image.treatment === "circle" ? "1" : tk.image.ratio === "wide" ? "16/10" : tk.image.ratio === "landscape" ? "4/3" : tk.image.ratio === "square" ? "1" : "4/5"};overflow:hidden;background:var(--card);${imageShape}}
.thumbs img{width:100%;height:100%;object-fit:cover;transition:transform var(--dur) ease}
${tk.motion === "expressive" ? `.thumbs figure:hover img{transform:scale(1.04)}` : ""}

.thumbs.mosaic{grid-template-columns:repeat(2,1fr)}
.thumbs.mosaic figure:first-child{grid-column:1 / -1;aspect-ratio:16/9}
@media (min-width:52rem){
  .thumbs.mosaic{grid-template-columns:repeat(3,1fr)}
  .thumbs.mosaic figure:first-child{grid-column:span 2;grid-row:span 2;aspect-ratio:auto}
}
.thumbs.strip{grid-template-columns:1fr}
@media (min-width:40rem){.thumbs.strip{grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}}

.price-line{font-weight:700;margin:.35rem 0 0;color:var(--text)}

/* A quieter invitation: the same content without the coloured band. */
.cta-inline .wrap{
  border-top:calc(var(--rule) * 2) solid var(--line);
  padding-top:calc(var(--gap) * 1.4);
  max-width:${tk.space.container}rem;
}
.cta-inline h2{max-width:20ch}
.cta-inline p{max-width:var(--measure)}

/* ------------------------------------------------------------------ menu */
.menu-cat{margin-bottom:2rem}
.menu-cat h3{
  position:sticky;top:${a.nav === "none" ? "3.25rem" : "3.5rem"};z-index:5;
  margin:0 0 .25rem;padding:.5rem 0;background:var(--bg);
  border-bottom:calc(var(--rule) * 2) solid var(--primary);
}
.menu-item{display:flex;gap:1rem;justify-content:space-between;align-items:baseline;
  padding:.85rem 0;border-bottom:var(--rule) solid var(--line)}
.menu-item .name{font-weight:650}
.menu-item .desc{color:var(--muted);font-size:.9375rem;margin:.2rem 0 0;max-width:none}
.menu-item .price{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.menu-item .menu-body{min-width:0;flex:1}
/* A thumbnail keeps its aspect ratio via object-fit; the box never distorts
   the photo, and a missing image simply leaves the row text-only. */
.menu-item.has-image{align-items:center}
.menu-thumb{
  flex:0 0 auto;width:4.5rem;height:4.5rem;overflow:hidden;
  border-radius:${Math.min(radius, 12)}px;background:var(--card);
}
.menu-thumb img{width:100%;height:100%;object-fit:cover;display:block}
@media (min-width:40rem){ .menu-thumb{width:5.5rem;height:5.5rem} }
.chefs{
  display:inline-block;margin-inline-start:.4rem;padding:.1rem .5rem;
  font-size:.6875rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  border-radius:999px;background:var(--accent);color:var(--on-accent);
  vertical-align:middle;white-space:nowrap;
}
.menu-jump{display:flex;gap:.5rem;overflow-x:auto;padding:.75rem 0;
  scroll-snap-type:x proximity;scrollbar-width:none}
.menu-jump::-webkit-scrollbar{display:none}
.menu-jump a{
  flex:0 0 auto;scroll-snap-align:start;text-decoration:none;
  display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1rem;
  border:var(--rule) solid var(--line);border-radius:999px;
  color:var(--text);font-weight:600;font-size:.9375rem;
}
.tag{display:inline-block;font-size:.75rem;padding:.15rem .5rem;
  margin-inline-start:.35rem;border:var(--rule) solid var(--line);
  border-radius:999px;color:var(--muted)}

/* ----------------------------------------------------------------- other */
.hours-row{display:flex;justify-content:space-between;gap:1rem;
  padding:.75rem 0;border-bottom:var(--rule) solid var(--line)}
blockquote{margin:0;font-size:1.0625rem}
.cta-band{background:var(--primary);color:var(--on-primary)}
.cta-band h2,.cta-band p{color:var(--on-primary)}
.cta-band h2::before{background:var(--on-primary)!important;color:var(--on-primary)!important}
.cta-band .btn{background:var(--on-primary);color:var(--primary);border-color:var(--on-primary)}
.contact-list{list-style:none;margin:0;padding:0}
/* The row styling belongs to the row, not to the link: an address with no map
   link is still a row of the same list. */
.contact-list a,.contact-list li{display:flex;align-items:center;gap:.75rem;min-height:3.25rem;
  text-decoration:none;color:var(--text);border-bottom:var(--rule) solid var(--line)}
.contact-list li:has(> a){display:block;min-height:0;border-bottom:0}

footer{border-top:var(--rule) solid var(--line);padding-block:2.5rem;
  padding-bottom:calc(2.5rem + var(--safe-b));color:var(--muted);font-size:.9375rem}
footer .links{display:flex;flex-wrap:wrap;gap:1rem;margin-top:.75rem}
footer .links a{display:inline-flex;align-items:center;min-height:2.75rem}
footer .lang{margin-top:1rem}

.sticky-cta{
  position:fixed;inset-inline:0;bottom:0;z-index:60;
  padding:.75rem max(1rem,var(--safe-l)) calc(.75rem + var(--safe-b)) max(1rem,var(--safe-r));
  background:color-mix(in srgb,var(--bg) 92%,transparent);
  backdrop-filter:blur(12px);border-top:var(--rule) solid var(--line);
}
.sticky-cta .btn{width:100%}
body.has-sticky{padding-bottom:5.5rem}
@media (min-width:52rem){.sticky-cta{display:none}body.has-sticky{padding-bottom:0}}

.skip{position:absolute;inset-inline-start:-9999px;top:0;z-index:99}
.skip:focus{inset-inline-start:1rem;top:1rem}

@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
}
@media (prefers-contrast:more){:root{--muted:var(--text);--line:var(--text)}}
@media print{.site-header,.sticky-cta,.lang-banner{display:none}}
`.trim();
}

/* -------------------------------------------------------------- sections */

function navLinks(site: Site, locale: Locale): { href: string; label: string }[] {
  return site.sections
    .filter((s) => s.visible && s.type !== "hero" && s.type !== "footer")
    .map((s) => ({
      href: `#${s.id}`,
      label: t(site, locale, key.section(s.id, "title")),
    }))
    .filter((l) => l.label);
}

/**
 * The attributes one photograph needs.
 *
 * Real width and height so the browser reserves the right box before the file
 * arrives — a hardcoded 1400×1050 on a portrait photograph is a layout shift
 * waiting to happen. Focal point so a wide picture cropped to a phone-shaped
 * band keeps its subject. Priority only at the top of the page; everything
 * else is lazy.
 */
function imageAttrs(site: Site, assetId: string, fallbackRole: ImageRole): {
  attrs: string;
  style: string;
  ratioClass: string;
} {
  const placement = site.images?.find((p) => p.assetId === assetId);
  const role = placement?.role ?? fallbackRole;
  const width = placement?.width ?? 1400;
  const height = placement?.height ?? 1050;
  const focal =
    placement && (placement.focalX !== 0.5 || placement.focalY !== 0.5)
      ? `object-position:${(placement.focalX * 100).toFixed(1)}% ${(placement.focalY * 100).toFixed(1)}%;`
      : "";
  const priority = placement?.priority ?? role === "hero";

  return {
    attrs: `width="${width}" height="${height}" ${
      priority ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"'
    }`,
    style: focal,
    ratioClass: `img-${role}`,
  };
}

function renderSection(s: Section, site: Site, locale: Locale, opts: RenderOptions): string {
  if (!s.visible) return "";
  const id = esc(s.id);
  const str = (field: string) => t(site, locale, key.section(s.id, field));
  const row = (rowId: string, field: string) => t(site, locale, key.row(s.id, rowId, field));
  const chefsLabel = t(site, locale, key.meta("chefsChoiceLabel")) || "Chef's choice";

  switch (s.type) {
    case "hero": {
      const img = imageUrl(s.imageId, opts);
      const heroImg = img ? imageAttrs(site, s.imageId, "hero") : null;
      const media = img && heroImg
        ? `<div class="media hero-media ${heroImg.ratioClass}"><img src="${esc(img)}" alt="${esc(
            t(site, locale, key.section(s.id, "imageAlt")) || t(site, locale, key.meta("logoAlt")) || "",
          )}" ${heroImg.attrs} style="${heroImg.style}"></div>`
        : "";
      return `<section class="hero" id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<div class="hero-copy">
${str("eyebrow") ? `<p class="eyebrow">${esc(str("eyebrow"))}</p>` : ""}
<h1 id="${id}-h">${esc(str("headline"))}</h1>
<p class="muted lead">${esc(str("subheadline"))}</p>
<div class="btns">
${str("ctaLabel") ? `<a class="btn" href="${safeHref(s.ctaHref)}">${esc(str("ctaLabel"))}</a>` : ""}
${str("secondaryLabel") ? `<a class="btn ghost" href="${safeHref(s.secondaryHref)}">${esc(str("secondaryLabel"))}</a>` : ""}
</div></div>
${media}
</div></section>`;
    }

    case "about": {
      const img = imageUrl(s.imageId, opts);
      const body = str("body").split(/\n{2,}/).filter(Boolean);
      const layout = s.layout ?? "editorial";
      const prose = body.map((p) => `<p>${esc(p)}</p>`).join("");
      const aboutImg = img ? imageAttrs(site, s.imageId, "section") : null;
      const media = img && aboutImg
        ? `<div class="media hero-media ${aboutImg.ratioClass}"><img src="${esc(img)}" alt="${esc(
            t(site, locale, key.section(s.id, "imageAlt")),
          )}" ${aboutImg.attrs} style="${aboutImg.style}"></div>`
        : "";

      // Highlights are short facts, not a product grid. Boxing three of them
      // is the most common way a page announces that nobody designed it, so
      // they are only carded where cards are the section's own language.
      const highlights = s.highlights.length
        ? layout === "split" || layout === "editorial"
          ? `<ul class="lay-list" style="list-style:none;padding:0;margin-top:1.5rem">${s.highlights
              .map((h) => `<li>${esc(row(h.id, "text"))}</li>`)
              .join("")}</ul>`
          : `<ul class="grid two" style="list-style:none;padding:0;margin-top:1.5rem">${s.highlights
              .map((h) => `<li class="card">${esc(row(h.id, "text"))}</li>`)
              .join("")}</ul>`
        : "";

      if (layout === "split" && media) {
        return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<div class="lay-split">
<div><h2 id="${id}-h">${esc(str("heading"))}</h2>${prose}${highlights}</div>
${media}
</div>
</div></section>`;
      }

      if (layout === "statement") {
        return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
<div class="lay-statement">${prose}</div>
${media}${highlights}
</div></section>`;
      }

      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
${prose}
${media}
${highlights}
</div></section>`;
    }

    case "services": {
      // Same items, four different compositions. Which one this business gets
      // was decided from what it actually has: three comparable services scan
      // well as cards, nine read better as an index, and two are a statement
      // rather than a grid of two.
      const layout = s.layout ?? "cards";
      const price = (it: { price: string }) =>
        it.price ? `<p class="price-line">${esc(it.price)}</p>` : "";
      const item = (it: (typeof s.items)[number], tag: string) =>
        `<${tag}><h3>${esc(row(it.id, "name"))}</h3><div><p class="muted">${esc(
          row(it.id, "description"),
        )}</p>${price(it)}</div></${tag}>`;

      const bodyHtml =
        layout === "cards"
          ? `<div class="grid ${s.items.length % 3 === 0 && s.items.length > 3 ? "three" : "two"}">${s.items
              .map(
                (it) =>
                  `<article class="card"><h3>${esc(row(it.id, "name"))}</h3><p class="muted">${esc(
                    row(it.id, "description"),
                  )}</p>${price(it)}</article>`,
              )
              .join("")}</div>`
          : layout === "index"
            ? `<div class="lay-index">${s.items.map((it) => item(it, "article")).join("")}</div>`
            : layout === "editorial"
              ? `<div class="lay-editorial">${s.items.map((it) => item(it, "article")).join("")}</div>`
              : layout === "statement"
                ? `<div class="lay-statement">${s.items
                    .map(
                      (it) =>
                        `<h3>${esc(row(it.id, "name"))}</h3><p>${esc(row(it.id, "description"))}</p>${price(it)}`,
                    )
                    .join("")}</div>`
                : layout === "split"
                  ? `<div class="lay-split">${s.items.map((it) => item(it, "article")).join("")}</div>`
                  : `<div class="lay-list">${s.items.map((it) => item(it, "article")).join("")}</div>`;

      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
${str("intro") ? `<p class="muted lead">${esc(str("intro"))}</p>` : ""}
${bodyHtml}
</div></section>`;
    }

    case "menu":
      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
${str("note") ? `<p class="muted">${esc(str("note"))}</p>` : ""}
${s.categories.length > 1 ? `<nav class="menu-jump" aria-label="${esc(str("heading"))}">${
  s.categories.map((c) => `<a href="#${esc(c.id)}">${esc(row(c.id, "name"))}</a>`).join("")
}</nav>` : ""}
${s.categories.map((c) => `<div class="menu-cat"><h3 id="${esc(c.id)}">${esc(row(c.id, "name"))}</h3>${
  c.items.map((it) => {
    const name = t(site, locale, key.menuItem(s.id, c.id, it.id, "name"));
    const desc = t(site, locale, key.menuItem(s.id, c.id, it.id, "description"));
    const alt = t(site, locale, key.menuItem(s.id, c.id, it.id, "alt"));
    const img = it.imageId ? imageUrl(it.imageId, opts) : null;
    // The badge is a labelled element, not a bare glyph: the raw TRUE/FALSE
    // from the sheet is never shown, and a screen reader hears the label.
    const badge = it.chefsChoice
      ? `<span class="chefs" title="${esc(chefsLabel)}">${esc(chefsLabel)}</span>`
      : "";
    return `<div class="menu-item${img ? " has-image" : ""}">
${img ? `<div class="menu-thumb"><img src="${esc(img)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="200" height="200"></div>` : ""}
<div class="menu-body">
<span class="name">${esc(name)}</span>${badge}${it.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}
${desc ? `<p class="desc">${esc(desc)}</p>` : ""}
</div>${it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</div>`;
  }).join("")
}</div>`).join("")}
</div></section>`;

    case "gallery": {
      const imgs = s.imageIds
        .map((i) => ({ id: i, url: imageUrl(i, opts) }))
        .filter((x): x is { id: string; url: string } => Boolean(x.url));
      if (!imgs.length) return "";
      const layout = s.layout ?? "grid";
      const figures = imgs
        .map((im) => {
          const meta = imageAttrs(site, im.id, "gallery");
          return `<figure class="${meta.ratioClass}"><img src="${esc(im.url)}" alt="${esc(
            row(im.id, "alt"),
          )}" ${meta.attrs} style="${meta.style}"></figure>`;
        })
        .join("");
      // A mosaic gives the first image real weight; a strip suits two or three
      // pictures that would look stranded in a grid.
      const cls = layout === "mosaic" ? "thumbs mosaic" : layout === "strip" ? "thumbs strip" : "thumbs";
      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
<div class="${cls}">${figures}</div>
</div></section>`;
    }

    case "hours":
      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
<div>${s.rows.map((r) => `<div class="hours-row"><span>${esc(row(r.id, "day"))}</span><span class="muted">${esc(r.hours)}</span></div>`).join("")}</div>
${str("note") ? `<p class="muted" style="margin-top:1rem">${esc(str("note"))}</p>` : ""}
</div></section>`;

    case "testimonials": {
      const layout = s.layout ?? "cards";
      const quote = (it: (typeof s.items)[number], cls = "") =>
        `<figure class="${cls}" style="margin:0">
<blockquote>${esc(row(it.id, "quote"))}</blockquote>
<figcaption class="muted" style="margin-top:.75rem">— ${esc(row(it.id, "author"))}</figcaption>
</figure>`;

      // One review is a quote, not a grid of one — and a formal business reads
      // better with its reviews set as a ruled list than as floating cards.
      const bodyHtml =
        layout === "cards"
          ? `<div class="grid two">${s.items.map((it) => quote(it, "card")).join("")}</div>`
          : layout === "statement"
            ? `<div class="lay-statement">${s.items.slice(0, 1).map((it) => quote(it)).join("")}</div>`
            : layout === "band"
              ? `<div class="lay-band">${s.items.map((it) => quote(it)).join("")}</div>`
              : layout === "list"
                ? `<div class="lay-list">${s.items.map((it) => quote(it)).join("")}</div>`
                : `<div class="lay-inline">${s.items.map((it) => quote(it)).join("")}</div>`;

      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
${bodyHtml}
</div></section>`;
    }

    case "cta": {
      // The full-width coloured band is one option, not the only one. A quiet
      // business gets the same invitation set inline, which is what a designer
      // would do rather than shouting once near the footer.
      const inline = s.layout === "inline";
      return `<section class="${inline ? "cta-inline" : "cta-band"}" id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2><p>${esc(str("body"))}</p>
${str("ctaLabel") ? `<div class="btns"><a class="btn" href="${safeHref(s.ctaHref)}">${esc(str("ctaLabel"))}</a></div>` : ""}
</div></section>`;
    }

    case "contact":
      return `<section id="${id}" aria-labelledby="${id}-h"><div class="wrap">
<h2 id="${id}-h">${esc(str("heading"))}</h2>
<ul class="contact-list">
${s.phone ? `<li><a href="tel:${esc(s.phone.replace(/[^\d+]/g, ""))}"><span aria-hidden="true">📞</span><span>${esc(s.phone)}</span></a></li>` : ""}
${s.email ? `<li><a href="mailto:${esc(s.email)}"><span aria-hidden="true">✉️</span><span>${esc(s.email)}</span></a></li>` : ""}
${str("address")
  // Without a map link there is nowhere for the address to go, and a link to
  // "#" is a tap that does nothing — worse than plain text.
  ? s.mapsUrl
    ? `<li><a href="${safeHref(s.mapsUrl)}" target="_blank" rel="noopener"><span aria-hidden="true">📍</span><span>${esc(str("address"))}</span></a></li>`
    : `<li><span aria-hidden="true">📍</span><span>${esc(str("address"))}</span></li>`
  : ""}
</ul>
${s.bookingUrl && str("bookingLabel") ? `<div class="btns" style="margin-top:1.5rem"><a class="btn" href="${safeHref(s.bookingUrl)}">${esc(str("bookingLabel"))}</a></div>` : ""}
</div></section>`;

    case "footer":
      return "";
  }
}

/* --------------------------------------------------- language + metadata */

function languageSwitcher(
  site: Site,
  locale: Locale,
  opts: RenderOptions,
  variant: "inline" | "banner",
): string {
  // One enabled language means no switcher at all (requirement 10).
  if (site.meta.locales.length < 2) return "";

  const href = (l: Locale) => (opts.localeHref ? opts.localeHref(l) : `../${l}/`);
  const cls = variant === "banner" ? "lang-banner" : "lang";
  const items = site.meta.locales.map((l, i) => {
    const info = localeInfo(l);
    const current = l === locale;
    const label = variant === "banner" ? `${info.flag} ${info.short}` : info.short;
    return `${i > 0 && variant === "inline" ? '<span class="sep" aria-hidden="true">/</span>' : ""}<a data-lang-link href="${esc(href(l))}" hreflang="${esc(l)}" lang="${esc(l)}"${
      current ? ' aria-current="true"' : ""
    } title="${esc(info.native)}"><span aria-hidden="true">${esc(label)}</span><span class="skip" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">${esc(info.native)}</span></a>`;
  });

  return `<nav class="${cls}" aria-label="Language">${items.join("")}</nav>`;
}

/** JSON-LD. Only fields that actually exist are emitted — never invented. */
function structuredData(site: Site, locale: Locale, opts: RenderOptions): string {
  // Built by the SEO engine, which includes only what the research verified:
  // no ratings, no unconfirmed opening hours, no invented address.
  const data = buildStructuredData(
    { site, locale, facts: site.meta.facts ?? null },
    {
      canonical: opts.canonical,
      logoUrl: site.meta.logo && opts.assetUrl ? opts.assetUrl(site.meta.logo.assetId) : undefined,
      imageUrls: (site.images ?? [])
        .filter((p) => p.role === "hero" || p.role === "gallery" || p.role === "showcase")
        .map((p) => (opts.assetUrl ? opts.assetUrl(p.assetId) : `/api/assets/${p.assetId}`))
        .filter(Boolean),
    },
  );

  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/* -------------------------------------------------------------- entry point */

export function renderSite(site: Site, opts: RenderOptions = {}): string {
  const locale = opts.locale && site.meta.locales.includes(opts.locale)
    ? opts.locale
    : site.meta.defaultLocale;
  const info = localeInfo(locale);
  const a = architecture(site.theme.architecture);
  const seo = site.i18n[locale]?.seo;

  const links = navLinks(site, locale);
  const sticky = site.meta.stickyCta;
  const stickyLabel = t(site, locale, key.meta("stickyCtaLabel"));
  // A menu never gets a sticky bar: nothing may cover the prices.
  const isMenu = site.meta.kind === "menu" || a.nav === "none";
  const hasSticky = sticky.enabled && stickyLabel && !isMenu;

  const title = seo?.title || site.meta.businessName;
  const description = seo?.description || "";
  const localeHref = (l: Locale) => (opts.localeHref ? opts.localeHref(l) : `../${l}/`);

  const logoUrl = site.meta.logo ? imageUrl(site.meta.logo.assetId, opts) : null;
  const logoAlt = t(site, locale, key.meta("logoAlt")) || site.meta.businessName;

  const brand = logoUrl
    ? `<a class="brand" href="#main"><img src="${esc(logoUrl)}" alt="${esc(logoAlt)}" style="max-height:${Math.max(24, site.meta.logo!.height)}px"><span class="skip" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">${esc(site.meta.businessName)}</span></a>`
    : `<a class="brand" href="#main">${esc(site.meta.businessName)}</a>`;

  const footer = site.sections.find((s) => s.type === "footer");
  const footerHtml = footer && footer.type === "footer" && footer.visible
    ? `<footer id="${esc(footer.id)}"><div class="wrap">
<p style="margin:0;font-weight:650;color:var(--text)">${esc(site.meta.businessName)}</p>
${t(site, locale, key.section(footer.id, "tagline")) ? `<p style="margin:.25rem 0 0">${esc(t(site, locale, key.section(footer.id, "tagline")))}</p>` : ""}
${footer.links.length ? `<nav class="links" aria-label="Footer">${
  footer.links.map((l) => `<a href="${safeHref(l.href)}">${esc(t(site, locale, key.row(footer.id, l.id, "label")))}</a>`).join("")
}</nav>` : ""}
${languageSwitcher(site, locale, opts, "inline")}
<p style="margin-top:1.5rem;font-size:.8125rem">© ${new Date().getFullYear()} ${esc(site.meta.businessName)}</p>
</div></footer>`
    // Every generated website must have a footer (requirement 8).
    : `<footer><div class="wrap"><p style="margin:0;font-weight:650;color:var(--text)">${esc(site.meta.businessName)}</p>
${languageSwitcher(site, locale, opts, "inline")}
<p style="margin-top:1.5rem;font-size:.8125rem">© ${new Date().getFullYear()} ${esc(site.meta.businessName)}</p></div></footer>`;

  const body = site.sections.map((s) => renderSection(s, site, locale, opts)).join("\n");

  const header = isMenu
    ? languageSwitcher(site, locale, opts, "banner")
    : `<header class="site-header">
<input type="checkbox" id="nav-open" aria-hidden="true" tabindex="-1">
<div class="wrap">
  <div class="bar">
    ${brand}
    <div class="header-actions">
      <nav class="nav-desktop" aria-label="Primary">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav>
      ${languageSwitcher(site, locale, opts, "inline")}
      ${links.length ? `<label class="nav-toggle" for="nav-open" aria-label="${esc(t(site, locale, key.meta("menuLabel")) || "Menu")}" role="button" tabindex="0">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </label>` : ""}
    </div>
  </div>
  ${links.length ? `<nav class="nav-mobile" aria-label="Primary mobile">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav>` : ""}
</div>
</header>`;

  // hreflang for every enabled language plus x-default (requirement 16).
  const alternates = site.meta.locales
    .map((l) => `<link rel="alternate" hreflang="${esc(l)}" href="${esc(localeHref(l))}">`)
    .concat(
      `<link rel="alternate" hreflang="x-default" href="${esc(localeHref(site.meta.defaultLocale))}">`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="${esc(locale)}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
${seo?.keywords?.length ? `<meta name="keywords" content="${esc(seo.keywords.join(", "))}">` : ""}
<meta name="theme-color" content="${esc(site.theme.colors.primary)}">
${heroPreload(site, opts)}
${fontLinks(site)}
<meta name="robots" content="index, follow">
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ""}
${alternates}
<meta property="og:type" content="website">
<meta property="og:locale" content="${esc(locale)}">
${site.meta.locales.filter((l) => l !== locale).map((l) => `<meta property="og:locale:alternate" content="${esc(l)}">`).join("\n")}
<meta property="og:title" content="${esc(seo?.ogTitle || title)}">
${seo?.ogDescription || description ? `<meta property="og:description" content="${esc(seo?.ogDescription || description)}">` : ""}
${opts.canonical ? `<meta property="og:url" content="${esc(opts.canonical)}">` : ""}
${logoUrl ? `<meta property="og:image" content="${esc(logoUrl)}">` : ""}
<meta name="twitter:card" content="${logoUrl ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(seo?.ogTitle || title)}">
${seo?.ogDescription || description ? `<meta name="twitter:description" content="${esc(seo?.ogDescription || description)}">` : ""}
${logoUrl ? `<link rel="icon" href="${esc(logoUrl)}">` : ""}
<style>${styles(site, a, info.dir)}</style>
${structuredData(site, locale, opts)}
</head>
<body class="${hasSticky ? "has-sticky" : ""}">
<a href="#main" class="btn skip">${esc(t(site, locale, key.meta("skipToContent")) || "Skip to content")}</a>
${header}
<main id="main">
${body}
</main>
${footerHtml}
${hasSticky ? `<div class="sticky-cta"><a class="btn" href="${safeHref(sticky.href)}">${esc(stickyLabel)}</a></div>` : ""}
${langMemoryScript(site)}
</body>
</html>`;
}


/**
 * Remembers the visitor's language choice (requirement 15).
 *
 * Deliberately minimal and non-essential: each language is already its own
 * fully-rendered document, so this only records a preference on click. It
 * never swaps text, never blocks rendering, and never redirects a visitor who
 * asked for a specific language — that would fight both the user and the
 * crawler. The root document is what acts on the stored value.
 */
function langMemoryScript(site: Site): string {
  if (site.meta.locales.length < 2) return "";
  return `<script>(function(){try{
var ls=document.querySelectorAll('[data-lang-link]');
for(var i=0;i<ls.length;i++){ls[i].addEventListener('click',function(){
  try{localStorage.setItem('wg-lang',this.getAttribute('hreflang'));}catch(e){}
});}
}catch(e){}})();</script>`;
}

/** robots.txt for an exported/deployed site. */
export function renderRobots(sitemapUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

/** A sitemap with one entry per enabled language, cross-linked with hreflang. */
export function renderSitemap(site: Site, localeUrl: (l: Locale) => string): string {
  const now = new Date().toISOString().slice(0, 10);
  const entries = site.meta.locales
    .map(
      (l) => `  <url>
    <loc>${esc(localeUrl(l))}</loc>
    <lastmod>${now}</lastmod>
${site.meta.locales
  .map((alt) => `    <xhtml:link rel="alternate" hreflang="${esc(alt)}" href="${esc(localeUrl(alt))}"/>`)
  .join("\n")}
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(localeUrl(site.meta.defaultLocale))}"/>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
}
