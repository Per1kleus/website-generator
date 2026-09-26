import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, UPLOAD_DIR } from "./db";
import { slugify, uniqueSlug } from "./deploy-model";
import { migrateToV2 } from "@/lib/migrate";
import { validateSite } from "./validate";
import type { Site } from "@/lib/site";
import {
  BACKUP_ASSET_DIR, BACKUP_MANIFEST, BACKUP_VERSION, manifestForChecksum, validateManifest,
  type BackupManifest,
} from "@/lib/backup-format";
import { isSafeAssetPath } from "./backup";

/**
 * Reading a backup, and putting a project back.
 *
 * Two rules shape everything here.
 *
 * **Nothing is trusted.** A backup is a file, and the reason somebody is
 * restoring one is that something has already gone wrong: it may be
 * truncated, edited, half-downloaded, or produced by a different version. So
 * the structure, the format version, the whole-manifest checksum, every
 * asset's digest and the website document itself are each checked before any
 * of it is written, and a failure says which check failed rather than
 * producing a project that looks fine and is not.
 *
 * **Nothing is overwritten.** A restore always creates a new project. There
 * is no "restore over" path, not as a safety default but at all: the person
 * doing this is recovering from a loss, and the one outcome worse than a
 * failed restore is a successful one that lands on top of the work they still
 * had.
 */

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export type RestoreCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

export type RestoreReport = {
  ok: boolean;
  checks: RestoreCheck[];
  /** What the backup says it is, for the confirmation screen. */
  summary: {
    businessName: string;
    backupVersion: number;
    createdAt: number;
    versionCount: number;
    assetCount: number;
    previewCount: number;
    /** The address the website was published at, if it was. */
    publishedUrl: string;
    repository: string;
    customDomain: string;
  } | null;
  /** External connections the restored project will need before it can work. */
  reconnect: { service: string; why: string }[];
};

type Entry = { name: string; bytes: Buffer };

/* ------------------------------------------------------------ reading a zip */

/**
 * Unpack a ZIP without adding a dependency to read one.
 *
 * `archiver` writes archives and does not read them. Rather than pull in a
 * reader for the handful of stored/deflated entries this format produces,
 * the central directory is walked directly — which also means the reader
 * cannot be surprised by an archive feature the writer never emits.
 */
export async function readZip(bytes: Buffer): Promise<Entry[]> {
  const { inflateRawSync } = await import("node:zlib");

  // End of central directory: signature 0x06054b50, within the last 64KB.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file is not a readable archive.");

  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);

  const entries: Entry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("This archive's index is damaged.");
    }
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;

    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("This archive contains a damaged entry.");
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) entries.push({ name, bytes: Buffer.from(raw) });
    else if (method === 8) entries.push({ name, bytes: inflateRawSync(raw) });
    else throw new Error("This archive uses a compression method this application cannot read.");
  }
  return entries;
}

/* ------------------------------------------------------------- inspection */

/**
 * Check a backup without writing anything.
 *
 * This is what the restore screen shows before anybody commits: every check
 * by name, passed or failed, so a person can see that eighteen assets
 * verified and seven versions were found — and can see which single thing is
 * wrong when one is.
 */
export async function inspectBackup(
  bytes: Buffer,
): Promise<{ report: RestoreReport; manifest: BackupManifest | null; entries: Entry[] }> {
  const checks: RestoreCheck[] = [];
  const add = (label: string, ok: boolean, detail = "") => checks.push({ label, ok, detail });
  const fail = (label: string, detail: string): {
    report: RestoreReport;
    manifest: null;
    entries: Entry[];
  } => {
    add(label, false, detail);
    return { report: { ok: false, checks, summary: null, reconnect: [] }, manifest: null, entries: [] };
  };

  let entries: Entry[];
  try {
    entries = await readZip(bytes);
  } catch (err) {
    return fail("Archive", err instanceof Error ? err.message : "This file could not be opened.");
  }
  add("Archive", true, `${entries.length} file${entries.length === 1 ? "" : "s"}`);

  const manifestEntry = entries.find((e) => e.name === BACKUP_MANIFEST);
  if (!manifestEntry) {
    return fail("Backup manifest", "This archive has no backup.json in it, so it is not a project backup.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestEntry.bytes.toString("utf8"));
  } catch {
    return fail("Backup manifest", "The backup's manifest is not readable.");
  }

  const structure = validateManifest(parsed);
  if (!structure.ok || !structure.manifest) {
    return fail("Backup structure", structure.problems.map((p) => p.message).join(" "));
  }
  const manifest = structure.manifest;
  add("Backup structure", true, `format ${manifest.backupVersion} of ${BACKUP_VERSION}`);

  /* The whole-manifest checksum. It covers every field including each asset's
     digest, so passing this means the metadata is exactly as written. */
  const expected = manifest.integrity.checksum;
  const actual = sha256(manifestForChecksum(manifest));
  if (!expected || expected !== actual) {
    return fail(
      "Integrity",
      expected
        ? "This backup's contents do not match its checksum. It is incomplete or has been altered."
        : "This backup carries no checksum, so it cannot be verified.",
    );
  }
  add("Integrity", true, "checksum matches");

  // File count, which catches a truncated archive that still parsed.
  const expectedFiles = manifest.integrity.fileCount;
  if (entries.length !== expectedFiles) {
    return fail(
      "Completeness",
      `This backup says it has ${expectedFiles} file${expectedFiles === 1 ? "" : "s"} but contains ${entries.length}. It is incomplete.`,
    );
  }
  add("Completeness", true, `${expectedFiles} files as recorded`);

  /* The website document itself. A backup whose Site is unreadable would
     restore into a project that cannot open, so it is refused here where the
     message can still be useful. */
  const site = manifest.project.site;
  if (!site || typeof site !== "object") {
    return fail("Website document", "This backup contains no website document.");
  }
  let migrated: Site;
  try {
    migrated = migrateToV2(site, manifest.project.default_locale || "en");
    if (!Array.isArray(migrated.sections) || !migrated.meta?.businessName) {
      throw new Error("shape");
    }
  } catch {
    return fail("Website document", "The website document in this backup could not be read.");
  }
  const findings = validateSite(migrated).filter((f) => f.level === "error");
  add(
    "Website document",
    true,
    `${migrated.sections.length} sections, ${migrated.meta.locales.length} language${migrated.meta.locales.length === 1 ? "" : "s"}${findings.length ? `, ${findings.length} content warning${findings.length === 1 ? "" : "s"}` : ""}`,
  );

  /* Assets, one digest at a time. This is the check that matters most: a
     restored document pointing at photographs that are not in the archive is
     not a recovered project, and the difference is invisible until a client
     opens the website. */
  let verified = 0;
  const assetProblems: string[] = [];
  for (const asset of manifest.assets) {
    if (!isSafeAssetPath(asset.path)) {
      assetProblems.push(`${asset.filename || asset.id}: unsafe path in archive`);
      continue;
    }
    const entry = entries.find((e) => e.name === asset.path);
    if (!entry) {
      assetProblems.push(`${asset.filename || asset.id}: missing from the archive`);
      continue;
    }
    if (entry.bytes.length !== asset.bytes) {
      assetProblems.push(`${asset.filename || asset.id}: wrong size`);
      continue;
    }
    if (sha256(entry.bytes) !== asset.sha256) {
      assetProblems.push(`${asset.filename || asset.id}: damaged`);
      continue;
    }
    verified += 1;
  }
  if (assetProblems.length) {
    return fail(
      "Assets",
      `${assetProblems.length} of ${manifest.assets.length} images could not be verified — ${assetProblems.slice(0, 3).join("; ")}${assetProblems.length > 3 ? "…" : ""}`,
    );
  }
  add("Assets", true, `${verified} verified`);

  add(
    "Version history",
    manifest.versions.length === manifest.integrity.versionCount,
    `${manifest.versions.length} found`,
  );
  if (manifest.previews.length) {
    add("Client previews", true, `${manifest.previews.length} link${manifest.previews.length === 1 ? "" : "s"}, pinned to their versions`);
  }

  /* What will need reconnecting. Credentials are deliberately not in a
     backup, so this is not a shortcoming to be discovered later — it is part
     of what the restore screen says before anybody presses the button. */
  const reconnect: RestoreReport["reconnect"] = [];
  if (manifest.integrations.githubWasConnected || manifest.deployment?.platform === "github") {
    reconnect.push({
      service: "GitHub",
      why: manifest.deployment?.repo_name
        ? `Reconnect GitHub to publish again. The restored project will reuse the existing repository ${manifest.deployment.repo_owner}/${manifest.deployment.repo_name} rather than creating a second one.`
        : "Reconnect GitHub to publish this project again.",
    });
  }
  if (manifest.integrations.menu || manifest.integrations.google.length) {
    reconnect.push({
      service: "Google",
      why: manifest.integrations.menu
        ? "Reconnect Google to sync the menu spreadsheet again. Which spreadsheet and tab were in use has been restored."
        : "Reconnect Google to read Analytics and Search Console again. Which properties were connected has been restored.",
    });
  }

  const ok = checks.every((c) => c.ok);
  return {
    report: {
      ok,
      checks,
      summary: {
        businessName: manifest.project.business_name,
        backupVersion: manifest.backupVersion,
        createdAt: manifest.createdAt,
        versionCount: manifest.versions.length,
        assetCount: manifest.assets.length,
        previewCount: manifest.previews.length,
        publishedUrl: manifest.deployment?.status === "live" ? manifest.deployment.url : "",
        repository: manifest.deployment?.repo_name
          ? `${manifest.deployment.repo_owner}/${manifest.deployment.repo_name}`
          : "",
        customDomain: manifest.deployment?.custom_domain ?? "",
      },
      reconnect,
    },
    manifest,
    entries,
  };
}

/* --------------------------------------------------------------- restoring */

export type RestoreResult = {
  projectId: string;
  /** What actually happened, in the words the screen shows afterwards. */
  notes: string[];
};

/**
 * Write a verified backup back as a brand-new project.
 *
 * Everything is inserted under fresh ids except version ids, which are kept
 * so that a client preview still points at the document it was pinned to —
 * the one piece of identity in the whole format that has to survive, because
 * an approval attached to the wrong version is worse than no approval.
 */
export async function restoreBackup(
  userId: string,
  manifest: BackupManifest,
  entries: Entry[],
): Promise<RestoreResult> {
  const notes: string[] = [];
  const projectId = randomUUID();
  const now = Date.now();
  const p = manifest.project;

  /* Ids are remapped, so restoring a backup twice produces two independent
     projects rather than two rows claiming the same identity. Version ids
     are the exception, and are still remapped per restore so that a second
     restore of the same backup cannot collide with the first. */
  const versionIdMap = new Map<string, string>();
  for (const version of manifest.versions) versionIdMap.set(version.id, randomUUID());
  const assetIdMap = new Map<string, string>();
  for (const asset of manifest.assets) assetIdMap.set(asset.id, randomUUID());

  /* An asset id appears inside the Site document, so remapping ids means
     rewriting the document to match. Done as a whole-document substitution
     over the serialised JSON: the ids are UUIDs, so there is nothing else in
     a document they could collide with, and it catches every place one can
     appear — a section's imageId, a gallery list, a menu item, the images
     array — without this module needing to know the schema. */
  const rewriteAssets = (value: unknown): unknown => {
    if (!assetIdMap.size) return value;
    let json = JSON.stringify(value);
    for (const [from, to] of assetIdMap) json = json.split(from).join(to);
    return JSON.parse(json);
  };

  const site = rewriteAssets(migrateToV2(p.site, p.default_locale || "en")) as Site;

  db.prepare(
    `INSERT INTO projects (
       id, user_id, name, business_name, business_type, site_kind, maps_url, website_url,
       location, phone, email, description, design, site, status, created_at, updated_at,
       logo_asset_id, default_locale, locales, design_notes, business_profile, design_system,
       design_answers
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    projectId, userId,
    p.name || p.business_name, p.business_name, p.business_type, p.site_kind,
    p.maps_url, p.website_url, p.location, p.phone, p.email, p.description,
    JSON.stringify(p.design ?? { style: "classic" }),
    JSON.stringify(site),
    // A restored project is ready: its website exists. "generating" would be
    // a lie about a job that is not running.
    p.status === "generating" ? "ready" : p.status || "ready",
    p.created_at || now, now,
    assetIdMap.get(p.logo_asset_id) ?? "",
    p.default_locale || "en",
    JSON.stringify(p.locales ?? [p.default_locale || "en"]),
    p.design_notes ?? "",
    p.business_profile ? JSON.stringify(p.business_profile) : null,
    p.design_system ? JSON.stringify(p.design_system) : null,
    JSON.stringify(p.design_answers ?? {}),
  );

  for (const locale of p.locales ?? []) {
    db.prepare(
      `INSERT OR IGNORE INTO project_locales (project_id, locale, is_default, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(projectId, locale, locale === p.default_locale ? 1 : 0, now);
  }

  /* Assets: bytes first, then the row. An asset row whose file failed to
     write would be a broken image in a project that claims to be recovered. */
  await mkdir(UPLOAD_DIR, { recursive: true });
  let assetsWritten = 0;
  for (const asset of manifest.assets) {
    const entry = entries.find((e) => e.name === asset.path);
    if (!entry) continue;
    const newId = assetIdMap.get(asset.id)!;
    await writeFile(path.join(UPLOAD_DIR, `${newId}.webp`), entry.bytes);
    db.prepare(
      `INSERT INTO assets (id, project_id, filename, mime, width, height, bytes, alt,
                           created_at, role, has_alpha, focal_x, focal_y)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId, projectId, asset.filename, asset.mime, asset.width, asset.height,
      asset.bytes, asset.alt, asset.created_at || now, asset.role || "photo",
      asset.has_alpha ? 1 : 0, asset.focal_x ?? 0.5, asset.focal_y ?? 0.5,
    );
    assetsWritten += 1;
  }
  notes.push(`${assetsWritten} image${assetsWritten === 1 ? "" : "s"} restored.`);

  // Versions, in their original order so the numbering a person remembers is
  // the numbering they get back.
  for (const version of manifest.versions) {
    db.prepare(
      `INSERT INTO versions (id, project_id, label, site, created_at, kind, restored_from)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionIdMap.get(version.id)!,
      projectId,
      version.label,
      JSON.stringify(rewriteAssets(version.site)),
      version.created_at,
      version.kind || "manual",
      versionIdMap.get(version.restored_from) ?? "",
    );
  }
  notes.push(`${manifest.versions.length} version${manifest.versions.length === 1 ? "" : "s"} restored.`);

  /* Client previews.
     The link itself is NOT restored: the token is the capability, and minting
     the same token again would mean a link somebody sent a year ago still
     opens a website in a different install. What is restored is the record —
     which version was shared, what the client said about it, and whether it
     was approved — so the history of the approval survives even though the
     link has to be sent again. */
  let previewsRestored = 0;
  for (const preview of manifest.previews) {
    const versionId = versionIdMap.get(preview.version_id);
    if (!versionId) continue;
    const newPreviewId = randomBase64Url();
    db.prepare(
      `INSERT INTO client_previews (id, project_id, version_id, label, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      newPreviewId, projectId, versionId, preview.label,
      // Restored links start withdrawn: the address changed, so the old one
      // does not work and a live-looking link that nobody can open is worse
      // than one that plainly says it was withdrawn.
      1,
      preview.created_at,
    );
    for (const response of preview.responses) {
      db.prepare(
        `INSERT INTO client_responses (id, preview_id, kind, message, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), newPreviewId, response.kind, response.message, response.resolved, response.created_at);
    }
    previewsRestored += 1;
  }
  if (previewsRestored) {
    notes.push(
      `${previewsRestored} client preview${previewsRestored === 1 ? "" : "s"} restored with ${previewsRestored === 1 ? "its" : "their"} approvals. Send a fresh link — the old addresses no longer work.`,
    );
  }

  /* Deployment metadata: the bridge back to a website that is still live.

     The repository name is what lets the restored project push to the same
     repository the client's website is already served from, instead of
     creating a second one. The slug is globally unique, so if the original
     project still exists here, this restore gets a different slug — and
     therefore a different repository — which is correct, and is said out loud
     rather than discovered later. */
  const d = manifest.deployment;
  if (d) {
    const wantedSlug = slugify(d.slug || p.business_name);
    const slug = uniqueSlug(wantedSlug, projectId);
    const reusesRepo = slug === wantedSlug && Boolean(d.repo_name);

    db.prepare(
      `INSERT INTO deployments (
         id, project_id, platform, slug, status, url, log, error, created_at, updated_at,
         published_at, site_hash, unpublished_at, repo_owner, repo_name, repo_private,
         repo_url, commit_sha, pages_status, pages_url, custom_domain, domain_status,
         domain_error, domain_checked_at, version_id
       ) VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?, ?, ?, 0, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      randomUUID(), projectId, d.platform || "builtin", slug,
      // The website really is still live at that address, so saying so is the
      // truth — and it is what makes "changes since publication" correct
      // rather than claiming the restored project has never been published.
      d.status === "live" ? "live" : "unpublished",
      d.url, d.published_at || now, now, d.published_at || 0, d.site_hash || "",
      reusesRepo ? d.repo_owner : "", reusesRepo ? d.repo_name : "",
      d.repo_private ?? 1,
      reusesRepo ? d.repo_url : "",
      d.status === "live" ? "built" : "",
      reusesRepo ? d.pages_url : "",
      reusesRepo ? d.custom_domain : "",
      reusesRepo && d.custom_domain ? "dns-required" : "none",
      /* domain_error: deliberately empty.
         A domain that was verified before the backup was taken has not been
         verified since, and this application has no idea what DNS says now.
         Starting it at "dns-required" with nothing claimed is the honest
         state; the first check fills this in from a real lookup. */
      "",
      versionIdMap.get(d.version_id) ?? "",
    );

    if (reusesRepo) {
      notes.push(
        `Publishing will update the existing repository ${d.repo_owner}/${d.repo_name} — no second repository will be created. Reconnect GitHub first.`,
      );
      if (d.custom_domain) {
        notes.push(
          `The custom domain ${d.custom_domain} was restored. Check it once GitHub is reconnected, since this application has not verified it since the backup was made.`,
        );
      }
    } else if (d.repo_name) {
      notes.push(
        `The original repository ${d.repo_owner}/${d.repo_name} is already claimed by another project here, so this restore will publish to a new one. Nothing was changed on GitHub.`,
      );
    }
  }

  // Integrations: what was configured, never what authorised it.
  const menu = manifest.integrations.menu;
  if (menu) {
    db.prepare(
      `INSERT INTO menu_sources (project_id, provider, spreadsheet_id, spreadsheet_name,
                                 sheet_title, drive_folder_id, drive_folder_name,
                                 status, last_sync_at, last_error, stats,
                                 findings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'disconnected', ?, '', '{}', '[]', ?, ?)`,
    ).run(
      projectId, menu.provider, menu.spreadsheet_id, menu.spreadsheet_name,
      menu.sheet_title,
      // Absent in a backup written before photograph folders existed.
      menu.drive_folder_id ?? "", menu.drive_folder_name ?? "",
      menu.last_sync_at || 0, now, now,
    );
    notes.push("The menu spreadsheet was restored. Reconnect Google to sync it again.");
  }
  for (const property of manifest.integrations.google) {
    db.prepare(
      `INSERT INTO google_properties (project_id, service, property_id, property_name,
                                      measurement_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId, property.service, property.property_id, property.property_name,
      property.measurement_id, now,
    );
  }
  if (manifest.integrations.google.length) {
    notes.push("Analytics and Search Console properties were restored. Reconnect Google to read them.");
  }

  return { projectId, notes };
}

/** A preview token, in the same shape `server/client-preview.ts` mints. */
function randomBase64Url(): string {
  return createHash("sha256").update(randomUUID()).digest("base64url").slice(0, 43);
}
