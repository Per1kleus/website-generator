import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * SQLite is deliberate: the whole platform runs from a single file with no
 * external service, so a phone-only user never has infrastructure to manage.
 */
const DATA_DIR = process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

declare global {
  // Next's dev server re-evaluates modules on every edit; without this the
  // process would leak a new SQLite handle per hot reload.
  var __wgDb: Database.Database | undefined;
}

function open(): Database.Database {
  const handle = new Database(path.join(DATA_DIR, "app.db"));
  // Wait rather than throw when another process holds the write lock. The
  // production build spins up several workers that all import this module.
  handle.pragma("busy_timeout = 10000");
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  migrate(handle);
  addColumns(handle);
  return handle;
}

function migrate(handle: Database.Database) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      business_name TEXT NOT NULL,
      business_type TEXT NOT NULL DEFAULT '',
      site_kind     TEXT NOT NULL DEFAULT 'business',
      maps_url      TEXT NOT NULL DEFAULT '',
      location      TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      description   TEXT NOT NULL DEFAULT '',
      design        TEXT NOT NULL DEFAULT '{}',
      site          TEXT,
      status        TEXT NOT NULL DEFAULT 'draft',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    /* Google account connected by a creator, for Digital Menu sources.
       Tokens are encrypted at rest; see server/crypto.ts. */
    CREATE TABLE IF NOT EXISTS google_accounts (
      user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email         TEXT NOT NULL DEFAULT '',
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at    INTEGER NOT NULL DEFAULT 0,
      scope         TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    /* Which spreadsheet/tab a Digital Menu project reads from, plus the
       result of the last synchronisation. One source per project. */
    CREATE TABLE IF NOT EXISTS menu_sources (
      project_id       TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      provider         TEXT NOT NULL DEFAULT 'google-sheets',
      spreadsheet_id   TEXT NOT NULL DEFAULT '',
      spreadsheet_name TEXT NOT NULL DEFAULT '',
      sheet_title      TEXT NOT NULL DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'disconnected',
      last_sync_at     INTEGER NOT NULL DEFAULT 0,
      last_error       TEXT NOT NULL DEFAULT '',
      stats            TEXT NOT NULL DEFAULT '{}',
      findings         TEXT NOT NULL DEFAULT '[]',
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_locales (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      locale     TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, locale)
    );
    CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'generate',
      status       TEXT NOT NULL DEFAULT 'queued',
      steps        TEXT NOT NULL DEFAULT '[]',
      progress     INTEGER NOT NULL DEFAULT 0,
      message      TEXT NOT NULL DEFAULT '',
      error        TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS versions (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      site       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS assets (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename   TEXT NOT NULL,
      mime       TEXT NOT NULL,
      width      INTEGER NOT NULL DEFAULT 0,
      height     INTEGER NOT NULL DEFAULT 0,
      bytes      INTEGER NOT NULL DEFAULT 0,
      alt        TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS deployments (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      platform   TEXT NOT NULL,
      slug       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'queued',
      url        TEXT NOT NULL DEFAULT '',
      log        TEXT NOT NULL DEFAULT '[]',
      error      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deployments_project ON deployments(project_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS deployments_slug ON deployments(slug);
  `);
}

/**
 * Additive column migrations.
 *
 * Existing installs must keep working, so every column is added in place with
 * a default rather than by recreating the table. ALTER TABLE ADD COLUMN throws
 * if the column is already there, which is the cheapest "if not exists" SQLite
 * offers.
 */
const COLUMNS: [table: string, column: string, ddl: string][] = [
  ["projects", "logo_asset_id", "TEXT NOT NULL DEFAULT ''"],
  ["projects", "default_locale", "TEXT NOT NULL DEFAULT 'en'"],
  ["projects", "locales", "TEXT NOT NULL DEFAULT '[\"en\"]'"],
  ["projects", "design_notes", "TEXT NOT NULL DEFAULT ''"],
  ["projects", "business_profile", "TEXT"],
  ["projects", "design_system", "TEXT"],
  ["projects", "design_answers", "TEXT NOT NULL DEFAULT '{}'"],
  ["assets", "role", "TEXT NOT NULL DEFAULT 'photo'"],
  ["assets", "has_alpha", "INTEGER NOT NULL DEFAULT 0"],
  ["assets", "drive_file_id", "TEXT NOT NULL DEFAULT ''"],
  // Where the detail sits in the frame, measured once at upload so a crop
  // never has to decode the picture again. 0.5/0.5 means "not measured".
  ["assets", "focal_x", "REAL NOT NULL DEFAULT 0.5"],
  ["assets", "focal_y", "REAL NOT NULL DEFAULT 0.5"],
  // Why a version exists, so history reads as a story rather than a pile of
  // timestamps. Existing rows predate the distinction and are "manual".
  ["versions", "kind", "TEXT NOT NULL DEFAULT 'manual'"],
  // The version this one restored, when it was made by a rollback.
  ["versions", "restored_from", "TEXT NOT NULL DEFAULT ''"],
];

function addColumns(handle: Database.Database) {
  for (const [table, column, ddl] of COLUMNS) {
    const existing = handle.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (existing.some((c) => c.name === column)) continue;
    handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function getDb(): Database.Database {
  return (globalThis.__wgDb ??= open());
}

/**
 * Lazily-opened database handle.
 *
 * Opening at module scope broke `next build`: page-data collection imports
 * every route in parallel workers, and they raced each other setting WAL mode.
 * This proxy defers the connection until the first actual query, so merely
 * importing a route never touches the file.
 */
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
mkdirSync(EXPORT_DIR, { recursive: true });
