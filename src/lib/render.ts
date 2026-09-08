import { fontStack, type Section, type Site } from "./site";

/**
 * Renders a Site document to a standalone, mobile-first HTML page.
 *
 * Design rules encoded here (requirements 14-21) apply to EVERY generated site:
 *  - one fluid column on phones; multi-column only where there is room for it
 *  - `clamp()` typography so text scales with the viewport, never a fixed px
 *  - 44px minimum touch targets on every link and button
 *  - safe-area insets on the sticky header and the sticky mobile CTA
 *  - lazy-loaded, aspect-ratio-boxed images (no layout shift on slow networks)
 *  - no JS at all unless the page has a nav to toggle, and none for menus
 */

const esc = (s: string): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Attribute-safe URL: blocks javascript:/data: hrefs coming from AI or user input. */
function safeHref(raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) return "#";
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(v)) return esc(v);
  return "#";
}

export type RenderOptions = {
  /** Maps asset id -> URL. Preview uses /api URLs; export uses relative paths. */
  assetUrl?: (id: string) => string;
  /** Emitted into <title>/meta; preview passes the live origin. */
  baseUrl?: string;
};

function imageUrl(id: string, opts: RenderOptions): string | null {
  if (!id) return null;
  const url = opts.assetUrl ? opts.assetUrl(id) : `/api/assets/${id}`;
  return url || null;
}

const density = {
  minimal: { block: "3.5rem", gap: "1.25rem" },
  balanced: { block: "2.75rem", gap: "1rem" },
  dense: { block: "2rem", gap: "0.75rem" },
} as const;

function styles(site: Site): string {
  const t = site.theme;
  const d = density[t.layout] ?? density.balanced;
  return `
:root{
  --primary:${esc(t.colors.primary)};
  --secondary:${esc(t.colors.secondary)};
  --accent:${esc(t.colors.accent)};
  --bg:${esc(t.colors.bg)};
  --text:${esc(t.colors.text)};
  --muted:color-mix(in srgb, ${esc(t.colors.text)} 62%, ${esc(t.colors.bg)});
  --line:color-mix(in srgb, ${esc(t.colors.text)} 14%, ${esc(t.colors.bg)});
  --card:color-mix(in srgb, ${esc(t.colors.bg)} 92%, ${esc(t.colors.text)});
  --radius:${Number(t.radius) || 12}px;
  --block:${d.block};
  --gap:${d.gap};
  --safe-t:env(safe-area-inset-top,0px);
  --safe-b:env(safe-area-inset-bottom,0px);
  --safe-l:env(safe-area-inset-left,0px);
  --safe-r:env(safe-area-inset-right,0px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;background:var(--bg);color:var(--text);
  font-family:${fontStack(t.fonts.body)};
  /* Fluid body copy: readable at 320px, comfortable on a desktop. */
  font-size:clamp(1rem,0.96rem + 0.2vw,1.125rem);
  line-height:1.6;overflow-x:hidden;
}
h1,h2,h3{font-family:${fontStack(t.fonts.heading)};line-height:1.15;margin:0 0 .5em;text-wrap:balance}
h1{font-size:clamp(1.9rem,1.35rem + 2.6vw,3.5rem)}
h2{font-size:clamp(1.45rem,1.15rem + 1.5vw,2.25rem)}
h3{font-size:clamp(1.1rem,1rem + .6vw,1.375rem)}
p{margin:0 0 1em;text-wrap:pretty}
img{max-width:100%;height:auto;display:block}
a{color:var(--primary)}

/* Content column: fluid gutters that respect notches in landscape. */
.wrap{
  width:100%;max-width:72rem;margin-inline:auto;
  padding-inline:max(1.25rem,var(--safe-l),var(--safe-r));
}
section{padding-block:var(--block)}
.eyebrow{
  font-size:.8125rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--primary);font-weight:700;margin:0 0 .75rem;
}
.muted{color:var(--muted)}

/* Every button clears 44px in both axes and never sits against a screen edge. */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.5rem;
  min-height:3rem;padding:.75rem 1.5rem;border-radius:var(--radius);
  font-weight:650;text-decoration:none;border:1px solid transparent;
  background:var(--primary);color:var(--bg);
  transition:transform .12s ease,filter .12s ease;
}
.btn:active{transform:scale(.98)}
.btn.ghost{background:transparent;color:var(--primary);border-color:var(--line)}
.btns{display:flex;flex-wrap:wrap;gap:.75rem}
/* On the narrowest phones the buttons go full-width and stack. */
@media (max-width:26rem){ .btns .btn{flex:1 1 100%} }

/* Sticky header stays clear of the notch and is thumb-sized. */
.site-header{
  position:sticky;top:0;z-index:50;
  background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:saturate(180%) blur(12px);
  border-bottom:1px solid var(--line);
  padding-top:var(--safe-t);
}
.site-header .bar{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  min-height:3.5rem;
}
.brand{font-weight:750;font-size:1.0625rem;text-decoration:none;color:var(--text)}
.nav-desktop{display:none}
@media (min-width:48rem){
  .nav-desktop{display:flex;gap:1.5rem}
  .nav-desktop a{
    text-decoration:none;color:var(--text);font-weight:550;
    display:inline-flex;align-items:center;min-height:2.75rem;
  }
  .nav-toggle{display:none}
}
/* Phone menu: a checkbox-driven disclosure, no JavaScript required. */
.nav-toggle{
  display:inline-flex;align-items:center;justify-content:center;
  width:2.75rem;height:2.75rem;border:1px solid var(--line);
  border-radius:var(--radius);background:transparent;color:var(--text);cursor:pointer;
}
#nav-open{position:absolute;opacity:0;pointer-events:none}
.nav-mobile{display:none;padding-bottom:.75rem}
#nav-open:checked ~ .wrap .nav-mobile{display:block}
.nav-mobile a{
  display:flex;align-items:center;min-height:3rem;
  padding:0 .25rem;text-decoration:none;color:var(--text);
  border-top:1px solid var(--line);font-weight:550;
}
@media (min-width:48rem){ .nav-mobile{display:none!important} }

/* Cards stack on phones and only become a grid when there is real room. */
.grid{display:grid;gap:var(--gap);grid-template-columns:1fr}
@media (min-width:40rem){ .grid.two{grid-template-columns:repeat(2,1fr)} }
@media (min-width:64rem){ .grid.three{grid-template-columns:repeat(3,1fr)} }
.card{
  background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:1.25rem;
}

.hero{padding-block:calc(var(--block) * 1.15)}
.hero-media{
  margin-top:1.5rem;border-radius:var(--radius);overflow:hidden;
  aspect-ratio:4/3;background:var(--card);
}
/* A tall crop suits a phone; widen the crop once there is horizontal room. */
@media (min-width:48rem){ .hero-media{aspect-ratio:16/9} }
.hero-media img{width:100%;height:100%;object-fit:cover}
@media (min-width:64rem){
  .hero .wrap{display:grid;grid-template-columns:1.1fr 1fr;gap:2.5rem;align-items:center}
  .hero-media{margin-top:0}
}

.thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:.5rem}
@media (min-width:48rem){ .thumbs{grid-template-columns:repeat(3,1fr);gap:.75rem} }
.thumbs figure{margin:0;aspect-ratio:1;border-radius:var(--radius);overflow:hidden;background:var(--card)}
.thumbs img{width:100%;height:100%;object-fit:cover}

/* Menus: a plain list. Fastest possible path from QR scan to price. */
.menu-cat{margin-bottom:2rem}
.menu-cat h3{
  position:sticky;top:3.5rem;z-index:5;margin:0 0 .25rem;
  padding:.5rem 0;background:var(--bg);border-bottom:2px solid var(--primary);
}
.menu-item{
  display:flex;gap:1rem;justify-content:space-between;align-items:baseline;
  padding:.85rem 0;border-bottom:1px solid var(--line);
}
.menu-item .name{font-weight:650}
.menu-item .desc{color:var(--muted);font-size:.9375rem;margin:.2rem 0 0}
.menu-item .price{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.menu-jump{
  display:flex;gap:.5rem;overflow-x:auto;padding:.75rem 0;
  scroll-snap-type:x proximity;scrollbar-width:none;
}
.menu-jump::-webkit-scrollbar{display:none}
.menu-jump a{
  flex:0 0 auto;scroll-snap-align:start;text-decoration:none;
  display:inline-flex;align-items:center;min-height:2.75rem;
  padding:0 1rem;border:1px solid var(--line);border-radius:999px;
  color:var(--text);font-weight:600;font-size:.9375rem;
}
.tag{
  display:inline-block;font-size:.75rem;padding:.15rem .5rem;margin-left:.35rem;
  border:1px solid var(--line);border-radius:999px;color:var(--muted);
}

.hours-row{
  display:flex;justify-content:space-between;gap:1rem;
  padding:.75rem 0;border-bottom:1px solid var(--line);
}
blockquote{margin:0;font-size:1.0625rem}
.cta-band{background:var(--primary);color:var(--bg)}
.cta-band h2,.cta-band p{color:var(--bg)}
.cta-band .btn{background:var(--bg);color:var(--primary)}

.contact-list{list-style:none;margin:0;padding:0}
.contact-list a{
  display:flex;align-items:center;gap:.75rem;min-height:3.25rem;
  text-decoration:none;color:var(--text);border-bottom:1px solid var(--line);
}

footer{
  border-top:1px solid var(--line);padding-block:2rem;
  padding-bottom:calc(2rem + var(--safe-b));color:var(--muted);font-size:.9375rem;
}
footer .links{display:flex;flex-wrap:wrap;gap:1rem;margin-top:.75rem}
footer .links a{display:inline-flex;align-items:center;min-height:2.75rem}

/* Sticky mobile action bar: the primary conversion path on a phone.
   It is hidden on large screens where the header CTA is already visible. */
.sticky-cta{
  position:fixed;left:0;right:0;bottom:0;z-index:60;
  padding:.75rem max(1rem,var(--safe-l)) calc(.75rem + var(--safe-b)) max(1rem,var(--safe-r));
  background:color-mix(in srgb,var(--bg) 92%,transparent);
  backdrop-filter:blur(12px);border-top:1px solid var(--line);
}
.sticky-cta .btn{width:100%}
body.has-sticky{padding-bottom:5.5rem}
@media (min-width:48rem){
  .sticky-cta{display:none}
  body.has-sticky{padding-bottom:0}
}

@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}
}
@media print{ .site-header,.sticky-cta{display:none} }
`.trim();
}

function navLinks(site: Site): { href: string; label: string }[] {
  return site.sections
    .filter((s) => s.visible && s.type !== "hero" && s.type !== "footer")
    .map((s) => ({ href: `#${s.id}`, label: s.title }));
}

function renderSection(s: Section, site: Site, opts: RenderOptions): string {
  if (!s.visible) return "";
  const id = esc(s.id);

  switch (s.type) {
    case "hero": {
      const img = imageUrl(s.props.imageId, opts);
      return `<section class="hero" id="${id}" aria-label="${esc(s.title)}"><div class="wrap"><div>
${s.props.eyebrow ? `<p class="eyebrow">${esc(s.props.eyebrow)}</p>` : ""}
<h1>${esc(s.props.headline)}</h1>
<p class="muted">${esc(s.props.subheadline)}</p>
<div class="btns">
${s.props.ctaLabel ? `<a class="btn" href="${safeHref(s.props.ctaHref)}">${esc(s.props.ctaLabel)}</a>` : ""}
${s.props.secondaryLabel ? `<a class="btn ghost" href="${safeHref(s.props.secondaryHref)}">${esc(s.props.secondaryLabel)}</a>` : ""}
</div></div>
${img ? `<div class="hero-media"><img src="${esc(img)}" alt="" width="1200" height="900" fetchpriority="high" decoding="async"></div>` : ""}
</div></section>`;
    }

    case "about": {
      const img = imageUrl(s.props.imageId, opts);
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
${s.props.body.split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}
${img ? `<div class="hero-media"><img src="${esc(img)}" alt="" loading="lazy" decoding="async" width="1200" height="900"></div>` : ""}
${s.props.highlights.length ? `<ul class="grid two" style="list-style:none;padding:0;margin-top:1.5rem">${
  s.props.highlights.map((h) => `<li class="card">${esc(h)}</li>`).join("")
}</ul>` : ""}
</div></section>`;
    }

    case "services":
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
${s.props.intro ? `<p class="muted">${esc(s.props.intro)}</p>` : ""}
<div class="grid two">${s.props.items.map((it) => `<article class="card">
<h3>${esc(it.name)}</h3><p class="muted">${esc(it.description)}</p>
${it.price ? `<p style="font-weight:700;margin:0">${esc(it.price)}</p>` : ""}
</article>`).join("")}</div>
</div></section>`;

    case "menu":
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
${s.props.note ? `<p class="muted">${esc(s.props.note)}</p>` : ""}
${s.props.categories.length > 1 ? `<nav class="menu-jump" aria-label="Menu categories">${
  s.props.categories.map((c, i) => `<a href="#cat-${i}">${esc(c.name)}</a>`).join("")
}</nav>` : ""}
${s.props.categories.map((c, i) => `<div class="menu-cat"><h3 id="cat-${i}">${esc(c.name)}</h3>${
  c.items.map((it) => `<div class="menu-item"><div>
<span class="name">${esc(it.name)}</span>${it.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
${it.description ? `<p class="desc">${esc(it.description)}</p>` : ""}
</div><span class="price">${esc(it.price)}</span></div>`).join("")
}</div>`).join("")}
</div></section>`;

    case "gallery": {
      const imgs = s.props.imageIds.map((i) => imageUrl(i, opts)).filter(Boolean) as string[];
      if (!imgs.length) return "";
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
<div class="thumbs">${imgs.map((u) => `<figure><img src="${esc(u)}" alt="" loading="lazy" decoding="async" width="600" height="600"></figure>`).join("")}</div>
</div></section>`;
    }

    case "hours":
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
<div>${s.props.rows.map((r) => `<div class="hours-row"><span>${esc(r.day)}</span><span class="muted">${esc(r.hours)}</span></div>`).join("")}</div>
${s.props.note ? `<p class="muted" style="margin-top:1rem">${esc(s.props.note)}</p>` : ""}
</div></section>`;

    case "testimonials":
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
<div class="grid two">${s.props.items.map((t) => `<figure class="card" style="margin:0">
<blockquote>“${esc(t.quote)}”</blockquote>
<figcaption class="muted" style="margin-top:.75rem">— ${esc(t.author)}</figcaption>
</figure>`).join("")}</div>
</div></section>`;

    case "cta":
      return `<section class="cta-band" id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2><p>${esc(s.props.body)}</p>
${s.props.ctaLabel ? `<div class="btns"><a class="btn" href="${safeHref(s.props.ctaHref)}">${esc(s.props.ctaLabel)}</a></div>` : ""}
</div></section>`;

    case "contact":
      return `<section id="${id}"><div class="wrap">
<h2>${esc(s.props.heading)}</h2>
<ul class="contact-list">
${s.props.phone ? `<li><a href="tel:${esc(s.props.phone.replace(/[^\d+]/g, ""))}"><span aria-hidden="true">📞</span><span>${esc(s.props.phone)}</span></a></li>` : ""}
${s.props.email ? `<li><a href="mailto:${esc(s.props.email)}"><span aria-hidden="true">✉️</span><span>${esc(s.props.email)}</span></a></li>` : ""}
${s.props.address ? `<li><a href="${safeHref(s.props.mapsUrl || "#")}"><span aria-hidden="true">📍</span><span>${esc(s.props.address)}</span></a></li>` : ""}
</ul>
${s.props.bookingUrl ? `<div class="btns" style="margin-top:1.5rem"><a class="btn" href="${safeHref(s.props.bookingUrl)}">Book now</a></div>` : ""}
</div></section>`;

    case "footer":
      return `<footer id="${id}"><div class="wrap">
<p style="margin:0;font-weight:650;color:var(--text)">${esc(s.props.businessName)}</p>
<p style="margin:.25rem 0 0">${esc(s.props.tagline)}</p>
${s.props.links.length ? `<nav class="links" aria-label="Footer">${
  s.props.links.map((l) => `<a href="${safeHref(l.href)}">${esc(l.label)}</a>`).join("")
}</nav>` : ""}
<p style="margin-top:1.5rem;font-size:.8125rem">© ${new Date().getFullYear()} ${esc(s.props.businessName)}</p>
</div></footer>`;
  }
}

export function renderSite(site: Site, opts: RenderOptions = {}): string {
  const links = navLinks(site);
  const sticky = site.meta.stickyCta;
  const hasSticky = sticky?.enabled && sticky.label;
  // A digital menu is deliberately chrome-free: no nav, no sticky CTA. The
  // guest scanned a QR code to read prices, so nothing may delay that.
  const isMenu = site.meta.kind === "menu";

  const body = site.sections.map((s) => renderSection(s, site, opts)).join("\n");

  return `<!doctype html>
<html lang="${esc(site.meta.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(site.meta.businessName)}${site.meta.tagline ? ` — ${esc(site.meta.tagline)}` : ""}</title>
<meta name="description" content="${esc(site.meta.description).slice(0, 300)}">
<meta name="theme-color" content="${esc(site.theme.colors.primary)}">
<meta property="og:title" content="${esc(site.meta.businessName)}">
<meta property="og:description" content="${esc(site.meta.description).slice(0, 300)}">
<meta property="og:type" content="website">
<style>${styles(site)}</style>
</head>
<body class="${hasSticky && !isMenu ? "has-sticky" : ""}">
<a href="#main" class="btn" style="position:absolute;left:-9999px;top:0;z-index:99" onfocus="this.style.left='1rem'" onblur="this.style.left='-9999px'">Skip to content</a>
${isMenu ? "" : `<header class="site-header">
<input type="checkbox" id="nav-open" aria-hidden="true" tabindex="-1">
<div class="wrap">
  <div class="bar">
    <a class="brand" href="#main">${esc(site.meta.businessName)}</a>
    <nav class="nav-desktop" aria-label="Primary">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav>
    <label class="nav-toggle" for="nav-open" aria-label="Toggle menu" role="button" tabindex="0">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </label>
  </div>
  <nav class="nav-mobile" aria-label="Primary mobile">${links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav>
</div>
</header>`}
<main id="main">
${body}
</main>
${hasSticky && !isMenu ? `<div class="sticky-cta"><a class="btn" href="${safeHref(sticky.href)}">${esc(sticky.label)}</a></div>` : ""}
</body>
</html>`;
}
