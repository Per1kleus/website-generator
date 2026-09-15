import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { decryptSecret, encryptSecret } from "../crypto";

/**
 * GitHub authentication for publishing.
 *
 * This is the same shape as `server/google/oauth.ts` on purpose. There is one
 * credential store, one encryption helper, one "connected / not connected"
 * status type and one place a token is decrypted — adding a second
 * authentication system with its own conventions is how a credential
 * eventually ends up somewhere it should not be.
 *
 * Two ways in, and the difference matters enough to be visible in the UI:
 *
 *   **OAuth** — the creator connects their own GitHub account. Each creator
 *   publishes to their own repositories under their own login. This is the
 *   production path for a shared deployment.
 *
 *   **Operator token** — whoever runs this copy sets WG_GITHUB_TOKEN in the
 *   server environment. Everyone on this install publishes as that account.
 *   That is exactly right for a single-operator install (the desktop build,
 *   or an agency running their own server) and exactly wrong for a shared
 *   one, which is why `connectionStatus` says which of the two is in force
 *   rather than reporting a bare "connected".
 *
 * In both cases the token is used only inside server modules. It is never
 * returned by a route, never rendered into a page, never written into a
 * generated website and never logged.
 */

const GITHUB_API = process.env.GITHUB_API_BASE || "https://api.github.com";
const GITHUB_WEB = process.env.GITHUB_WEB_BASE || "https://github.com";

/**
 * The narrowest scope that can do the job.
 *
 * `repo` covers creating a private repository, pushing to it and changing its
 * Pages settings. GitHub has no finer-grained classic scope that includes
 * private repositories — `public_repo` would make every client website public,
 * which is the one thing this feature must not do.
 */
export const SCOPES = ["repo"];

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

/**
 * An operator-wide token, when this install is deliberately configured with
 * one.
 *
 * Namespaced deliberately. `GITHUB_TOKEN` is set by GitHub Actions on every
 * run, by the `gh` CLI, and by a long list of unrelated tools — reading it
 * would mean an install silently gaining the ability to publish to somebody's
 * GitHub account because a CI system exported a variable for its own reasons.
 * An operator who wants this says so in a variable that could only be meant
 * for this application.
 */
function operatorToken(): string {
  return process.env.WG_GITHUB_TOKEN?.trim() ?? "";
}

export function redirectUri(origin: string): string {
  return (
    process.env.GITHUB_REDIRECT_URI || `${origin.replace(/\/+$/, "")}/api/github/callback`
  );
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID ?? "",
    redirect_uri: redirectUri(origin),
    scope: SCOPES.join(" "),
    state,
    allow_signup: "false",
  });
  return `${GITHUB_WEB}/login/oauth/authorize?${params.toString()}`;
}

export type GitHubAccount = {
  user_id: string;
  login: string;
  access_token: string;
  scope: string;
  created_at: number;
  updated_at: number;
};

/**
 * What the creator's GitHub connection can currently do.
 *
 * No token, and nothing a token could be reconstructed from. This is the
 * shape a browser is allowed to see.
 */
export type GitHubStatus = {
  /** Whether this deployment has GitHub OAuth credentials at all. */
  configured: boolean;
  connected: boolean;
  /** The account websites are published under. A login, never an email. */
  login: string;
  /**
   * How the connection was made. "operator" means the server holds one token
   * for everybody, which is worth saying out loud: a creator who disconnects
   * cannot disconnect it, because it is not theirs.
   */
  via: "none" | "oauth" | "operator";
  /** True when connected but without the permission to create private repos. */
  missingPermissions: boolean;
};

export function connectionStatus(userId: string): GitHubStatus {
  const row = db
    .prepare("SELECT login, scope FROM github_accounts WHERE user_id = ?")
    .get(userId) as { login: string; scope: string } | undefined;

  if (row) {
    const granted = (row.scope ?? "").split(/[\s,]+/).filter(Boolean);
    // An older row may predate scope being stored. Absent is not "denied":
    // the connection was made with exactly these scopes, so treat it as
    // granted rather than telling the creator to reconnect for no reason.
    const unknown = granted.length === 0;
    return {
      configured: githubConfigured(),
      connected: true,
      login: row.login ?? "",
      via: "oauth",
      missingPermissions: !unknown && !granted.includes("repo"),
    };
  }

  if (operatorToken()) {
    return {
      configured: githubConfigured(),
      connected: true,
      login: process.env.WG_GITHUB_LOGIN?.trim() || "",
      via: "operator",
      missingPermissions: false,
    };
  }

  return {
    configured: githubConfigured(),
    connected: false,
    login: "",
    via: "none",
    missingPermissions: false,
  };
}

export function disconnect(userId: string): void {
  db.prepare("DELETE FROM github_accounts WHERE user_id = ?").run(userId);
}

function saveToken(userId: string, token: string, login: string, scope: string) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO github_accounts (user_id, login, access_token, scope, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       login = excluded.login,
       access_token = excluded.access_token,
       scope = excluded.scope,
       updated_at = excluded.updated_at`,
  ).run(userId, login, encryptSecret(token), scope, now, now);
}

/** A short-lived state value, so a forged callback cannot attach an account. */
export function newState(): string {
  return randomBytes(16).toString("hex");
}

export async function exchangeCode(
  userId: string,
  code: string,
  origin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID ?? "",
        client_secret: process.env.GITHUB_CLIENT_SECRET ?? "",
        code,
        redirect_uri: redirectUri(origin),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const data = (await res.json()) as {
      access_token?: string;
      scope?: string;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      // GitHub's own words are useful to whoever runs the server and useless
      // to the creator, so they are logged rather than shown.
      console.error("[github] token exchange refused:", data.error ?? res.status);
      return { ok: false, error: "GitHub did not complete the sign-in." };
    }

    // The login is what the creator will see next to "publishing as", so it
    // comes from GitHub rather than from anything the browser sent.
    let login = "";
    try {
      const who = await fetch(`${GITHUB_API}/user`, {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (who.ok) login = String(((await who.json()) as { login?: string }).login ?? "");
    } catch {
      // A missing login is cosmetic; the connection itself is fine.
    }

    saveToken(userId, data.access_token, login, data.scope ?? SCOPES.join(" "));
    return { ok: true };
  } catch (err) {
    console.error("[github] token exchange failed:", err);
    return { ok: false, error: "GitHub could not be reached to complete the sign-in." };
  }
}

/**
 * The token to publish with, or null.
 *
 * The only function in the application that returns a GitHub token, and it is
 * `server-only`. Callers use it and drop it; nothing stores the result.
 */
export function tokenFor(userId: string): string | null {
  const row = db
    .prepare("SELECT access_token FROM github_accounts WHERE user_id = ?")
    .get(userId) as { access_token: string } | undefined;
  if (row) {
    const token = decryptSecret(row.access_token);
    if (token) return token;
  }
  return operatorToken() || null;
}

/**
 * The account websites are published under.
 *
 * Needed before any network call, because the GitHub Pages URL — and so every
 * canonical link in the bundle — contains the owner's login.
 */
export async function ownerLogin(userId: string): Promise<string> {
  const status = connectionStatus(userId);
  if (status.login) return status.login;

  const token = tokenFor(userId);
  if (!token) return "";
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return "";
    const login = String(((await res.json()) as { login?: string }).login ?? "");
    // Remember it, so the next publish does not need the round trip.
    if (login && status.via === "oauth") {
      db.prepare("UPDATE github_accounts SET login = ? WHERE user_id = ?").run(login, userId);
    }
    return login;
  } catch {
    return "";
  }
}
