import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, updateProjectSite } from "@/server/projects";
import { validateSiteDoc } from "@/server/ai-edit";
import { validateSite } from "@/server/validate";
import type { Site } from "@/lib/site";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ site: project.site });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json()) as { site: Site };
  if (!body?.site) return NextResponse.json({ error: "No site provided." }, { status: 400 });

  // Run the same validation the AI path uses: anything malformed falls back to
  // the stored document rather than corrupting the project.
  const site = validateSiteDoc(body.site, project.site);
  updateProjectSite(id, user.id, site);

  return NextResponse.json({ ok: true, site, warnings: validateSite(site).map((f) => f.message) });
}
