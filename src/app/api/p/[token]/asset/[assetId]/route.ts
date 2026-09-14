import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_DIR } from "@/server/db";
import { getAsset } from "@/server/projects";
import { resolvePreview } from "@/server/client-preview";
import { isVariantWidth } from "@/lib/responsive-images";

/**
 * A photograph belonging to the website behind a preview link.
 *
 * The check that matters is the second one: a valid token proves the holder
 * may see *that project's* pictures, and nothing more. Asking for an asset id
 * from someone else's project with a perfectly good token must be refused, or
 * the token would be a key to every image on the server.
 *
 * A miss and a wrong-project hit both answer 404, so the response cannot be
 * used to test whether an asset id exists.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string; assetId: string }> },
) {
  const { token, assetId } = await ctx.params;

  const resolved = resolvePreview(token);
  if (!resolved) return new Response("Not found", { status: 404 });

  const asset = getAsset(assetId);
  if (!asset || asset.project_id !== resolved.preview.project_id) {
    return new Response("Not found", { status: 404 });
  }

  const wanted = Number(new URL(req.url).searchParams.get("w"));
  const resize = Number.isFinite(wanted) && wanted >= 32 && wanted < asset.width;
  const cacheable = resize && isVariantWidth(wanted);
  const variantPath = path.join(UPLOAD_DIR, `${assetId}-${Math.round(wanted)}.webp`);

  // The same variant cache the builder writes. One image, one encode, whoever
  // asks for it.
  let data: Buffer;
  if (cacheable) {
    try {
      return webp(await readFile(variantPath));
    } catch {
      /* not built yet */
    }
  }

  try {
    data = await readFile(path.join(UPLOAD_DIR, `${assetId}.webp`));
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (resize) {
    data = await sharp(data).resize({ width: Math.round(wanted) }).webp({ quality: 76 }).toBuffer();
    if (cacheable) {
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
      // Immutable per asset id, but a preview link is not public content.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const dynamic = "force-dynamic";
