import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, saveVersion, updateProjectSite } from "@/server/projects";
import { aiEdit } from "@/server/ai-edit";
import { qaCheck } from "@/server/jobs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { instruction, sectionId } = (await req.json()) as {
    instruction?: string;
    sectionId?: string;
  };
  if (!instruction?.trim()) {
    return NextResponse.json({ error: "Tell me what to change." }, { status: 400 });
  }

  // Snapshot before the edit so "undo" is always one tap away on a phone.
  saveVersion(id, "Before AI edit", project.site);

  const result = await aiEdit(project.site, instruction.trim(), sectionId);
  if (result.changed) updateProjectSite(id, user.id, result.site);

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    summary: result.summary,
    site: result.site,
    warnings: qaCheck(result.site),
  });
}

// AI edits can take a while; give the route room beyond the platform default.
export const maxDuration = 300;
