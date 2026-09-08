import { getCurrentUser } from "@/server/auth";
import { getProject, getVersionSite } from "@/server/projects";
import { renderSite } from "@/lib/render";

/**
 * Serves the real generated website as HTML, for the preview iframe.
 * This is the actual artefact the user will export and deploy — the preview
 * is never a re-implementation of the design in React.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  const versionId = new URL(req.url).searchParams.get("version");
  const site = versionId ? getVersionSite(versionId, id) : project.site;
  if (!site) return new Response("This project has not been generated yet.", { status: 404 });

  const html = renderSite(site, { assetUrl: (assetId) => `/api/assets/${assetId}` });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The preview runs in a sandboxed iframe; belt and braces against the
      // generated page being framed anywhere else.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const dynamic = "force-dynamic";
