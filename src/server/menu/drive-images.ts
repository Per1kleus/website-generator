import "server-only";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { db, UPLOAD_DIR } from "../db";
import { downloadDriveFile, driveFileMeta, GoogleError } from "../google/api";
import { focalPoint } from "../images";

/**
 * Google Drive image resolution.
 *
 * A Drive sharing URL cannot be used as an <img src>: those endpoints redirect
 * through an interstitial, require the viewer's own Google session, are rate
 * limited, and are not a stable CDN. Hot-linking them would also leak that the
 * menu is sheet-driven and make every customer's page load depend on Google.
 *
 * So the image is fetched once, server-side, with the creator's credentials,
 * then normalised through the same pipeline as an uploaded photo and served
 * from this app. The public menu ends up with an ordinary local image.
 */

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1400;

/**
 * Extracts a Drive file id from the shapes people actually paste.
 * Returns null for anything that is not a Drive reference — including plain
 * https URLs, which are handled separately by the caller.
 */
export function extractDriveFileId(raw: string): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  // A bare id, as produced by copying from the Drive URL bar.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) return value;

  const patterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,      // /file/d/<id>/view
    /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,      // /open?id=<id>
    /drive\.google\.com\/uc\?(?:export=\w+&)?id=([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/thumbnail\?id=([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/\w+\/d\/([a-zA-Z0-9_-]+)/,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,                        // any ?id= fallback
  ];
  for (const re of patterns) {
    const match = value.match(re);
    if (match?.[1]) return match[1];
  }
  return null;
}

export type ImageResolution =
  | { kind: "none" }
  | { kind: "asset"; assetId: string }
  | { kind: "external"; url: string }
  | { kind: "error"; message: string };

/** A previously-downloaded Drive image for this project, if there is one. */
function cachedAsset(projectId: string, fileId: string): string | null {
  const row = db
    .prepare(
      "SELECT id FROM assets WHERE project_id = ? AND drive_file_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(projectId, fileId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Resolves one `imageurl` cell into something the menu can display.
 *
 * `force` re-downloads even when a copy exists, which is what Sync Now uses so
 * a replaced Drive image actually reaches the menu.
 */
export async function resolveImage(args: {
  userId: string;
  projectId: string;
  raw: string;
  alt: string;
  force?: boolean;
}): Promise<ImageResolution> {
  const raw = (args.raw ?? "").trim();
  if (!raw) return { kind: "none" };

  const fileId = extractDriveFileId(raw);

  if (!fileId) {
    // Not a Drive reference. A plain https image URL is allowed through as-is
    // rather than rejected — but anything else is a mistake worth reporting.
    if (/^https:\/\/\S+$/i.test(raw)) return { kind: "external", url: raw };
    return {
      kind: "error",
      message: "Not a Google Drive link or an https image address.",
    };
  }

  if (!args.force) {
    const existing = cachedAsset(args.projectId, fileId);
    if (existing) return { kind: "asset", assetId: existing };
  }

  try {
    const meta = await driveFileMeta(args.userId, fileId);
    if (meta.mimeType && !meta.mimeType.startsWith("image/")) {
      return { kind: "error", message: `That Drive file is a ${meta.mimeType}, not an image.` };
    }
    if (meta.size && meta.size > MAX_BYTES) {
      return { kind: "error", message: "That Drive image is larger than 20MB." };
    }

    const bytes = await downloadDriveFile(args.userId, fileId);

    // Same treatment as an uploaded photo: EXIF orientation applied, the rest
    // (including GPS) dropped, resized, and converted to WebP.
    const options = { failOn: "none" as const };
    const probe = await sharp(bytes, options).metadata();
    const result = await sharp(bytes, options)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    // A dish photograph is shown as a small square, so where the food sits in
    // the frame decides whether the thumbnail shows the plate or the tablecloth.
    const focal = await focalPoint(result.data);

    const assetId = randomUUID();
    await writeFile(path.join(UPLOAD_DIR, `${assetId}.webp`), result.data);

    db.prepare(
      `INSERT INTO assets
         (id, project_id, filename, mime, width, height, bytes, alt, created_at, role, has_alpha, drive_file_id, focal_x, focal_y)
       VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, 'menu', ?, ?, ?, ?)`,
    ).run(
      assetId,
      args.projectId,
      meta.name || "menu-image",
      result.info.width,
      result.info.height,
      result.data.byteLength,
      args.alt,
      Date.now(),
      probe.hasAlpha ? 1 : 0,
      fileId,
      focal.x,
      focal.y,
    );

    // Replace any earlier copy of the same Drive file so a forced re-sync does
    // not accumulate one asset per sync.
    db.prepare(
      "DELETE FROM assets WHERE project_id = ? AND drive_file_id = ? AND id != ?",
    ).run(args.projectId, fileId, assetId);

    return { kind: "asset", assetId };
  } catch (err) {
    if (err instanceof GoogleError) {
      return {
        kind: "error",
        message:
          err.status === 403 || err.status === 404
            ? "Could not open that Drive image. Check it is shared with the connected Google account."
            : err.message,
      };
    }
    return { kind: "error", message: "That Drive image could not be read." };
  }
}
