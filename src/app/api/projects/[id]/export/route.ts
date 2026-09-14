import archiver from "archiver";
import { createReadStream } from "node:fs";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { buildBundle, resizedBytes } from "@/server/bundle";

/**
 * Streams the finished website as a ZIP (requirement 12), with one folder per
 * enabled language. Streaming rather than buffering means the download starts
 * immediately on a phone and the server never holds the archive in memory.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return new Response("Nothing to export yet", { status: 404 });

  const archive = archiver("zip", { zlib: { level: 9 } });
  const bundle = buildBundle(project.site);
  for (const file of bundle) {
    if (file.kind === "text") archive.append(file.content, { name: file.name });
    else if (file.kind === "file") archive.append(createReadStream(file.source), { name: file.name });
  }
  // The resized copies are produced before the archive is closed, so the ZIP
  // carries the same responsive variants a published site does.
  void (async () => {
    for (const file of bundle) {
      if (file.kind !== "resize") continue;
      try {
        archive.append(await resizedBytes(file), { name: file.name });
      } catch {
        /* a variant that cannot be made is simply absent; the page still has
           the original in its srcset and renders correctly without it */
      }
    }
    void archive.finalize();
  })();

  const slug =
    project.site.meta.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "website";

  return new Response(archive as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
