import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  deleteVersion, getProject, listVersions, restoreVersion, saveVersion,
} from "@/server/projects";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ versions: listVersions(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json()) as { action?: string; label?: string; versionId?: string };

  if (body.action === "restore" && body.versionId) {
    // The restored document arrives as a new version at the front of history.
    // Nothing earlier is removed and nothing later is discarded, so undoing a
    // rollback is just another rollback.
    const restored = restoreVersion(id, user.id, body.versionId);
    if (!restored) return NextResponse.json({ error: "Version not found." }, { status: 404 });
    return NextResponse.json({ ok: true, site: restored.site, version: restored.version });
  }

  if (body.action === "delete" && body.versionId) {
    deleteVersion(body.versionId, id);
    return NextResponse.json({ ok: true });
  }

  const label = (body.label ?? "").trim() || new Date().toLocaleString();
  const versionId = saveVersion(id, label, project.site);
  return NextResponse.json({ ok: true, versionId });
}
