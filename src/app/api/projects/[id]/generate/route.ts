import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { getLatestJob, startGeneration } from "@/server/jobs";
import type { SiteKind } from "@/lib/site";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  // If a job is already running, return it instead of starting a second one:
  // the user may simply have re-opened the app.
  const existing = getLatestJob(id);
  if (existing && (existing.status === "running" || existing.status === "queued")) {
    return NextResponse.json({ ok: true, job: existing });
  }

  const job = startGeneration(id, {
    businessName: project.business_name,
    businessType: project.business_type,
    siteKind: project.site_kind as SiteKind,
    mapsUrl: project.maps_url,
    location: project.location,
    phone: project.phone,
    email: project.email,
    description: project.description,
    style: project.design.style ?? "classic",
    designNotes: project.design_notes ?? "",
    logoAssetId: project.logo_asset_id || null,
    defaultLocale: project.default_locale || "en",
    locales: project.locales,
    answers: project.designAnswers,
  });

  return NextResponse.json({ ok: true, job });
}

// Research, identity analysis, content and translation are all model calls.
export const maxDuration = 800;
