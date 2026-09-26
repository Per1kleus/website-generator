import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { isDesktop } from "../runtime";
import { grantedServices, parseSubject, type ConnectService, type Subject } from "./subject";

/**
 * Google OAuth for the builder application.
 *
 * All of this is server-side by construction: tokens are written encrypted,
 * read only inside server modules, and never serialised into any response or
 * into generated website code. The public Digital Menu never talks to Google
 * at all — it is static HTML produced from data already synced here.
 *
 * The hosts are configurable so the integration can be exercised against a
 * stub in tests without real Google credentials.
 */

const OAUTH_BASE = process.env.GOOGLE_OAUTH_BASE || "https://accounts.google.com";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const USERINFO_URL =
  process.env.GOOGLE_USERINFO_URL || "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * Only what the feature needs (requirement 10):
 *   spreadsheets.readonly  read the menu rows
 *   drive.readonly         list the creator's spreadsheets, and fetch the
 *                          Drive images referenced by `imageurl`
 * Nothing is written to the creator's Drive, and no write scope is requested.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Scopes for things a creator may never ask for.
 *
 * Analytics and Search Console are optional features, so their permissions
 * are requested when they are switched on rather than up front. Asking every
 * creator for access to their analytics in order to build a menu from a
 * spreadsheet would be both rude and a good reason to decline the whole
 * consent screen.
 *
 * `include_granted_scopes=true` is already set on the authorisation URL, which
 * is what makes this incremental: consenting to analytics keeps the Sheets and
 * Drive access already granted rather than replacing it.
 */
export const OPTIONAL_SCOPES = {
  analytics: ["https://www.googleapis.com/auth/analytics.readonly"],
  searchConsole: ["https://www.googleapis.com/auth/webmasters.readonly"],
} as const;

export type OptionalService = keyof typeof OPTIONAL_SCOPES;

/**
 * A desktop build uses a Google "Desktop app" OAuth client, which Google
 * documents as *not* confidential — its secret is not a secret once shipped.
 * The correct proof there is PKCE, so no client secret is required, and none
 * is embedded in the installer.
 *
 * A web deployment keeps the confidential "Web application" client and its
 * secret, which never leaves the server.
 */
export function googleConfigured(): boolean {
  if (!process.env.GOOGLE_CLIENT_ID) return false;
  return isDesktop() ? true : Boolean(process.env.GOOGLE_CLIENT_SECRET);
}

/* -------------------------------------------------------------------------
   PKCE (RFC 7636), used by the desktop flow.

   The verifier is held server-side for the life of one sign-in. It never
   reaches the client, so nothing in the packaged application can be replayed.
------------------------------------------------------------------------- */

const verifiers = new Map<string, { verifier: string; expires: number }>();

function pruneVerifiers() {
  const now = Date.now();
  for (const [state, entry] of verifiers) {
    if (entry.expires < now) verifiers.delete(state);
  }
}

export function createPkce(state: string): string {
  pruneVerifiers();
  const verifier = randomBytes(32).toString("base64url");
  verifiers.set(state, { verifier, expires: Date.now() + 10 * 60_000 });
  return createHash("sha256").update(verifier).digest("base64url");
}

function takeVerifier(state: string): string | null {
  const entry = verifiers.get(state);
  verifiers.delete(state);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.verifier;
}

export function redirectUri(origin: string): string {
  return (
    process.env.GOOGLE_REDIRECT_URI || `${origin.replace(/\/+$/, "")}/api/google/callback`
  );
}

/**
 * The consent URL.
 *
 * `extra` adds to the base scopes for a creator connecting their own account —
 * the incremental case, where `include_granted_scopes` keeps what was already
 * approved rather than replacing it.
 *
 * `opts.exact` instead asks for precisely the scopes given and nothing else,
 * which is what a client connection link uses. Incremental consent is exactly
 * wrong there: it would quietly re-grant a permission that a different project
 * once needed, and the whole point of the link is that a brochure website asks
 * for read access to analytics and for nothing that touches Drive.
 */
export function authorizeUrl(
  origin: string,
  state: string,
  extra: readonly string[] = [],
  opts: { exact?: boolean } = {},
): string {
  const scope = opts.exact ? [...extra] : [...SCOPES, ...extra];
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: scope.join(" "),
    // offline + consent so a refresh token is actually issued, otherwise a
    // sync would stop working an hour after connecting.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: opts.exact ? "false" : "true",
    state,
  });

  if (isDesktop()) {
    params.set("code_challenge", createPkce(state));
    params.set("code_challenge_method", "S256");
  }

  return `${OAUTH_BASE}/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleAccount = {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  created_at: number;
  updated_at: number;
};

type Row = Omit<GoogleAccount, "user_id">;

/* -------------------------------------------------------------------------
   Where a subject's tokens live.

   Two tables, one shape, one set of rules. The creator's connection is keyed
   by user and the client's by project; everything after this function — the
   refresh, the encryption, the slack before expiry, the preservation of an
   old refresh token — is deliberately identical, because a second token store
   would eventually disagree with this one about when a token is still valid.

   The table and column names come from this module, never from a caller, so
   there is nothing here a request could steer.
------------------------------------------------------------------------- */

type Store = { table: string; column: string; key: string; project: boolean };

function storeFor(subject: Subject): Store {
  const parsed = parseSubject(subject);
  return parsed.kind === "project"
    ? { table: "project_google_accounts", column: "project_id", key: parsed.id, project: true }
    : { table: "google_accounts", column: "user_id", key: parsed.id, project: false };
}

/** Never returns tokens — only what the UI is allowed to know. */
export function connectionInfo(userId: string): { connected: boolean; email: string } {
  const row = db
    .prepare("SELECT email FROM google_accounts WHERE user_id = ?")
    .get(userId) as { email: string } | undefined;
  return { connected: Boolean(row), email: row?.email ?? "" };
}

/**
 * What the creator's Google connection can currently do.
 *
 * Derived from the scopes Google actually granted rather than from the scopes
 * that were asked for: a person can approve one permission and decline
 * another on the consent screen, and a UI that claims Sheets works because it
 * was requested would be lying about the thing most likely to have gone wrong.
 *
 * Tokens never appear here. This is the shape the client is allowed to see.
 */
export type GoogleStatus = {
  /** Whether this deployment has Google credentials at all. */
  configured: boolean;
  connected: boolean;
  email: string;
  /** Per-capability, from the granted scopes. */
  sheets: boolean;
  drive: boolean;
  /** Optional services, granted only if the creator asked for them. */
  analytics: boolean;
  searchConsole: boolean;
  /** True when connected but something the app needs was not approved. */
  missingPermissions: boolean;
};

export function connectionStatus(userId: string): GoogleStatus {
  const row = db
    .prepare("SELECT email, scope FROM google_accounts WHERE user_id = ?")
    .get(userId) as { email: string; scope: string } | undefined;

  const configured = googleConfigured();
  if (!row) {
    return {
      configured, connected: false, email: "", sheets: false, drive: false,
      analytics: false, searchConsole: false, missingPermissions: false,
    };
  }

  const granted = (row.scope ?? "").split(/\s+/).filter(Boolean);
  const has = (scope: string) => granted.includes(scope);
  // An older row may predate scope being stored. Absent is not "denied": the
  // connection was made with exactly these scopes, so treat it as granted
  // rather than telling the creator to reconnect for no reason.
  const unknown = granted.length === 0;
  const sheets = unknown || has(SCOPES[0]);
  const drive = unknown || has(SCOPES[1]);

  return {
    configured,
    connected: true,
    email: row.email ?? "",
    sheets,
    drive,
    // Never inferred from `unknown`: these are opt-in, so absence means the
    // creator has not asked for them, not that an old row predates the field.
    analytics: has(OPTIONAL_SCOPES.analytics[0]),
    searchConsole: has(OPTIONAL_SCOPES.searchConsole[0]),
    // Only the scopes every feature needs count as missing. An unconnected
    // optional service is a choice, not a fault.
    missingPermissions: !sheets || !drive,
  };
}

export function disconnect(userId: string): void {
  db.prepare("DELETE FROM google_accounts WHERE user_id = ?").run(userId);
}

function saveTokens(
  subject: Subject,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
  email: string,
  opts: { connectedBy?: "client" | "owner" } = {},
) {
  const now = Date.now();
  const store = storeFor(subject);
  const existing = db
    .prepare(`SELECT refresh_token FROM ${store.table} WHERE ${store.column} = ?`)
    .get(store.key) as { refresh_token: string } | undefined;

  // Google omits refresh_token on re-consent in some flows; keep the old one.
  const refresh = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : (existing?.refresh_token ?? "");

  // A project row records only what Google said it granted. Assuming the base
  // scopes would be a lie about a client who approved less, and the whole
  // point of per-service status is that the application knows the difference.
  const scope = tokens.scope ?? (store.project ? "" : SCOPES.join(" "));

  if (store.project) {
    db.prepare(
      `INSERT INTO project_google_accounts
         (project_id, email, access_token, refresh_token, expires_at, scope,
          connected_by, revoked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         email = excluded.email,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         connected_by = excluded.connected_by,
         revoked_at = 0,
         updated_at = excluded.updated_at`,
    ).run(
      store.key,
      email,
      encryptSecret(tokens.access_token),
      refresh,
      now + (tokens.expires_in ?? 3600) * 1000,
      scope,
      opts.connectedBy ?? "client",
      now,
      now,
    );
    return;
  }

  db.prepare(
    `INSERT INTO google_accounts
       (user_id, email, access_token, refresh_token, expires_at, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       email = excluded.email,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`,
  ).run(
    store.key,
    email,
    encryptSecret(tokens.access_token),
    refresh,
    now + (tokens.expires_in ?? 3600) * 1000,
    scope,
    now,
    now,
  );
}

/**
 * What one project's own Google connection is, without any credential.
 *
 * The shape the connection screens are allowed to see: an address, what was
 * granted, who connected it and when. There is no path from here to a token.
 */
export type ProjectConnection = {
  email: string;
  services: ConnectService[];
  connectedBy: string;
  connectedAt: number;
  updatedAt: number;
  expiresAt: number;
};

export function projectConnection(projectId: string): ProjectConnection | null {
  const row = db
    .prepare(
      `SELECT email, scope, connected_by, created_at, updated_at, expires_at
         FROM project_google_accounts WHERE project_id = ?`,
    )
    .get(projectId) as
    | {
        email: string;
        scope: string;
        connected_by: string;
        created_at: number;
        updated_at: number;
        expires_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    email: row.email ?? "",
    services: grantedServices(row.scope ?? ""),
    connectedBy: row.connected_by ?? "client",
    connectedAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Forget a project's Google credentials.
 *
 * Only the credentials. The website, the menu data already synced, the
 * published versions and the Analytics history all belong to the client and
 * are left exactly where they are; nothing in the client's Google account is
 * touched either. Disconnecting is withdrawing permission, not deleting work.
 */
export function disconnectProject(projectId: string): void {
  db.prepare("DELETE FROM project_google_accounts WHERE project_id = ?").run(projectId);
}

export async function exchangeCode(
  subject: Subject,
  code: string,
  origin: string,
  state = "",
  opts: { connectedBy?: "client" | "owner" } = {},
): Promise<{ ok: true; scope: string; email: string } | { ok: false; error: string }> {
  try {
    const form: Record<string, string> = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    };

    if (isDesktop()) {
      const verifier = takeVerifier(state);
      if (!verifier) {
        return { ok: false, error: "That sign-in took too long. Please try again." };
      }
      form.code_verifier = verifier;
      // A Desktop client may still carry a secret; send it when the operator
      // configured one, but never require it.
      if (process.env.GOOGLE_CLIENT_SECRET) {
        form.client_secret = process.env.GOOGLE_CLIENT_SECRET;
      }
    } else {
      form.client_secret = process.env.GOOGLE_CLIENT_SECRET ?? "";
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
    const data = (await res.json()) as Record<string, string | number>;
    if (!res.ok || typeof data.access_token !== "string") {
      return { ok: false, error: String(data.error_description ?? data.error ?? "Token exchange failed.") };
    }

    let email = "";
    try {
      const who = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (who.ok) email = String(((await who.json()) as { email?: string }).email ?? "");
    } catch {
      // The address is only a display convenience; the connection still works.
    }

    const scope = typeof data.scope === "string" ? data.scope : "";

    saveTokens(
      subject,
      {
        access_token: data.access_token,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
        scope: scope || undefined,
      },
      email,
      opts,
    );
    // The granted scopes are returned, not just stored: whoever started the
    // flow has to be able to say which permissions were actually approved,
    // and Google's answer is the only honest source for that.
    return { ok: true, scope, email };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Token exchange failed." };
  }
}

/**
 * A usable access token, refreshing when it is close to expiry.
 *
 * Returns null when the subject has not connected or the grant was revoked.
 * The token is returned to the caller inside the server and nowhere else: no
 * route serialises it, no page renders it, and the value is never logged.
 */
export async function accessTokenFor(subject: Subject): Promise<string | null> {
  const store = storeFor(subject);
  const row = db
    .prepare(`SELECT * FROM ${store.table} WHERE ${store.column} = ?`)
    .get(store.key) as Row | undefined;
  if (!row) return null;

  // 60s of slack so a token cannot expire mid-request.
  if (row.expires_at > Date.now() + 60_000) {
    const token = decryptSecret(row.access_token);
    if (token) return token;
  }

  const refresh = decryptSecret(row.refresh_token);
  if (!refresh) return null;

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refresh,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        ...(process.env.GOOGLE_CLIENT_SECRET
          ? { client_secret: process.env.GOOGLE_CLIENT_SECRET }
          : {}),
        grant_type: "refresh_token",
      }),
    });
    const data = (await res.json()) as Record<string, string | number>;
    if (!res.ok || typeof data.access_token !== "string") return null;

    saveTokens(
      subject,
      {
        access_token: data.access_token,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
        // A refresh response often omits the scope. Keeping the stored one is
        // right — refreshing cannot widen or narrow what was granted — and
        // guessing the base scopes here would overwrite a client's narrower
        // grant with a claim they never made.
        scope: typeof data.scope === "string" ? data.scope : row.scope,
      },
      row.email,
    );
    return data.access_token;
  } catch {
    return null;
  }
}
