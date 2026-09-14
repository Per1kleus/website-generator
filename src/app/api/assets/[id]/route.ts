import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getCurrentUser } from "@/server/auth";
import { getAsset, getProject } from "@/server/projects";
import { readPreviewToken } from "@/server/preview-token";
import { UPLOAD_DIR } from "@/server/db";
import { isVariantWidth } from "@/lib/responsive-images";

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

  /**
   * A narrower copy, made once and kept.
   *
   * Every generated page now offers several widths of each photograph, so
   * this is on the path of an ordinary page view rather than an occasional
   * thumbnail request. Re-encoding on every request would burn CPU forever
   * for a result that never changes — an asset id names immutable bytes — so
   * the variant is written beside the original the first time it is asked
   * for and read from disk after that.
   *
   * Only the fixed ladder of widths is cached. An arbitrary `?w=` would let
   * anyone with access fill the disk with near-identical files; those are
   * still served, just resized in memory as before.
   */
  const wanted = Number(new URL(req.url).searchParams.get("w"));
  const resize = Number.isFinite(wanted) && wanted >= 32 && wanted < asset.width;
  const cacheable = resize && isVariantWidth(wanted);
  const variantPath = path.join(UPLOAD_DIR, `${id}-${Math.round(wanted)}.webp`);

  let data: Buffer;
  if (cacheable) {
    try {
      data = await readFile(variantPath);
      return webp(data);
    } catch {
      /* not built yet — fall through and build it */
    }
  }

  try {
    data = await readFile(path.join(UPLOAD_DIR, `${id}.webp`));
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (resize) {
    data = await sharp(data).resize({ width: Math.round(wanted) }).webp({ quality: 76 }).toBuffer();
    if (cacheable) {
      // Written to a unique name and moved into place, so two requests
      // racing for the same variant cannot leave a half-written file behind
      // for every later reader. A failure here costs only the cache.
      const temp = `${variantPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temp, data);
        await rename(temp, variantPath);
      } catch {
        /* serving the bytes matters; caching them does not */
      }
    }
  }

  return webp(data);
}

function webp(data: Buffer): Response {
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(data.byteLength),
      // Content is immutable per asset id, but keep it private to this user.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
