import "server-only";
import { db } from "../db";
import type { Finding } from "./processor";

/** The spreadsheet a Digital Menu project reads from, and its last sync. */

export type SyncStats = {
  items: number;
  categories: number;
  imagesResolved: number;
  imagesFailed: number;
  rowsRejected: number;
  errors: number;
  warnings: number;
};

export type MenuSource = {
  project_id: string;
  provider: string;
  spreadsheet_id: string;
  spreadsheet_name: string;
  sheet_title: string;
  status: "disconnected" | "configured" | "synced" | "error";
  last_sync_at: number;
  last_error: string;
  stats: SyncStats;
  findings: Finding[];
  created_at: number;
  updated_at: number;
};

type Row = Omit<MenuSource, "stats" | "findings"> & { stats: string; findings: string };

export const EMPTY_STATS: SyncStats = {
  items: 0, categories: 0, imagesResolved: 0, imagesFailed: 0,
  rowsRejected: 0, errors: 0, warnings: 0,
};

function hydrate(row: Row): MenuSource {
  const parse = <T,>(raw: string, fallback: T): T => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  return {
    ...row,
    stats: parse(row.stats, EMPTY_STATS),
    findings: parse(row.findings, [] as Finding[]),
  };
}

export function getMenuSource(projectId: string): MenuSource | null {
  const row = db.prepare("SELECT * FROM menu_sources WHERE project_id = ?").get(projectId) as
    | Row
    | undefined;
  return row ? hydrate(row) : null;
}

export function setMenuSource(
  projectId: string,
  patch: {
    spreadsheetId: string;
    spreadsheetName: string;
    sheetTitle: string;
  },
): MenuSource {
  const now = Date.now();
  db.prepare(
    `INSERT INTO menu_sources
       (project_id, provider, spreadsheet_id, spreadsheet_name, sheet_title,
        status, created_at, updated_at)
     VALUES (?, 'google-sheets', ?, ?, ?, 'configured', ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       spreadsheet_id = excluded.spreadsheet_id,
       spreadsheet_name = excluded.spreadsheet_name,
       sheet_title = excluded.sheet_title,
       status = 'configured',
       last_error = '',
       updated_at = excluded.updated_at`,
  ).run(projectId, patch.spreadsheetId, patch.spreadsheetName, patch.sheetTitle, now, now);
  return getMenuSource(projectId)!;
}

export function recordSync(
  projectId: string,
  result: { ok: boolean; error?: string; stats: SyncStats; findings: Finding[] },
): void {
  const now = Date.now();
  db.prepare(
    `UPDATE menu_sources
        SET status = ?, last_error = ?, stats = ?, findings = ?,
            last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END,
            updated_at = ?
      WHERE project_id = ?`,
  ).run(
    result.ok ? "synced" : "error",
    result.error ?? "",
    JSON.stringify(result.stats),
    JSON.stringify(result.findings.slice(0, 200)),
    result.ok ? 1 : 0,
    now,
    now,
    projectId,
  );
}

export function disconnectMenuSource(projectId: string): void {
  db.prepare("DELETE FROM menu_sources WHERE project_id = ?").run(projectId);
}
