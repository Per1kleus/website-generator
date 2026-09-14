import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import {
  createPreview, listPreviews, resolveResponse, revokePreview,
} from "@/server/client-preview";

/**
 * The creator's side of client preview: make a link, see what came back,
 * withdraw one.
 *
 * Every route here proves ownership through `getProject(id, user.id)` before
 * touching anything, and every mutation is scoped by project id in the query
 * itself rather than by a check the caller could skip.
 */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ previews: listPreviews(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    previewId?: string;
    responseId?: string;
    label?: string;
  };

  if (body.action === "revoke") {
    if (!body.previewId) return NextResponse.json({ error: "Which link?" }, { status: 400 });
    revokePreview(body.previewId, id);
    return NextResponse.json({ ok: true, previews: listPreviews(id) });
  }

  if (body.action === "resolve") {
    if (!body.responseId) return NextResponse.json({ error: "Which note?" }, { status: 400 });
    resolveResponse(body.responseId, id);
    return NextResponse.json({ ok: true, previews: listPreviews(id) });
  }

  if (!project.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const preview = createPreview(id, typeof body.label === "string" ? body.label.slice(0, 80) : "");
  if (!preview) {
    return NextResponse.json(
      { error: "This project has no saved version to share yet." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, preview, previews: listPreviews(id) });
}

export const dynamic = "force-dynamic";
