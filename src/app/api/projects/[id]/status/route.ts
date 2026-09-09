import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { getLatestJob } from "@/server/jobs";

/**
 * The single source of truth for "how is my generation going".
 * The progress screen polls this, so a user who locked their phone mid-run
 * sees the real backend state on return rather than a restarted animation.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  return NextResponse.json({
    status: project.status,
    // The workspace sidebar labels itself from these, and shows the menu
    // screen only for a Digital Menu project.
    name: project.business_name,
    kind: project.site_kind,
    job: getLatestJob(id),
  });
}

export const dynamic = "force-dynamic";
