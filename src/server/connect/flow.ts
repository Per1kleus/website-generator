import "server-only";
import { authorizeUrl, exchangeCode, googleConfigured } from "../google/oauth";
import { projectSubject, scopesFor, grantedServices, type ConnectService } from "../google/subject";
import type { Project } from "../projects";
import {
  createState, markLinkUsed, recordEvent, resolveLink, setServiceStatus, takeState,
  type ConnectLink,
} from "./links";

/**
 * Starting and finishing a client's authorisation.
 *
 * The Google OAuth *application* is the developer's, registered once, with one
 * redirect URI. The Google *account* is the client's. Those are different
 * things and keeping them separate is what makes this work without anybody
 * sharing a password: the client signs in to Google directly, Google asks them
 * whether this application may read the two or three things it named, and what
 * comes back to the server is a grant tied to their account.
 *
 * Nothing new is registered with Google for this. The same callback URL the
 * creator's own connection uses is reused, and which flow a callback belongs to
 * is decided by whether its state matches a connection attempt.
 */

export type StartResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * The consent URL for one link.
 *
 * The scopes come from the link's service list, which came from the project's
 * kind when the link was made. A brochure website's link therefore asks for
 * read access to Analytics and for nothing else — not because the screen hides
 * the rest, but because the request physically does not contain them.
 */
export function startConnection(link: ConnectLink, origin: string): StartResult {
  if (!googleConfigured()) {
    return {
      ok: false,
      error: "This website builder has not been set up for Google connections yet.",
    };
  }
  if (!link.services.length) {
    return { ok: false, error: "This link does not ask for any permissions." };
  }

  const scopes = scopesFor(link.services);
  const state = createState(link.id, scopes);
  // `exact` so the consent screen asks for these scopes and no others.
  // Incremental consent is right for a creator adding a feature to their own
  // account and wrong here: it would re-grant whatever this Google account
  // once allowed for a different project.
  return { ok: true, url: authorizeUrl(origin, state, scopes, { exact: true }) };
}

export type CompleteResult =
  | {
      ok: true;
      token: string;
      projectId: string;
      /** What the client actually approved, which may be less than was asked. */
      granted: ConnectService[];
      missing: ConnectService[];
    }
  | { ok: false; reason: string; token?: string };

/**
 * Finish an authorisation.
 *
 * The state row is what turns an anonymous callback into "this client, for this
 * project". It is consumed here, so a replayed callback — from a bookmark, a
 * browser prefetch or a copied URL — does nothing at all.
 *
 * The project is read from the link, never from the request. There is no
 * parameter by which a callback could name a different project.
 */
export async function completeConnection(
  state: string,
  code: string,
  origin: string,
): Promise<CompleteResult> {
  const attempt = takeState(state);
  if (!attempt) return { ok: false, reason: "state" };

  const resolved = resolveLink(attempt.link_id);
  // Revoked or expired between pressing the button and coming back. The
  // reason is deliberately the same one an unknown token gets.
  if (!resolved) return { ok: false, reason: "link" };

  const { link, project } = resolved;
  const exchanged = await exchangeCode(
    projectSubject(project.id),
    code,
    origin,
    state,
    { connectedBy: "client" },
  );

  if (!exchanged.ok) {
    console.error("[connect] token exchange failed for a client connection");
    recordEvent(project.id, "connect-failed", { detail: "token exchange" });
    return { ok: false, reason: "failed", token: link.id };
  }

  const granted = grantedServices(exchanged.scope);
  const missing = link.services.filter((service) => !granted.includes(service));

  markLinkUsed(link.id);
  recordEvent(project.id, "connected", {
    // The address is what a developer needs to tell one client's connection
    // from another's. It is not a credential, and it is what the client
    // themselves chose to sign in with.
    detail: `${exchanged.email || "an account"} granted ${granted.join(" ") || "nothing"}`,
  });

  /* Every service starts at "connecting", not "connected": consent has
     happened and nothing has been proved yet. A service the client declined
     is recorded as not connected, with the reason, rather than left blank. */
  for (const service of link.services) {
    if (granted.includes(service)) {
      setServiceStatus(project.id, service, "connecting");
    } else {
      setServiceStatus(project.id, service, "not_connected", {
        error: "This permission was not approved.",
      });
    }
  }

  return { ok: true, token: link.id, projectId: project.id, granted, missing };
}

/** What each permission is for, in the client's language. */
export const SERVICE_PURPOSE: Record<ConnectService, { label: string; why: string }> = {
  analytics: {
    label: "Google Analytics",
    why: "So your visitor numbers can be shown to you. Read-only — nothing is changed or added.",
  },
  sheets: {
    label: "Your menu spreadsheet",
    why: "So the menu on your website is taken from the spreadsheet you already keep it in. Read-only.",
  },
  drive: {
    label: "Your menu photographs",
    why: "So the dish photographs in your Drive folder can appear on the menu. Read-only.",
  },
};

/** Convenience for a screen that has a token and wants the project. */
export function projectForToken(token: string): Project | null {
  return resolveLink(token)?.project ?? null;
}
