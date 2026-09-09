import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getCurrentUser } from "@/server/auth";
import { db, UPLOAD_DIR } from "@/server/db";
import { sanitiseSvg } from "@/server/svg";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 1024;

/**
 * Staged logo upload.
 *
 * The wizard asks for the logo directly under the business name (requirement
 * 20), which is before a project exists. The file is stored against a
 * per-user staging project so ownership is still enforced, and adopted by the
 * real project on create.
 */
function stagingProjectId(userId: string): string {
  const id = `staging-${userId}`;
  const exists = db.prepare("SELECT id FROM projects WHERE id = ?").get(id);
  if (!exists) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (id, user_id, name, business_name, status, created_at, updated_at)
       VALUES (?, ?, 'Staging', 'Staging', 'draft', ?, ?)`,
    ).run(id, userId, now, now);
  }
  return id;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was received." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That logo is over 10MB." }, { status: 413 });
  }

  const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  if (!isSvg && file.type && !allowed.has(file.type)) {
    return NextResponse.json(
      { error: "Use a PNG, JPG, WebP or SVG for the logo." },
      { status: 415 },
    );
  }

  let input = Buffer.from(await file.arrayBuffer());
  if (isSvg) {
    // Never store or serve an uploaded SVG as-is: it is an executable document.
    const cleaned = sanitiseSvg(input.toString("utf8"));
    if (!cleaned) {
      return NextResponse.json({ error: "That SVG could not be read safely. Try a PNG." }, { status: 400 });
    }
    input = Buffer.from(cleaned, "utf8");
  }

  try {
    // failOn:"none" is deliberate. A photo uploaded from a phone on mobile
    // data can arrive slightly truncated; salvaging what decodes is far
    // better for the user than rejecting the upload. sharp still errors if
    // the file is not an image at all.
    const options = { failOn: "none" as const, density: isSvg ? 384 : undefined };
    // A sharp instance is single-use: metadata() consumes it, so the
    // transform below gets its own.
    const meta = await sharp(input, options).metadata();
    const result = await sharp(input, options)
      .rotate()
      // fit:"inside" preserves the aspect ratio — a logo is never distorted.
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: !isSvg })
      .webp({ quality: 92, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });

    const assetId = randomUUID();
    await writeFile(path.join(UPLOAD_DIR, `${assetId}.webp`), result.data);

    const projectId = stagingProjectId(user.id);
    db.prepare(
      `INSERT INTO assets (id, project_id, filename, mime, width, height, bytes, alt, created_at, role, has_alpha)
       VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, 'logo', ?)`,
    ).run(
      assetId, projectId, file.name || "logo",
      result.info.width, result.info.height, result.data.byteLength,
      String(form.get("alt") ?? ""), Date.now(), meta.hasAlpha ? 1 : 0,
    );

    return NextResponse.json({
      ok: true,
      asset: { id: assetId, width: result.info.width, height: result.info.height },
    });
  } catch {
    return NextResponse.json({ error: "That logo could not be read." }, { status: 400 });
  }
}
