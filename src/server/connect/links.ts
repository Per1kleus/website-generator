import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";
import { getProjectForPreview, type Project } from "../projects";
import {
  isConnectService, servicesForKind, type ConnectService,
} from "../google/subject";

/**
 * The connection link, and everything that hangs off it.
 *
 * A creator sends one link to a client. The client opens it, signs in with
 * their own Google account, and grants the permissions their own project
 * needs. No password is shared, no account is created here, and the developer
 * never sees a credential — they see, afterwards, that the connection works.
 *
 * Three decisions carry the security of that.
 *
 * **The link is the capability.** 32 bytes of crypto-strong randomness,
 * generated independently of everything it points at. No project id, no
 * database row id, no email address, no counter and no timestamp goes into it,
 * because anything derived is guessable by someone who knows the inputs. This
 * is the same construction `server/client-preview.ts` uses, deliberately: one
 * idea, applied twice, rather than two things to get right.
 *
 * **The link determines the project.** Not the URL, not a form field, not a
 * header. Every server route in this flow starts from the token, looks up the
 * one project it is bound to, and works on that — so a client cannot reach
 * another client's project even by guessing a project id correctly, and a
 * tampered request simply acts on the project the token already named.
 *
 * **The link can be taken away.** Revoked, or expired, or both; and a revoked
 * link, an unknown token and a link whose project is gone all fail the same
 * way, so probing tells the prober nothing.
 */

/** 43 characters of base64url — 256 bits, not enumerable. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export type ConnectLink = {
  id: string;
  project_id: string;
  services: ConnectService[];
  label: string;
  expires_at: number;
  revoked: number;
  used_at: number;
  created_at: number;
};

type LinkRow = Omit<ConnectLink, "services"> & { services: string };

function hydrate(row: LinkRow): ConnectLink {
  let services: ConnectService[] = [];
  try {
    const parsed = JSON.parse(row.services) as unknown;
    if (Array.isArray(parsed)) {
      services = parsed.filter((s): s is ConnectService => typeof s === "string" && isConnectService(s));
    }
  } catch {
    // A row that cannot be read asks for nothing, which is the safe direction.
  }
  return { ...row, services };
}

/* ------------------------------------------------------------------ links */

export const DEFAULT_EXPIRY_DAYS = 14;

/**
 * Make a link for one project.
 *
 * The services come from the project's kind rather than from whoever pressed
 * the button: an ordinary website's link is physically incapable of asking for
 * Sheets or Drive, because the scopes are computed from this list and the list
 * is computed here.
 */
export function createLink(
  projectId: string,
  siteKind: string,
  opts: { label?: string; expiryDays?: number } = {},
): ConnectLink {
  const services = servicesForKind(siteKind);
  const days = opts.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const id = newToken();

  db.prepare(
    `INSERT INTO connect_links
       (id, project_id, services, label, expires_at, revoked, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(
    id,
    projectId,
    JSON.stringify(services),
    opts.label ?? "",
    // A link that lives for ever is a credential left on a doormat. Two weeks
    // is long enough for a client to get round to it, and a creator can always
    // send another.
    days > 0 ? Date.now() + days * 86_400_000 : 0,
    Date.now(),
  );

  recordEvent(projectId, "link-created", { detail: services.join(" ") });
  return getLink(id)!;
}

export function getLink(id: string): ConnectLink | null {
  // A short token is not a token. Checking the length first means a probe with
  // "1" or "abc" never even reaches the database.
  if (!id || id.length < 20) return null;
  const row = db.prepare("SELECT * FROM connect_links WHERE id = ?").get(id) as
    | LinkRow
    | undefined;
  return row ? hydrate(row) : null;
}

export type LinkState = "usable" | "unknown" | "revoked" | "expired";

/**
 * Turn a token into the project it authorises.
 *
 * The single place a token becomes anything. `null` covers an unknown token, a
 * withdrawn link, an expired link and a deleted project alike — the caller
 * cannot tell them apart, and neither can whoever sent the request.
 */
export function resolveLink(id: string): { link: ConnectLink; project: Project } | null {
  const link = getLink(id);
  if (!link) return null;
  if (link.revoked) return null;
  if (link.expires_at && link.expires_at < Date.now()) return null;
  const project = getProjectForPreview(link.project_id);
  if (!project) return null;
  return { link, project };
}

/**
 * Why a link is not usable, for the creator's screen only.
 *
 * Deliberately not exposed to the client's side of the flow: telling an
 * unauthenticated caller "that one expired" rather than "no" confirms that the
 * token was real, which is exactly the thing worth not confirming.
 */
export function linkState(link: ConnectLink): LinkState {
  if (link.revoked) return "revoked";
  if (link.expires_at && link.expires_at < Date.now()) return "expired";
  return "usable";
}

export function listLinks(projectId: string): ConnectLink[] {
  const rows = db
    .prepare("SELECT * FROM connect_links WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as LinkRow[];
  return rows.map(hydrate);
}

/** Scoped by project, so a link id from elsewhere cannot be revoked here. */
export function revokeLink(id: string, projectId: string): boolean {
  const result = db
    .prepare("UPDATE connect_links SET revoked = 1 WHERE id = ? AND project_id = ?")
    .run(id, projectId);
  if (result.changes) recordEvent(projectId, "link-revoked");
  return result.changes > 0;
}

export function markLinkUsed(id: string): void {
  db.prepare("UPDATE connect_links SET used_at = ? WHERE id = ?").run(Date.now(), id);
}

/* ------------------------------------------------- one authorisation attempt */

const STATE_TTL_MS = 15 * 60_000;

/**
 * Start one authorisation, and bind it to one link.
 *
 * Held server-side rather than in a cookie. The usual cookie-based state
 * defends a signed-in session against a forged callback; here there is no
 * session, and the thing that needs binding is the callback to a link. A row
 * does that, and it is consumed on first use so a replayed callback does
 * nothing.
 */
export function createState(linkId: string, scopes: readonly string[]): string {
  pruneStates();
  const state = randomBytes(24).toString("base64url");
  db.prepare(
    `INSERT INTO connect_states (state, link_id, scopes, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(state, linkId, scopes.join(" "), Date.now() + STATE_TTL_MS, Date.now());
  return state;
}

export type ConnectState = { state: string; link_id: string; scopes: string };

/** Single use: the row is consumed, so the same callback cannot be replayed. */
export function takeState(state: string): ConnectState | null {
  if (!state || state.length < 16) return null;
  const row = db.prepare("SELECT * FROM connect_states WHERE state = ?").get(state) as
    | (ConnectState & { expires_at: number; used_at: number })
    | undefined;
  db.prepare("DELETE FROM connect_states WHERE state = ?").run(state);
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return { state: row.state, link_id: row.link_id, scopes: row.scopes };
}

/**
 * Is this state one of ours?
 *
 * Read without consuming, because the Google callback is shared with the
 * creator's own connection flow: if this state belongs to that flow instead,
 * the row must still be here — and if it belongs to neither, nothing has been
 * disturbed. Returns only the link it is bound to, never the state itself.
 */
export function peekConnectState(state: string): { link_id: string } | null {
  if (!state || state.length < 16) return null;
  const row = db
    .prepare("SELECT link_id, expires_at, used_at FROM connect_states WHERE state = ?")
    .get(state) as { link_id: string; expires_at: number; used_at: number } | undefined;
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return { link_id: row.link_id };
}

/** Throw an attempt away, for a consent screen that came back refused. */
export function dropConnectState(state: string): void {
  db.prepare("DELETE FROM connect_states WHERE state = ?").run(state);
}

function pruneStates(): void {
  db.prepare("DELETE FROM connect_states WHERE expires_at < ?").run(Date.now());
}

/* ------------------------------------------------------------- per service */

/**
 * The state of one service for one project.
 *
 * `partially_connected` is only ever a project-wide verdict — a single service
 * is either working or it is not — and is computed rather than stored.
 */
export type ServiceStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "expired"
  | "revoked"
  | "error";

export type ProjectStatus = ServiceStatus | "partially_connected";

export type ServiceState = {
  service: ConnectService;
  status: ServiceStatus;
  verified_at: number;
  error: string;
};

export function setServiceStatus(
  projectId: string,
  service: ConnectService,
  status: ServiceStatus,
  opts: { error?: string; verified?: boolean } = {},
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO project_google_services
       (project_id, service, status, verified_at, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, service) DO UPDATE SET
       status = excluded.status,
       error = excluded.error,
       /* Only a real verification moves this. A failure leaves the last
          successful check visible, so a screen can say when it last worked. */
       verified_at = CASE WHEN excluded.verified_at > 0
                          THEN excluded.verified_at ELSE verified_at END,
       updated_at = excluded.updated_at`,
  ).run(projectId, service, status, opts.verified ? now : 0, opts.error ?? "", now);
}

export function serviceStates(projectId: string): ServiceState[] {
  const rows = db
    .prepare(
      `SELECT service, status, verified_at, error
         FROM project_google_services WHERE project_id = ?`,
    )
    .all(projectId) as ServiceState[];
  return rows.filter((row) => isConnectService(row.service));
}

export function clearServiceStatuses(projectId: string): void {
  db.prepare("DELETE FROM project_google_services WHERE project_id = ?").run(projectId);
}

/* ------------------------------------------------------------------ audit */

/**
 * Record what happened.
 *
 * What is recorded is an event and, at most, a short human-readable detail.
 * What is never recorded: an access token, a refresh token, an authorisation
 * code, a client secret, a link token, or the contents of anything read from
 * Google. There is no code path from a credential to this table — the callers
 * have no parameter to pass one through.
 */
export function recordEvent(
  projectId: string,
  event: string,
  opts: { service?: string; detail?: string } = {},
): void {
  db.prepare(
    `INSERT INTO connect_events (id, project_id, event, service, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    projectId,
    event,
    opts.service ?? "",
    // Bounded, so a long Google error cannot turn the audit trail into a log
    // dump — and truncated rather than dropped, because the first sentence is
    // usually the useful one.
    (opts.detail ?? "").slice(0, 200),
    Date.now(),
  );
}

export type ConnectEvent = {
  id: string;
  event: string;
  service: string;
  detail: string;
  created_at: number;
};

export function listEvents(projectId: string, limit = 50): ConnectEvent[] {
  return db
    .prepare(
      `SELECT id, event, service, detail, created_at
         FROM connect_events WHERE project_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as ConnectEvent[];
}
