/**
 * What a project backup is.
 *
 * The shape lives in `lib/` and depends on nothing, so the writer, the reader
 * and the restore screen all agree about it, and so a backup can be inspected
 * by anything that can read JSON — including a person, six months from now,
 * with no copy of this application to hand.
 *
 * Two decisions shape it:
 *
 * **It is not a database dump.** Dumping rows would tie every backup to the
 * current schema: a column renamed next year would make last year's backups
 * unreadable, which is exactly when a backup matters. So this is a described
 * document with its own version number, and restoring maps it onto whatever
 * the tables look like at the time.
 *
 * **It contains no credential, and cannot.** Everything here is either the
 * creator's own work or a public identifier. Tokens live in the account
 * tables, which are per-user rather than per-project and are never read by
 * the writer. A restored project asks for GitHub and Google to be connected
 * again, which is the correct answer rather than a limitation: a backup that
 * could re-establish access to somebody's GitHub account is a credential in a
 * file somebody will email to themselves.
 */

/** Bumped when a change would stop an older reader understanding a backup. */
export const BACKUP_VERSION = 1;

/** The lowest version this application can still read. */
export const MIN_BACKUP_VERSION = 1;

export const BACKUP_MANIFEST = "backup.json";
export const BACKUP_ASSET_DIR = "assets";

/** Copied from the project row: the creator's own answers, no credentials. */
export type BackupProject = {
  name: string;
  business_name: string;
  business_type: string;
  site_kind: string;
  maps_url: string;
  website_url: string;
  location: string;
  phone: string;
  email: string;
  description: string;
  status: string;
  created_at: number;
  updated_at: number;
  logo_asset_id: string;
  default_locale: string;
  locales: string[];
  design_notes: string;
  design: unknown;
  /** Research findings, the design system and the answers behind them. */
  business_profile: unknown;
  design_system: unknown;
  design_answers: Record<string, string>;
  /** The live document. Design tokens, content, translations and SEO are in it. */
  site: unknown;
};

export type BackupVersion = {
  /** The id it had, so a client preview can still point at the right one. */
  id: string;
  label: string;
  kind: string;
  restored_from: string;
  created_at: number;
  site: unknown;
};

export type BackupAsset = {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  role: string;
  has_alpha: number;
  focal_x: number;
  focal_y: number;
  created_at: number;
  /** Where the bytes are in the archive. */
  path: string;
  /** SHA-256 of those bytes, so a truncated archive fails rather than restores. */
  sha256: string;
};

export type BackupPreview = {
  id: string;
  version_id: string;
  label: string;
  revoked: number;
  created_at: number;
  responses: {
    id: string;
    kind: string;
    message: string;
    resolved: number;
    created_at: number;
  }[];
};

/**
 * Where the website was published, and under what name.
 *
 * Kept so that a project restored after the local database is lost can
 * reconnect to the repository that is still serving the client's website,
 * rather than creating a second one beside it. Nothing here is a credential:
 * a repository name and a domain are public facts about a site the world can
 * already visit.
 */
export type BackupDeployment = {
  platform: string;
  slug: string;
  url: string;
  status: string;
  published_at: number;
  site_hash: string;
  repo_owner: string;
  repo_name: string;
  repo_private: number;
  repo_url: string;
  pages_url: string;
  custom_domain: string;
  /** The id of the version that was live, matched against `versions`. */
  version_id: string;
};

/** Which integrations were configured, so the restore screen can say so. */
export type BackupIntegrations = {
  /** A menu source: the spreadsheet it read, never the token that read it. */
  menu: {
    provider: string;
    spreadsheet_id: string;
    spreadsheet_name: string;
    sheet_title: string;
    /* The Drive folder of dish photographs, when one was connected. A folder
       id is not a credential — it names a place, and opening it still needs a
       Google account that has been given access. Optional, so a backup written
       before folders existed still validates. */
    drive_folder_id?: string;
    drive_folder_name?: string;
    status: string;
    last_sync_at: number;
  } | null;
  /** Analytics and Search Console: property ids, which are not secret. */
  google: {
    service: string;
    property_id: string;
    property_name: string;
    measurement_id: string;
  }[];
  /** True when the project published to GitHub and will need reconnecting. */
  githubWasConnected: boolean;
};

/**
 * Enough to tell a complete backup from a truncated one.
 *
 * The checksum covers the manifest with this block removed, so it verifies
 * every field in the document including the per-asset digests — which in turn
 * cover the bytes. A backup that passes all three has its content, its
 * metadata and its structure intact.
 */
export type BackupIntegrity = {
  /** Number of files in the archive, the manifest included. */
  fileCount: number;
  /** Total bytes of asset data. */
  assetBytes: number;
  assetCount: number;
  versionCount: number;
  /** SHA-256 over the canonical manifest with `integrity.checksum` blanked. */
  checksum: string;
};

export type BackupManifest = {
  backupVersion: number;
  /** What wrote it, for a person reading the file. */
  generator: string;
  createdAt: number;
  /** The project id it came from. Never reused on restore. */
  sourceProjectId: string;
  project: BackupProject;
  versions: BackupVersion[];
  assets: BackupAsset[];
  previews: BackupPreview[];
  deployment: BackupDeployment | null;
  integrations: BackupIntegrations;
  integrity: BackupIntegrity;
};

/**
 * Field names that must never appear anywhere in a backup.
 *
 * Used by the writer as a last line of defence and by the tests as the thing
 * they actually check for in the produced bytes. A future change that adds a
 * field called `access_token` to a project row would fail the export rather
 * than quietly shipping it.
 */
export const FORBIDDEN_KEYS = [
  "access_token",
  "refresh_token",
  "password",
  "password_hash",
  "client_secret",
  "api_key",
  "apiKey",
  "session",
  "cookie",
  "private_key",
  "secret",
];

/** Values that look like a credential whatever they are called. */
export const FORBIDDEN_VALUE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{16,}/, // GitHub tokens
  /ya29\.[A-Za-z0-9_-]{20,}/, // Google OAuth access tokens
  /AIza[A-Za-z0-9_-]{30,}/, // Google API keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bv1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/, // our own encrypted blobs
];

/**
 * A stable serialisation, so the same content always hashes the same way.
 *
 * `JSON.stringify` preserves insertion order, which differs between the
 * writer and a reader that rebuilt the object — so keys are sorted. Without
 * this, a backup would verify on the machine that wrote it and fail on the
 * machine that needs it.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

/** The manifest as it is hashed: the checksum field itself cannot be inside. */
export function manifestForChecksum(manifest: BackupManifest): string {
  return canonicalJson({
    ...manifest,
    integrity: { ...manifest.integrity, checksum: "" },
  });
}

export type BackupProblem = { fatal: boolean; message: string };

/**
 * Structural validation, before anything is trusted.
 *
 * Deliberately paranoid about types rather than assuming a file this
 * application wrote: a backup is a file a person can edit, truncate, or
 * produce with a different tool, and the point of restoring one is that
 * something has already gone wrong.
 */
export function validateManifest(value: unknown): {
  ok: boolean;
  manifest: BackupManifest | null;
  problems: BackupProblem[];
} {
  const problems: BackupProblem[] = [];
  const fail = (message: string) => problems.push({ fatal: true, message });

  if (!value || typeof value !== "object") {
    fail("This file does not contain a project backup.");
    return { ok: false, manifest: null, problems };
  }
  const m = value as Partial<BackupManifest>;

  if (typeof m.backupVersion !== "number") {
    fail("This backup does not say which format it is in, so it cannot be read safely.");
    return { ok: false, manifest: null, problems };
  }
  if (m.backupVersion > BACKUP_VERSION) {
    fail(
      `This backup was made by a newer version of the application (format ${m.backupVersion}; this one reads up to ${BACKUP_VERSION}). Update the application and try again.`,
    );
    return { ok: false, manifest: null, problems };
  }
  if (m.backupVersion < MIN_BACKUP_VERSION) {
    fail(`This backup is in format ${m.backupVersion}, which this application can no longer read.`);
    return { ok: false, manifest: null, problems };
  }

  if (!m.project || typeof m.project !== "object") fail("The backup has no project in it.");
  else if (!m.project.business_name) fail("The backup's project has no business name.");

  if (!Array.isArray(m.versions)) fail("The backup's version history is missing or damaged.");
  if (!Array.isArray(m.assets)) fail("The backup's asset list is missing or damaged.");
  if (!Array.isArray(m.previews)) fail("The backup's client-preview list is missing or damaged.");
  if (!m.integrity || typeof m.integrity !== "object") {
    fail("The backup has no integrity information, so it cannot be checked.");
  }

  if (problems.some((p) => p.fatal)) return { ok: false, manifest: null, problems };
  return { ok: true, manifest: m as BackupManifest, problems };
}
