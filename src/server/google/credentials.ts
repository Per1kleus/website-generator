import "server-only";
import { db } from "../db";
import { connectionStatus } from "./oauth";
import { grantedServices, projectSubject, type ConnectService, type Subject } from "./subject";

/**
 * Which Google credentials a project's work is done with.
 *
 * There are two possible answers and the order between them matters.
 *
 * 1. **The project's own connection**, made by the client through a connection
 *    link. This wins whenever it exists. It is the client's account, reading
 *    the client's analytics and the client's spreadsheet, and it stops working
 *    the moment the client withdraws it — which is the whole point.
 *
 * 2. **The creator's connection**, in `google_accounts`. This is what every
 *    project used before connection links existed, so it remains the fallback:
 *    an installation that upgrades keeps working with no reconnection, and a
 *    creator who manages a client's material themselves still can.
 *
 * Nothing else is possible. In particular a project can never reach another
 * project's credentials: the subject is built from the project id that the
 * server resolved, the token store is keyed by that id, and a request that
 * names a different project simply reads a different row — or none.
 */

export type CredentialSource = "project" | "owner" | "none";

function hasProjectConnection(projectId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM project_google_accounts WHERE project_id = ?")
    .get(projectId) as { present: number } | undefined;
  return Boolean(row);
}

function hasOwnerConnection(userId: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM google_accounts WHERE user_id = ?")
    .get(userId) as { present: number } | undefined;
  return Boolean(row);
}

/**
 * Where a project's Google access comes from, for a screen that has to explain
 * it. Never a credential — only which of the two connections is in use.
 */
export function credentialSource(projectId: string, ownerUserId: string): CredentialSource {
  if (hasProjectConnection(projectId)) return "project";
  if (ownerUserId && hasOwnerConnection(ownerUserId)) return "owner";
  return "none";
}

/**
 * The subject to pass to `accessTokenFor`, `googleCall` and everything built
 * on them.
 *
 * `ownerUserId` must be the owner this request already proved — every caller
 * has loaded the project through `getProject(id, user.id)` first, or resolved
 * it from a connection token. It is never taken from the browser.
 */
export function subjectForProject(projectId: string, ownerUserId: string): Subject {
  return hasProjectConnection(projectId) ? projectSubject(projectId) : ownerUserId;
}

/**
 * What a project can actually do with Google right now.
 *
 * The gate every project-scoped Google feature checks, so that "Analytics is
 * available" means the same thing whether the permission came from the
 * creator's own account or from the client's. Without this the insights screen
 * would keep asking the creator's connection for permission to read a property
 * that the client authorised, and refuse.
 *
 * Contains no credential and cannot be made to yield one.
 */
export type GoogleAccess = {
  source: CredentialSource;
  connected: boolean;
  /** The address that authorised this project, for confirmation on screen. */
  email: string;
  analytics: boolean;
  sheets: boolean;
  drive: boolean;
  searchConsole: boolean;
};

export function googleAccess(projectId: string, ownerUserId: string): GoogleAccess {
  const source = credentialSource(projectId, ownerUserId);

  if (source === "project") {
    const row = db
      .prepare("SELECT email, scope FROM project_google_accounts WHERE project_id = ?")
      .get(projectId) as { email: string; scope: string } | undefined;
    const services: ConnectService[] = grantedServices(row?.scope ?? "");
    const has = (service: ConnectService) => services.includes(service);
    return {
      source,
      connected: true,
      email: row?.email ?? "",
      analytics: has("analytics"),
      sheets: has("sheets"),
      drive: has("drive"),
      // A client connection never asks for Search Console: the project owner's
      // own account is the one that has the site verified in it, and asking a
      // business owner to hand over their whole Search Console would be asking
      // for more than any implemented feature needs.
      searchConsole: false,
    };
  }

  const owner = connectionStatus(ownerUserId);
  return {
    source,
    connected: owner.connected,
    email: owner.email,
    analytics: owner.analytics,
    sheets: owner.sheets,
    drive: owner.drive,
    searchConsole: owner.searchConsole,
  };
}
