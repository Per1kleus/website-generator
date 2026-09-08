import { readFile } from "node:fs/promises";
import path from "node:path";
import { PUBLISH_DIR } from "@/server/deploy";

/** Serves images belonging to a published site. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string; file: string }> },
) {
  const { slug, file } = await ctx.params;

  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return new Response("Not found", { status: 404 });
  // Only the exact shape we write: a UUID plus .webp. No traversal possible.
  if (!/^[0-9a-f-]{36}\.webp$/.test(file)) return new Response("Not found", { status: 404 });

  try {
    const data = await readFile(path.join(PUBLISH_DIR, slug, "images", file));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
