import { renderSite } from "@/lib/render";
import { resolvePreview } from "@/server/client-preview";

/**
 * The website a client sees, rendered from the version their link names.
 *
 * Public by design — there is no account for the client — so the token is the
 * whole of the authorisation, and everything else follows from being strict
 * about what travels with it:
 *
 *   - The project id never appears. Images are addressed through this same
 *     token rather than through `/api/assets/<id>`, so nothing in the page
 *     reveals which project, user or database row it came from.
 *   - The language switcher points back here, so switching language stays
 *     inside the client's capability instead of reaching a builder endpoint.
 *   - This is the same `renderSite` the builder preview and the publisher use.
 *     A second renderer for clients would eventually disagree with the real
 *     one, and the disagreement would be discovered by a client.
 */

const FONT_CDN = "https://fonts.googleapis.com https://fonts.gstatic.com";

const CLIENT_CSP = [
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

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const resolved = resolvePreview(token);

  // An unknown token, a withdrawn link and a deleted version are all the same
  // answer. Distinguishing them would tell whoever is guessing which guesses
  // were closer.
  if (!resolved) {
    return new Response("This preview link is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const { site } = resolved;
  const requested = new URL(req.url).searchParams.get("locale") ?? "";
  const locale = site.meta.locales.includes(requested as never)
    ? (requested as (typeof site.meta.locales)[number])
    : site.meta.defaultLocale;

  try {
    const html = renderSite(site, {
      locale,
      assetUrl: (assetId, width) =>
        `/api/p/${encodeURIComponent(token)}/asset/${encodeURIComponent(assetId)}${
          width ? `?w=${width}` : ""
        }`,
      localeHref: (l) => `/api/p/${encodeURIComponent(token)}/render?locale=${encodeURIComponent(l)}`,
    });

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": CLIENT_CSP,
        "Referrer-Policy": "no-referrer",
        // A preview link is not something to index.
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[client-preview] render failed:", err);
    return new Response("This website could not be displayed.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

export const dynamic = "force-dynamic";
