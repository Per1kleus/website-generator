import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, UPLOAD_DIR } from "./db";
import { getLatestDeployment } from "./deploy";
import { listAssets, listVersions, type Project } from "./projects";
import { getMenuSource } from "./menu/source";
import { connectionStatus as githubStatus } from "./github/oauth";
import {
  BACKUP_ASSET_DIR, BACKUP_MANIFEST, BACKUP_VERSION, canonicalJson, FORBIDDEN_KEYS,
  FORBIDDEN_VALUE_PATTERNS, manifestForChecksum,
  type BackupAsset, type BackupManifest, type BackupPreview, type BackupVersion,
} from "@/lib/backup-format";

/**
 * Writing a project out so it can come back.
 *
 * The recovery scenario this exists for is specific: the machine running this
 * application is gone, and what is left is a file on a memory stick and a
 * website still being served by GitHub Pages. Everything here follows from
 * that — the format is self-describing rather than a dump of these tables,
 * the assets travel with it because a restored Site document pointing at
 * missing photographs is not a recovered project, and the repository the
 * website is already served from is recorded so the restore can reconnect to
 * it instead of quietly creating a second one.
 *
 * What is never written is any credential. Tokens live in the per-user
 * account tables, which this module does not read; and the bytes are scanned
 * before they are handed out, so a field added carelessly in a year's time
 * fails the export rather than shipping somebody's GitHub token in a file
 * they will email to themselves.
 */

export const BACKUP_DIR = path.join(
  process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data"),
  "backups",
);

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Where an asset's bytes live. One file per asset, already keyed by id. */
function assetPath(assetId: string): string {
  return path.join(UPLOAD_DIR, `${assetId}.webp`);
}

/**
 * A name that is safe inside an archive.
 *
 * Asset ids are generated UUIDs, so this can only ever be a no-op — which is
 * the point of asserting it rather than assuming it. A backup is also a file
 * a person can craft, and `assets/../../etc/passwd` must not be a path this
 * application will later write to.
 */
export function safeAssetName(assetId: string): string {
  return assetId.replace(/[^A-Za-z0-9._-]/g, "");
}

export function isSafeAssetPath(entry: string): boolean {
  if (!entry.startsWith(`${BACKUP_ASSET_DIR}/`)) return false;
  const rest = entry.slice(BACKUP_ASSET_DIR.length + 1);
  return Boolean(rest) && !rest.includes("/") && !rest.includes("\\") && rest !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(rest);
}

/* ------------------------------------------------------------- the writer */

type PreviewRow = {
  id: string;
  version_id: string;
  label: string;
  revoked: number;
  created_at: number;
};

/**
 * Everything about one project, as a manifest plus its asset bytes.
 *
 * Reads through the same functions the rest of the application uses, so a
 * backup cannot drift from what a project actually is.
 */
export async function buildBackup(
  project: Project,
): Promise<{ manifest: BackupManifest; files: { name: string; bytes: Buffer }[] }> {
  const projectId = project.id;

  /* Versions, oldest first, with their documents. History is the reason a
     backup is worth more than an export: it is what lets somebody go back to
     the version a client approved rather than only the current one. */
  const versionRows = db
    .prepare(
      `SELECT id, label, kind, restored_from, created_at, site
         FROM versions WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(projectId) as (Omit<BackupVersion, "site"> & { site: string })[];
  const versions: BackupVersion[] = versionRows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind,
    restored_from: row.restored_from ?? "",
    created_at: row.created_at,
    site: JSON.parse(row.site),
  }));

  /* Assets: the row for the metadata, the file for the pixels. An asset whose
     file has gone missing is recorded as absent rather than silently dropped,
     so a restore can say "17 of 18 images" instead of quietly losing one. */
  const files: { name: string; bytes: Buffer }[] = [];
  const assets: BackupAsset[] = [];
  let assetBytes = 0;
  for (const asset of listAssets(projectId)) {
    const source = assetPath(asset.id);
    if (!existsSync(source)) continue;
    const bytes = await readFile(source);
    const name = `${BACKUP_ASSET_DIR}/${safeAssetName(asset.id)}.webp`;
    files.push({ name, bytes });
    assetBytes += bytes.length;
    assets.push({
      id: asset.id,
      filename: asset.filename,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      bytes: bytes.length,
      alt: asset.alt,
      role: asset.role,
      has_alpha: asset.has_alpha,
      focal_x: asset.focal_x,
      focal_y: asset.focal_y,
      created_at: asset.created_at,
      path: name,
      sha256: sha256(bytes),
    });
  }

  // Client previews, with the version each one is pinned to. Restoring these
  // is what keeps "this is the exact page the client approved" true.
  const previewRows = db
    .prepare(
      `SELECT id, version_id, label, revoked, created_at FROM client_previews
        WHERE project_id = ? ORDER BY created_at ASC`,
    )
    .all(projectId) as PreviewRow[];
  const previews: BackupPreview[] = previewRows.map((row) => ({
    ...row,
    responses: db
      .prepare(
        `SELECT id, kind, message, resolved, created_at FROM client_responses
          WHERE preview_id = ? ORDER BY created_at ASC`,
      )
      .all(row.id) as BackupPreview["responses"],
  }));

  const deployment = getLatestDeployment(projectId);
  const menu = getMenuSource(projectId);
  const googleProperties = db
    .prepare(
      `SELECT service, property_id, property_name, measurement_id
         FROM google_properties WHERE project_id = ?`,
    )
    .all(projectId) as { service: string; property_id: string; property_name: string; measurement_id: string }[];

  const manifest: BackupManifest = {
    backupVersion: BACKUP_VERSION,
    generator: "website-generator",
    createdAt: Date.now(),
    sourceProjectId: projectId,
    project: {
      name: project.name,
      business_name: project.business_name,
      business_type: project.business_type,
      site_kind: project.site_kind,
      maps_url: project.maps_url,
      website_url: project.website_url,
      location: project.location,
      phone: project.phone,
      email: project.email,
      description: project.description,
      status: project.status,
      created_at: project.created_at,
      updated_at: project.updated_at,
      logo_asset_id: project.logo_asset_id,
      default_locale: project.default_locale,
      locales: project.locales,
      design_notes: project.design_notes,
      design: project.design,
      business_profile: project.businessProfile,
      design_system: project.designSystem,
      design_answers: project.designAnswers,
      site: project.site,
    },
    versions,
    assets,
    previews,
    deployment: deployment
      ? {
          platform: deployment.platform,
          slug: deployment.slug,
          url: deployment.url,
          status: deployment.status,
          published_at: deployment.published_at,
          site_hash: deployment.site_hash,
          repo_owner: deployment.repo_owner,
          repo_name: deployment.repo_name,
          repo_private: deployment.repo_private,
          repo_url: deployment.repo_url,
          pages_url: deployment.pages_url,
          custom_domain: deployment.custom_domain,
          version_id: deployment.version_id,
        }
      : null,
    integrations: {
      menu: menu
        ? {
            provider: menu.provider,
            spreadsheet_id: menu.spreadsheet_id,
            spreadsheet_name: menu.spreadsheet_name,
            sheet_title: menu.sheet_title,
            drive_folder_id: menu.drive_folder_id,
            drive_folder_name: menu.drive_folder_name,
            status: menu.status,
            last_sync_at: menu.last_sync_at,
          }
        : null,
      google: googleProperties,
      githubWasConnected: deployment?.platform === "github",
    },
    integrity: {
      // The manifest itself is one of the files.
      fileCount: files.length + 1,
      assetBytes,
      assetCount: assets.length,
      versionCount: versions.length,
      checksum: "",
    },
  };

  manifest.integrity.checksum = sha256(manifestForChecksum(manifest));
  return { manifest, files };
}

/**
 * The last line of defence before bytes leave the server.
 *
 * Reading the produced manifest rather than trusting the code that produced
 * it: the failure this guards against is somebody adding a field in a year's
 * time without thinking about backups, and that person will not have read
 * this comment.
 */
export function scanForSecrets(manifestJson: string): string[] {
  const found: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return ["The backup could not be re-read for checking."];
  }

  const walk = (value: unknown, at: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (FORBIDDEN_KEYS.some((k) => lower === k.toLowerCase())) {
          found.push(`${at}.${key}`);
        }
        walk(v, `${at}.${key}`);
      }
      return;
    }
    if (typeof value === "string") {
      for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
        if (pattern.test(value)) found.push(`${at} (value looks like a credential)`);
      }
    }
  };

  walk(parsed, "$");
  return found;
}

/**
 * The archive, as bytes.
 *
 * A ZIP because `archiver` is already a dependency and because a backup a
 * person can open with the tools on their own computer is a backup they can
 * verify without this application. Stored rather than streamed: a backup is
 * written once, checked, and only then handed over — streaming it would mean
 * the secret scan happened after the first byte had already left.
 */
export async function packBackup(
  project: Project,
): Promise<{ bytes: Buffer; manifest: BackupManifest }> {
  const { manifest, files } = await buildBackup(project);
  const manifestJson = JSON.stringify(manifest, null, 2);

  const leaked = scanForSecrets(manifestJson);
  if (leaked.length) {
    // Refusing is the only safe answer: a backup that carries a credential is
    // worse than no backup, because it will be copied around freely.
    console.error("[backup] refused to write a backup containing:", leaked.join(", "));
    throw new Error(
      "This backup was not created, because it would have contained credentials. This is a bug — please report it.",
    );
  }

  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on("end", () => resolve());
    archive.on("error", reject);
  });

  archive.append(manifestJson, { name: BACKUP_MANIFEST });
  for (const file of files) archive.append(file.bytes, { name: file.name });
  await archive.finalize();
  await done;

  return { bytes: Buffer.concat(chunks), manifest };
}

/** A filename a person can recognise a year later. */
export function backupFilename(project: Project, at = Date.now()): string {
  const slug =
    project.business_name.toLowerCase().normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";
  const day = new Date(at).toISOString().slice(0, 10);
  return `${slug}-${day}.wgbackup.zip`;
}

/* --------------------------------------------------- automatic local copies */

/**
 * A backup taken without being asked, before something irreversible.
 *
 * Deliberately small: a file on the same disk, kept for the last few
 * operations. That is not disaster recovery — a disk that dies takes these
 * with it — and it is not meant to be. It is the answer to "I deleted the
 * wrong project", which is the failure that actually happens, and the export
 * a person keeps elsewhere is the answer to the other one.
 */
const KEEP_AUTOMATIC = 10;

export async function autoBackup(project: Project, reason: string): Promise<string | null> {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    const { bytes } = await packBackup(project);
    const safeReason = reason.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const name = `${project.id}-${safeReason}-${Date.now()}.wgbackup.zip`;
    const target = path.join(BACKUP_DIR, name);
    await writeFile(target, bytes);
    await pruneAutomatic();
    return target;
  } catch (err) {
    // A backup that cannot be written must not stop the operation it precedes
    // — a creator pressing Delete on a project they no longer want should not
    // be blocked by a full disk. It is logged loudly instead.
    console.error("[backup] automatic backup failed:", err);
    return null;
  }
}

async function pruneAutomatic(): Promise<void> {
  const entries = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const backups = entries.filter((e) => e.endsWith(".wgbackup.zip"));
  if (backups.length <= KEEP_AUTOMATIC) return;

  const withTimes = await Promise.all(
    backups.map(async (name) => ({
      name,
      at: await stat(path.join(BACKUP_DIR, name)).then((s) => s.mtimeMs).catch(() => 0),
    })),
  );
  withTimes.sort((a, b) => b.at - a.at);
  for (const old of withTimes.slice(KEEP_AUTOMATIC)) {
    await rm(path.join(BACKUP_DIR, old.name), { force: true }).catch(() => {});
  }
}

export async function listAutomaticBackups(): Promise<
  { name: string; bytes: number; created_at: number }[]
> {
  const entries = await readdir(BACKUP_DIR).catch(() => [] as string[]);
  const out = [];
  for (const name of entries.filter((e) => e.endsWith(".wgbackup.zip"))) {
    try {
      const info = await stat(path.join(BACKUP_DIR, name));
      out.push({ name, bytes: info.size, created_at: Math.round(info.mtimeMs) });
    } catch {
      /* removed between the listing and the stat */
    }
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

export { canonicalJson, sha256 as backupHash, randomUUID as newId };
