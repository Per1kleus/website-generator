import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { Locale } from "@/lib/locales";
import { migrateToV2 } from "@/lib/migrate";
import type { Site } from "@/lib/site";

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  business_name: string;
  business_type: string;
  site_kind: string;
  maps_url: string;
  location: string;
  phone: string;
  email: string;
  description: string;
  design: string;
  site: string | null;
  status: "draft" | "generating" | "ready" | "failed";
  created_at: number;
  updated_at: number;
  logo_asset_id: string;
  default_locale: string;
  locales: string;
  design_notes: string;
  business_profile: string | null;
  design_system: string | null;
  design_answers: string;
};

export type Project = Omit<
  ProjectRow,
  "site" | "design" | "locales" | "business_profile" | "design_system" | "design_answers"
> & {
  site: Site | null;
  design: { style: string };
  locales: Locale[];
  businessProfile: unknown | null;
  designSystem: unknown | null;
  designAnswers: Record<string, string>;
};

function parse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function hydrate(row: ProjectRow): Project {
  // Documents written before the multi-language work are upgraded on read, so
  // an existing project keeps opening normally without a data backfill.
  const site = row.site ? migrateToV2(JSON.parse(row.site), row.default_locale || "en") : null;
  const locales = parse<Locale[]>(row.locales, [row.default_locale || "en"]);

  return {
    ...row,
    site,
    design: parse(row.design, { style: "classic" }),
    locales: site?.meta.locales ?? locales,
    businessProfile: parse<unknown | null>(row.business_profile, null),
    designSystem: parse<unknown | null>(row.design_system, null),
    designAnswers: parse<Record<string, string>>(row.design_answers, {}),
  };
}

export function listProjects(userId: string): Project[] {
  // `staging-<user>` holds logos uploaded before a project exists; it is
  // storage, not a project, so it never appears in any listing.
  const rows = db
    .prepare(
      "SELECT * FROM projects WHERE user_id = ? AND id NOT LIKE 'staging-%' ORDER BY updated_at DESC",
    )
    .all(userId) as ProjectRow[];
  return rows.map(hydrate);
}

/** Always scoped by user_id — ownership is enforced at the query, not the caller. */
export function getProject(id: string, userId: string): Project | null {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(id, userId) as ProjectRow | undefined;
  return row ? hydrate(row) : null;
}

export type NewProject = {
  userId: string;
  name: string;
  businessName: string;
  businessType: string;
  siteKind: string;
  mapsUrl: string;
  location: string;
  phone: string;
  email: string;
  description: string;
  style: string;
  designNotes: string;
  logoAssetId: string;
  defaultLocale: Locale;
  locales: Locale[];
};

export function createProject(p: NewProject): Project {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects
       (id, user_id, name, business_name, business_type, site_kind, maps_url,
        location, phone, email, description, design, status, created_at, updated_at,
        logo_asset_id, default_locale, locales, design_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, p.userId, p.name || p.businessName, p.businessName, p.businessType,
    p.siteKind, p.mapsUrl, p.location, p.phone, p.email, p.description,
    JSON.stringify({ style: p.style }), now, now,
    p.logoAssetId, p.defaultLocale, JSON.stringify(p.locales), p.designNotes,
  );

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO project_locales (project_id, locale, is_default, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const locale of p.locales) {
    stmt.run(id, locale, locale === p.defaultLocale ? 1 : 0, now);
  }

  return getProject(id, p.userId)!;
}

/** Keeps the project_locales table in step with the site document. */
export function syncLocales(projectId: string, defaultLocale: Locale, locales: Locale[]): void {
  const now = Date.now();
  db.prepare("DELETE FROM project_locales WHERE project_id = ?").run(projectId);
  const stmt = db.prepare(
    "INSERT INTO project_locales (project_id, locale, is_default, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const locale of locales) stmt.run(projectId, locale, locale === defaultLocale ? 1 : 0, now);
  db.prepare("UPDATE projects SET default_locale = ?, locales = ?, updated_at = ? WHERE id = ?").run(
    defaultLocale,
    JSON.stringify(locales),
    now,
    projectId,
  );
}

/** Moves a staged upload onto the real project once that project exists. */
export function adoptAsset(assetId: string, projectId: string, userId: string): void {
  const asset = db
    .prepare(
      `SELECT a.id AS id FROM assets a
         JOIN projects p ON p.id = a.project_id
        WHERE a.id = ? AND p.user_id = ?`,
    )
    .get(assetId, userId) as { id: string } | undefined;
  if (!asset) return;
  db.prepare("UPDATE assets SET project_id = ? WHERE id = ?").run(projectId, assetId);
}

export function setLogo(projectId: string, userId: string, assetId: string): void {
  db.prepare("UPDATE projects SET logo_asset_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    assetId,
    Date.now(),
    projectId,
    userId,
  );
}

export function setDesignAnswers(projectId: string, answers: Record<string, string>): void {
  db.prepare("UPDATE projects SET design_answers = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(answers),
    Date.now(),
    projectId,
  );
}

export function updateProjectSite(id: string, userId: string, site: Site): void {
  db.prepare(
    "UPDATE projects SET site = ?, status = 'ready', updated_at = ? WHERE id = ? AND user_id = ?",
  ).run(JSON.stringify(site), Date.now(), id, userId);
  // The site document is the source of truth for languages; mirror it so the
  // relational view and the document can never disagree.
  syncLocales(id, site.meta.defaultLocale, site.meta.locales);
}

export function updateProjectFields(
  id: string,
  userId: string,
  fields: Partial<Pick<ProjectRow, "name" | "business_name" | "business_type" | "maps_url" | "location" | "phone" | "email" | "description" | "site_kind">>,
): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  db.prepare(
    `UPDATE projects SET ${entries.map(([k]) => `${k} = ?`).join(", ")}, updated_at = ?
      WHERE id = ? AND user_id = ?`,
  ).run(...entries.map(([, v]) => v), Date.now(), id, userId);
}

export function deleteProject(id: string, userId: string): void {
  db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
}

/* ------------------------------- versions ------------------------------- */

export type Version = { id: string; project_id: string; label: string; created_at: number };

export function listVersions(projectId: string): Version[] {
  return db
    .prepare(
      "SELECT id, project_id, label, created_at FROM versions WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId) as Version[];
}

export function saveVersion(projectId: string, label: string, site: Site): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO versions (id, project_id, label, site, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, label, JSON.stringify(site), Date.now());
  return id;
}

export function getVersionSite(versionId: string, projectId: string): Site | null {
  const row = db
    .prepare("SELECT site FROM versions WHERE id = ? AND project_id = ?")
    .get(versionId, projectId) as { site: string } | undefined;
  return row ? (JSON.parse(row.site) as Site) : null;
}

export function deleteVersion(versionId: string, projectId: string): void {
  db.prepare("DELETE FROM versions WHERE id = ? AND project_id = ?").run(versionId, projectId);
}

/* -------------------------------- assets -------------------------------- */

export type Asset = {
  id: string;
  project_id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  created_at: number;
  /** "photo" or "logo" — logos are excluded from the gallery pickers. */
  role: string;
  has_alpha: number;
  /** Focal point, 0–1 in each axis. 0.5/0.5 when it was never measured. */
  focal_x: number;
  focal_y: number;
};

export function listAssets(projectId: string, role?: string): Asset[] {
  return role
    ? (db
        .prepare("SELECT * FROM assets WHERE project_id = ? AND role = ? ORDER BY created_at DESC")
        .all(projectId, role) as Asset[])
    : (db
        .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId) as Asset[]);
}

export function getAsset(id: string): Asset | null {
  return (db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Asset) ?? null;
}

export function insertAsset(a: Omit<Asset, "created_at">): Asset {
  db.prepare(
    `INSERT INTO assets (id, project_id, filename, mime, width, height, bytes, alt, created_at, role, has_alpha, focal_x, focal_y)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.project_id, a.filename, a.mime, a.width, a.height, a.bytes, a.alt,
    Date.now(), a.role || "photo", a.has_alpha ? 1 : 0,
    a.focal_x ?? 0.5, a.focal_y ?? 0.5,
  );
  return getAsset(a.id)!;
}

export function deleteAsset(id: string, projectId: string): void {
  db.prepare("DELETE FROM assets WHERE id = ? AND project_id = ?").run(id, projectId);
}
