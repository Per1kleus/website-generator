import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { backupFilename, packBackup } from "@/server/backup";

/**
 * Download a portable backup of one project.
 *
 * Buffered rather than streamed on purpose: the bytes are scanned for
 * credentials before any of them leave, and a stream would mean the first
 * chunk had already gone by the time the last one was checked.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return new Response("Not found", { status: 404 });

  try {
    const { bytes, manifest } = await packBackup(project);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backupFilename(project)}"`,
        "Content-Length": String(bytes.length),
        // So a caller can verify the download without opening it.
        "X-Backup-Version": String(manifest.backupVersion),
        "X-Backup-Checksum": manifest.integrity.checksum,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[backup] export failed:", err);
    return new Response(
      err instanceof Error ? err.message : "The backup could not be created.",
      { status: 500 },
    );
  }
}

/** What a backup of this project would contain, without producing one. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return Response.json({ error: "Not found." }, { status: 404 });

  const { bytes, manifest } = await packBackup(project);
  return Response.json({
    ok: true,
    filename: backupFilename(project),
    size: bytes.length,
    backupVersion: manifest.backupVersion,
    createdAt: manifest.createdAt,
    integrity: manifest.integrity,
    contents: {
      versions: manifest.versions.length,
      assets: manifest.assets.length,
      previews: manifest.previews.length,
      published: manifest.deployment?.status === "live",
      repository: manifest.deployment?.repo_name
        ? `${manifest.deployment.repo_owner}/${manifest.deployment.repo_name}`
        : "",
      customDomain: manifest.deployment?.custom_domain ?? "",
    },
  });
}

export const dynamic = "force-dynamic";
