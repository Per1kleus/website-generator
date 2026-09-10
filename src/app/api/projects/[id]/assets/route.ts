import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getCurrentUser } from "@/server/auth";
import { getProject, insertAsset, listAssets, setLogo } from "@/server/projects";
import { focalPoint } from "@/server/images";
import { UPLOAD_DIR } from "@/server/db";
import { sanitiseSvg } from "@/server/svg";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // phones shoot big files; accept them
const MAX_PHOTO_EDGE = 2000;
const MAX_LOGO_EDGE = 1024;

const RASTER = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif",
]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const role = new URL(req.url).searchParams.get("role") ?? undefined;
  return NextResponse.json({ assets: listAssets(id, role) });
}

/**
 * Accepts photos and logos straight from a phone (requirements 10 and 20).
 *
 * Everything is normalised server-side so the creator never thinks about
 * formats or file size:
 *   - HEIC/HEIF from an iPhone is transcoded
 *   - EXIF orientation is applied, then the rest (including GPS) is dropped
 *   - photos are capped at 2000px, logos at 1024px
 *   - aspect ratio is always preserved: `fit: "inside"` never distorts
 *   - SVG logos are sanitised, then rasterised for the variants
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  const role = String(form.get("role") ?? "photo") === "logo" ? "logo" : "photo";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was received." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That image is over 25MB. Try a smaller one." }, { status: 413 });
  }

  const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
  if (isSvg && role !== "logo") {
    return NextResponse.json(
      { error: "SVG is only accepted for logos. Use a JPEG, PNG or WebP photo." },
      { status: 415 },
    );
  }
  if (!isSvg && file.type && !RASTER.has(file.type)) {
    return NextResponse.json(
      { error: "That file type is not supported. Use a JPEG, PNG, WebP or SVG." },
      { status: 415 },
    );
  }

  let input = Buffer.from(await file.arrayBuffer());

  if (isSvg) {
    // An SVG is a document that can carry script and remote references, so it
    // is never stored or served as uploaded. Sanitise, then rasterise.
    const cleaned = sanitiseSvg(input.toString("utf8"));
    if (!cleaned) {
      return NextResponse.json(
        { error: "That SVG could not be read safely. Try a PNG instead." },
        { status: 400 },
      );
    }
    input = Buffer.from(cleaned, "utf8");
  }

  const edge = role === "logo" ? MAX_LOGO_EDGE : MAX_PHOTO_EDGE;

  let output: Buffer;
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  try {
    // failOn:"none" is deliberate. A photo uploaded from a phone on mobile
    // data can arrive slightly truncated; salvaging what decodes is far
    // better for the user than rejecting the upload. sharp still errors if
    // the file is not an image at all.
    const options = { failOn: "none" as const, density: isSvg ? 384 : undefined };
    // A sharp instance is single-use: metadata() consumes it, so the
    // transform below gets its own.
    const meta = await sharp(input, options).metadata();
    hasAlpha = Boolean(meta.hasAlpha);

    const result = await sharp(input, options)
      .rotate() // bake in EXIF orientation so portraits are not sideways
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: !isSvg })
      .webp({ quality: role === "logo" ? 92 : 80, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });

    output = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    return NextResponse.json(
      { error: "That image could not be read. Try another file." },
      { status: 400 },
    );
  }

  // Measured once, here, from the picture we just encoded — so cropping it
  // later never has to decode it again. Logos are placed by their own rules
  // and do not need one.
  const focal = role === "logo" ? { x: 0.5, y: 0.5 } : await focalPoint(output);

  const assetId = randomUUID();
  await writeFile(path.join(UPLOAD_DIR, `${assetId}.webp`), output);

  const asset = insertAsset({
    id: assetId,
    project_id: id,
    filename: file.name || (role === "logo" ? "logo.webp" : "photo.webp"),
    mime: "image/webp",
    width,
    height,
    bytes: output.byteLength,
    alt: String(form.get("alt") ?? "").trim(),
    role,
    has_alpha: hasAlpha ? 1 : 0,
    focal_x: focal.x,
    focal_y: focal.y,
  });

  if (role === "logo") setLogo(id, user.id, assetId);

  return NextResponse.json({ ok: true, asset });
}
