import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getCurrentUser } from "@/server/auth";
import { getAsset, getProject } from "@/server/projects";
import { readPreviewToken } from "@/server/preview-token";
import { UPLOAD_DIR } from "@/server/db";

/**
 * Serves an uploaded image, optionally resized via ?w=.
 * Ownership is checked on every request — assets are not public URLs.
 *
 * The live preview is the one caller without a session: it runs the generated
 * website in a frame with no origin, so its requests carry no cookies. Those
 * are authorised by a read-only preview token naming one project, and a token
 * for a different project is worth exactly as much here as no token at all.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = getAsset(id);
  if (!asset) return new Response("Not found", { status: 404 });

  const token = new URL(req.url).searchParams.get("pt") ?? "";
  if (readPreviewToken(token) !== asset.project_id) {
    const user = await getCurrentUser();
    if (!user) return new Response("Not signed in", { status: 401 });
    if (!getProject(asset.project_id, user.id)) return new Response("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await readFile(path.join(UPLOAD_DIR, `${id}.webp`));
  } catch {
    return new Response("Not found", { status: 404 });
  }

  // Thumbnail on demand: the gallery picker asks for 200px, so a phone never
  // downloads eight full-size photos to render a grid of squares.
  const wanted = Number(new URL(req.url).searchParams.get("w"));
  if (Number.isFinite(wanted) && wanted >= 32 && wanted < asset.width) {
    data = await sharp(data).resize({ width: Math.round(wanted) }).webp({ quality: 76 }).toBuffer();
  }

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(data.byteLength),
      // Content is immutable per asset id, but keep it private to this user.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
