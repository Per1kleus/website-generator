import { getCurrentUser } from "@/server/auth";
import { getProject, getProjectForPreview, getVersionSite } from "@/server/projects";
import { mintPreviewToken, readPreviewToken } from "@/server/preview-token";
import { renderSite } from "@/lib/render";

/**
 * The generated website, served as HTML for the preview.
 *
 * This is the same `renderSite()` that `server/bundle.ts` calls to produce the
 * exported ZIP and the published site, given the same site document. There is
 * no preview-specific renderer and no simplified preview model: what the
 * creator sees here is the artefact, differing only in where its links point
 * (see `PREVIEW.md`).
 *
 * The response is deliberately locked down. The frame that shows it has no
 * origin of its own, so the document cannot touch this application's cookies,
 * storage, DOM or APIs; the Content-Security-Policy below closes the network
 * off as well. What the page legitimately needs — its own photographs, and the
 * next page when someone uses the language switcher — is authorised instead by
 * a preview token that names one project and can only read (see
 * `server/preview-token.ts`).
 */

/**
 * What the generated page is allowed to do.
 *
 *   default-src 'self'      images and fonts from this origin, nothing else
 *   script-src 'unsafe-inline'
 *                           the page's own inline script (the language
 *                           switcher's localStorage note) runs; no external
 *                           script can be loaded, because no host is allowed
 *   connect-src 'none'      the decisive one: fetch, XHR, WebSocket and
 *                           sendBeacon are all refused, so the page cannot
 *                           call a builder endpoint even though it shares the
 *                           origin and the session cookie
 *   form-action 'none'      nothing can be POSTed anywhere (the renderer emits
 *                           no forms at all, so this costs nothing)
 *   frame-src / object-src / worker-src 'none'
 *                           no nested browsing contexts to escape through
 *   base-uri 'none'         a <base> tag cannot re-point the page's relative
 *                           URLs at somewhere else
 *   frame-ancestors 'self'  only this application may frame it
 *
 * Web fonts are the one outside request a generated site legitimately makes,
 * so Google Fonts is allowed for stylesheets and font files and nothing else.
 */
const FONT_CDN = "https://fonts.googleapis.com https://fonts.gstatic.com";
const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'unsafe-inline'",
  `style-src 'self' 'unsafe-inline' ${FONT_CDN}`,
  `font-src 'self' data: ${FONT_CDN}`,
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The preview must never show a stale document and claim it is current.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": PREVIEW_CSP,
      // The generated page never needs to know which builder screen framed it.
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * A failure the preview can show as a message rather than a blank frame.
 *
 * The frame has no origin, so the builder cannot read what came back by
 * inspecting it — the document has to say so itself. This page is builder
 * furniture and never touches a generated website: it is only ever returned
 * *instead of* one.
 */
function problem(message: string, status: number): Response {
  const text = message.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string,
  );
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview unavailable</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;
font:500 15px/1.5 system-ui,sans-serif;color:#52525b;background:#fafafa;padding:1.5rem;text-align:center}</style>
</head><body>
<p>${text}</p>
<script>try{parent.postMessage({source:"wg-preview",status:${status},message:${JSON.stringify(message)}},"*")}catch(e){}</script>
</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;

  // Two ways in, and only two. The builder frames this URL with the session
  // cookie attached; the framed page itself comes back for another language
  // carrying the preview token, because by then it has no cookies to send.
  const token = params.get("pt") ?? "";
  const viaToken = token ? readPreviewToken(token) === id : false;

  let project = null;
  if (viaToken) {
    project = getProjectForPreview(id);
  } else {
    const user = await getCurrentUser();
    if (!user) return problem("Not signed in", 401);
    project = getProject(id, user.id);
  }
  if (!project) return problem("Not found", 404);

  const versionId = params.get("version");
  const site = versionId ? getVersionSite(versionId, id) : project.site;
  if (!site) return problem("This project has not been generated yet.", 404);

  const requested = params.get("locale") ?? "";
  const locale = site.meta.locales.includes(requested) ? requested : site.meta.defaultLocale;

  // One token per response, handed to every URL the page will ask for. A
  // fresh one each time keeps the window short without the creator ever
  // noticing an expiry.
  const pt = viaToken ? token : mintPreviewToken(id);
  const version = versionId ? `&version=${encodeURIComponent(versionId)}` : "";

  try {
    const html = renderSite(site, {
      locale,
      assetUrl: (assetId) => `/api/assets/${assetId}?pt=${encodeURIComponent(pt)}`,
      // Switching language inside the preview navigates back to this same
      // endpoint, so the visitor-facing switcher is exercised for real rather
      // than mocked.
      localeHref: (l) =>
        `/api/projects/${id}/render?locale=${encodeURIComponent(l)}&pt=${encodeURIComponent(pt)}${version}`,
    });
    return htmlResponse(html);
  } catch (err) {
    // A site document the renderer cannot handle is a bug worth seeing, not a
    // blank panel. The creator gets a plain sentence; the detail goes to the
    // server log, where it is of use to someone who can act on it.
    console.error("[render] could not render the site document:", err);
    return problem("The website could not be rendered from its saved content.", 500);
  }
}

export const dynamic = "force-dynamic";
