import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getCurrentUser } from "@/server/auth";
import { getProject, insertAsset, listAssets } from "@/server/projects";
import { UPLOAD_DIR } from "@/server/db";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // phones shoot big files; accept them
const MAX_EDGE = 2000; // then store something a phone can actually download
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ assets: listAssets(id) });
}

/**
 * Accepts photos straight from a phone camera or gallery (requirement 10).
 *
 * Everything is normalised server-side so the user never has to think about
 * file size or format:
 *   - HEIC/HEIF from an iPhone is transcoded to WebP
 *   - EXIF orientation is applied, then the rest of the EXIF (including GPS)
 *     is dropped — a business photo should not leak where it was taken
 *   - anything over 2000px on its long edge is resized down
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was received." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That image is over 25MB. Try a smaller one." },
      { status: 413 },
    );
  }
  if (file.type && !ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "That file type is not supported. Use a JPEG, PNG or WebP." },
      { status: 415 },
    );
  }

  const input = Buffer.from(await file.arrayBuffer());

  let output: Buffer;
  let width = 0;
  let height = 0;
  try {
    const pipeline = sharp(input, { failOn: "error" })
      .rotate() // bakes in EXIF orientation, so portrait photos are not sideways
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 });

    const result = await pipeline.toBuffer({ resolveWithObject: true });
    output = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    return NextResponse.json(
      { error: "That image could not be read. Try another photo." },
      { status: 400 },
    );
  }

  const assetId = randomUUID();
  await writeFile(path.join(UPLOAD_DIR, `${assetId}.webp`), output);

  const asset = insertAsset({
    id: assetId,
    project_id: id,
    filename: file.name || "photo.webp",
    mime: "image/webp",
    width,
    height,
    bytes: output.byteLength,
    alt: (form.get("alt") as string) ?? "",
  });

  return NextResponse.json({ ok: true, asset });
}
