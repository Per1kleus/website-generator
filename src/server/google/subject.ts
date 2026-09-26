/**
 * Whose Google account a call is made with.
 *
 * Until now every Google call took a `userId`, which was really answering a
 * different question: *which stored credential should this request use?* For a
 * creator building their own sites those are the same thing. The moment a
 * client connects their own Google account to one project they stop being the
 * same thing — the credential belongs to the project, not to the person
 * pressing buttons in the builder.
 *
 * So the parameter becomes a subject, in one of two shapes:
 *
 *   `<userId>`            the creator's own connection, in google_accounts.
 *   `project:<projectId>` the client's connection, in project_google_accounts.
 *
 * A bare id is still a user, which is what makes every existing call site and
 * every existing installation keep working untouched.
 *
 * This module is pure string handling on purpose: the token stores import it,
 * so it must not import them back.
 */

export type Subject = string;

const PROJECT_PREFIX = "project:";

export function projectSubject(projectId: string): Subject {
  return `${PROJECT_PREFIX}${projectId}`;
}

export type ParsedSubject =
  | { kind: "user"; id: string }
  | { kind: "project"; id: string };

export function parseSubject(subject: Subject): ParsedSubject {
  return subject.startsWith(PROJECT_PREFIX)
    ? { kind: "project", id: subject.slice(PROJECT_PREFIX.length) }
    : { kind: "user", id: subject };
}

export function isProjectSubject(subject: Subject): boolean {
  return subject.startsWith(PROJECT_PREFIX);
}

/* -------------------------------------------------------------- services */

/**
 * The services a project's Google account can be asked to authorise, and the
 * single read-only scope each one needs.
 *
 * One scope per service, all `.readonly`, and each one tied to an operation
 * that is already implemented: Analytics because the insights screen runs
 * reports, Sheets because the menu is read from a spreadsheet, Drive because
 * the menu's photographs are fetched from it. Nothing here grants a write.
 */
export const SERVICE_SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
  drive: "https://www.googleapis.com/auth/drive.readonly",
} as const;

export type ConnectService = keyof typeof SERVICE_SCOPES;

export const CONNECT_SERVICES = Object.keys(SERVICE_SCOPES) as ConnectService[];

export function isConnectService(value: string): value is ConnectService {
  return value in SERVICE_SCOPES;
}

/**
 * What a project of this kind actually needs.
 *
 * An ordinary website needs Analytics and nothing else. Asking a hairdresser
 * to hand over read access to their entire Google Drive so that a brochure
 * site can count visitors would be indefensible, and would rightly get the
 * whole consent screen declined.
 *
 * A Digital Menu needs all three, because its content *is* a spreadsheet and
 * its photographs *are* in Drive.
 */
export function servicesForKind(siteKind: string): ConnectService[] {
  return siteKind === "menu" ? ["analytics", "sheets", "drive"] : ["analytics"];
}

export function scopesFor(services: readonly ConnectService[]): string[] {
  // Deduplicated and ordered, so two requests for the same services produce
  // the same scope string and the same consent screen.
  return CONNECT_SERVICES.filter((s) => services.includes(s)).map((s) => SERVICE_SCOPES[s]);
}

/** Which of the services a granted scope string actually covers. */
export function grantedServices(scope: string): ConnectService[] {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return CONNECT_SERVICES.filter((s) => granted.has(SERVICE_SCOPES[s]));
}
