import { readFile } from "node:fs/promises";
import path from "node:path";
import { PUBLISH_DIR } from "@/server/deploy";

/**
 * Public hosting for deployed sites — deliberately unauthenticated, because
 * this is the live website a customer opens after scanning a QR code.
 *
 * A catch-all so per-language paths work as real URLs:
 *   /s/<slug>/            root redirect document
 *   /s/<slug>/en/         English
 *   /s/<slug>/el/         Greek
 *   /s/<slug>/images/x    shared assets
 *   /s/<slug>/sitemap.xml
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path: segments = [] } = await ctx.params;

  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    return new Response("Not found", { status: 404 });
  }
  // Every segment comes from a URL, so nothing that could climb out of the
  // publish directory is allowed anywhere near the filesystem.
  for (const seg of segments) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(seg) || seg === "." || seg === "..") {
      return new Response("Not found", { status: 404 });
    }
  }

  const root = path.join(PUBLISH_DIR, slug);
  const last = segments[segments.length - 1] ?? "";
  // A path with no extension is a directory: serve its index.html.
  const relative = segments.length === 0 || !last.includes(".")
    ? path.join(...segments, "index.html")
    : path.join(...segments);

  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    const isHtml = ext === ".html";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": isHtml
          ? "public, max-age=60, stale-while-revalidate=600"
          : "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
