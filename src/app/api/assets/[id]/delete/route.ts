import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/server/auth";
import { deleteAsset, getAsset, getProject } from "@/server/projects";
import { UPLOAD_DIR } from "@/server/db";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const asset = getAsset(id);
  if (!asset) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!getProject(asset.project_id, user.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  deleteAsset(id, asset.project_id);
  await unlink(path.join(UPLOAD_DIR, `${id}.webp`)).catch(() => {});
  return NextResponse.json({ ok: true });
}
