import { readFile } from "node:fs/promises";
import path from "node:path";
import { PUBLISH_DIR } from "@/server/deploy";

/**
 * Public hosting for deployed sites. Deliberately unauthenticated — this is
 * the live website a customer visits after scanning a QR code.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  // The slug comes from a URL, so refuse anything that could escape the
  // publish directory before it reaches the filesystem.
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const html = await readFile(path.join(PUBLISH_DIR, slug, "index.html"), "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
