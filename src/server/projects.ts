import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
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
};

export type Project = Omit<ProjectRow, "site" | "design"> & {
  site: Site | null;
  design: { style: string };
};

function hydrate(row: ProjectRow): Project {
  return {
    ...row,
    site: row.site ? (JSON.parse(row.site) as Site) : null,
    design: JSON.parse(row.design || "{}") as { style: string },
  };
}

export function listProjects(userId: string): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
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
};

export function createProject(p: NewProject): Project {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects
       (id, user_id, name, business_name, business_type, site_kind, maps_url,
        location, phone, email, description, design, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
  ).run(
    id, p.userId, p.name || p.businessName, p.businessName, p.businessType,
    p.siteKind, p.mapsUrl, p.location, p.phone, p.email, p.description,
    JSON.stringify({ style: p.style }), now, now,
  );
  return getProject(id, p.userId)!;
}

export function updateProjectSite(id: string, userId: string, site: Site): void {
  db.prepare(
    "UPDATE projects SET site = ?, status = 'ready', updated_at = ? WHERE id = ? AND user_id = ?",
  ).run(JSON.stringify(site), Date.now(), id, userId);
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
};

export function listAssets(projectId: string): Asset[] {
  return db
    .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Asset[];
}

export function getAsset(id: string): Asset | null {
  return (db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as Asset) ?? null;
}

export function insertAsset(a: Omit<Asset, "created_at">): Asset {
  db.prepare(
    `INSERT INTO assets (id, project_id, filename, mime, width, height, bytes, alt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.id, a.project_id, a.filename, a.mime, a.width, a.height, a.bytes, a.alt, Date.now());
  return getAsset(a.id)!;
}

export function deleteAsset(id: string, projectId: string): void {
  db.prepare("DELETE FROM assets WHERE id = ? AND project_id = ?").run(id, projectId);
}
