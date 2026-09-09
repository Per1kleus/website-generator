import { getCurrentUser } from "@/server/auth";
import { getProject, getVersionSite } from "@/server/projects";
import { renderSite } from "@/lib/render";

/**
 * Serves the real generated website as HTML for the preview iframe.
 * This is the exact artefact that gets exported and deployed — the preview is
 * never a React re-implementation of the design.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  const params = new URL(req.url).searchParams;
  const versionId = params.get("version");
  const site = versionId ? getVersionSite(versionId, id) : project.site;
  if (!site) return new Response("This project has not been generated yet.", { status: 404 });

  const requested = params.get("locale") ?? "";
  const locale = site.meta.locales.includes(requested) ? requested : site.meta.defaultLocale;

  const html = renderSite(site, {
    locale,
    assetUrl: (assetId) => `/api/assets/${assetId}`,
    // Inside the preview, switching language reloads this same endpoint, so
    // the switcher is exercised for real rather than mocked.
    localeHref: (l) =>
      `/api/projects/${id}/render?locale=${encodeURIComponent(l)}${versionId ? `&version=${encodeURIComponent(versionId)}` : ""}`,
  });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const dynamic = "force-dynamic";
