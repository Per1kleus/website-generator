import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";
import { isDesktop } from "../runtime";

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

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent so a refresh token is actually issued, otherwise a
    // sync would stop working an hour after connecting.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
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

type Row = GoogleAccount;

/** Never returns tokens — only what the UI is allowed to know. */
export function connectionInfo(userId: string): { connected: boolean; email: string } {
  const row = db
    .prepare("SELECT email FROM google_accounts WHERE user_id = ?")
    .get(userId) as { email: string } | undefined;
  return { connected: Boolean(row), email: row?.email ?? "" };
}

export function disconnect(userId: string): void {
  db.prepare("DELETE FROM google_accounts WHERE user_id = ?").run(userId);
}

function saveTokens(
  userId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string },
  email: string,
) {
  const now = Date.now();
  const existing = db
    .prepare("SELECT refresh_token FROM google_accounts WHERE user_id = ?")
    .get(userId) as { refresh_token: string } | undefined;

  // Google omits refresh_token on re-consent in some flows; keep the old one.
  const refresh = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : (existing?.refresh_token ?? "");

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
    userId,
    email,
    encryptSecret(tokens.access_token),
    refresh,
    now + (tokens.expires_in ?? 3600) * 1000,
    tokens.scope ?? SCOPES.join(" "),
    now,
    now,
  );
}

export async function exchangeCode(
  userId: string,
  code: string,
  origin: string,
  state = "",
): Promise<{ ok: true } | { ok: false; error: string }> {
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

    saveTokens(
      userId,
      {
        access_token: data.access_token,
        refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
        scope: typeof data.scope === "string" ? data.scope : undefined,
      },
      email,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Token exchange failed." };
  }
}

/**
 * A usable access token, refreshing when it is close to expiry.
 * Returns null when the creator has not connected or the grant was revoked.
 */
export async function accessTokenFor(userId: string): Promise<string | null> {
  const row = db.prepare("SELECT * FROM google_accounts WHERE user_id = ?").get(userId) as
    | Row
    | undefined;
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
      userId,
      {
        access_token: data.access_token,
        expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
        scope: typeof data.scope === "string" ? data.scope : undefined,
      },
      row.email,
    );
    return data.access_token;
  } catch {
    return null;
  }
}
