import "server-only";
import { accessTokenFor } from "./oauth";
import type { Subject } from "./subject";

/**
 * Thin Google Sheets and Drive clients.
 *
 * Only read operations exist here, matching the requested scopes. Base URLs
 * are configurable so the whole flow can be exercised against a stub without
 * real Google credentials.
 */

const SHEETS_BASE = process.env.GOOGLE_SHEETS_BASE || "https://sheets.googleapis.com";
const DRIVE_BASE = process.env.GOOGLE_DRIVE_BASE || "https://www.googleapis.com";

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when reconnecting would plausibly fix it. */
    readonly reauth: boolean = false,
  ) {
    super(message);
  }
}

/**
 * One authorised request to Google.
 *
 * Exported as `googleCall` so the Analytics and Search Console clients use
 * this exact path — the same token fetch, the same timeout, the same
 * translation of Google's status codes into something a person can act on.
 * A second fetcher would eventually disagree with this one about what a 403
 * means, and the disagreement would surface as a confusing error message.
 *
 * The token is fetched, used and dropped. It is never returned, logged or
 * attached to anything that leaves the server.
 *
 * `subject` is whose credentials to use — a creator, or a project whose client
 * connected their own Google account. See `google/subject.ts`; a bare user id
 * still means the creator, which is why nothing above this line had to change.
 */
async function call(
  subject: Subject,
  url: string,
  opts: { accept?: string; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<Response> {
  const token = await accessTokenFor(subject);
  if (!token) {
    throw new GoogleError("Your Google account is not connected.", 401, true);
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: opts.accept ?? "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    // Google is an external dependency inside a creator-initiated action;
    // fail fast rather than hanging the builder UI.
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new GoogleError(
      res.status === 401
        ? "Google rejected the connection. Reconnect your account."
        : "Google denied access to that file. Check the spreadsheet is shared with the connected account.",
      res.status,
      res.status === 401,
    );
  }
  if (res.status === 404) {
    throw new GoogleError("Google could not find that — it may have been moved or removed.", 404);
  }
  if (res.status === 429) {
    throw new GoogleError("Google is rate-limiting this account. Try again shortly.", 429);
  }
  if (!res.ok) {
    throw new GoogleError(`Google returned an error (${res.status}).`, res.status);
  }
  return res;
}

export type SpreadsheetRef = { id: string; name: string; modifiedTime: string };

/** Spreadsheets the connected account can read, newest first. */
export async function listSpreadsheets(subject: Subject, query = ""): Promise<SpreadsheetRef[]> {
  const clauses = ["mimeType='application/vnd.google-apps.spreadsheet'", "trashed=false"];
  if (query.trim()) {
    clauses.push(`name contains '${driveLiteral(query.trim())}'`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const res = await call(subject, `${DRIVE_BASE}/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: SpreadsheetRef[] };
  return data.files ?? [];
}

export type DriveFolder = { id: string; name: string; modifiedTime: string };

/**
 * Drive folders the connected account can read, newest first.
 *
 * A Digital Menu's photographs live in a folder the owner already keeps them
 * in. Letting them pick it is the difference between a workable sheet — one
 * column holding `moussaka.jpg` — and asking a restaurant owner to paste
 * thirty sharing URLs correctly.
 */
export async function listFolders(subject: Subject, query = ""): Promise<DriveFolder[]> {
  const clauses = ["mimeType='application/vnd.google-apps.folder'", "trashed=false"];
  if (query.trim()) {
    clauses.push(`name contains '${driveLiteral(query.trim())}'`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const res = await call(subject, `${DRIVE_BASE}/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: DriveFolder[] };
  return data.files ?? [];
}

/**
 * Escape a value going into a Drive query string.
 *
 * Drive's `q` syntax is its own little language and a stray apostrophe in a
 * dish name — "Chef's salad.jpg" is not unusual — would end the literal and
 * change the meaning of the query.
 */
function driveLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** True for a plausible Drive id, so nothing odd reaches the query language. */
export function isDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}

/**
 * The images directly inside one folder.
 *
 * Used both to prove the folder is readable with these credentials and to
 * resolve a bare file name from a menu sheet. Not recursive: a folder of
 * photographs is a folder of photographs, and walking a whole Drive subtree
 * because a name did not match would be a surprising amount of work to do on
 * someone's behalf.
 */
export async function listFolderImages(
  subject: Subject,
  folderId: string,
  limit = 200,
): Promise<DriveFileMeta[]> {
  if (!isDriveId(folderId)) return [];
  const params = new URLSearchParams({
    q: `'${driveLiteral(folderId)}' in parents and trashed=false and mimeType contains 'image/'`,
    fields: "files(id,name,mimeType,size)",
    orderBy: "name",
    pageSize: String(Math.min(Math.max(limit, 1), 1000)),
  });
  const res = await call(subject, `${DRIVE_BASE}/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: (Partial<DriveFileMeta> & { size?: string })[] };
  return (data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    size: Number(f.size ?? 0),
  }));
}

/**
 * One named image inside a folder.
 *
 * Exact name first, then the same name ignoring case and extension, because a
 * sheet says `Moussaka` and the file is `moussaka.JPG` more often than not.
 */
export async function findInFolder(
  subject: Subject,
  folderId: string,
  name: string,
): Promise<DriveFileMeta | null> {
  const wanted = name.trim();
  if (!wanted || !isDriveId(folderId)) return null;

  const params = new URLSearchParams({
    q: `'${driveLiteral(folderId)}' in parents and trashed=false and name = '${driveLiteral(wanted)}'`,
    fields: "files(id,name,mimeType,size)",
    pageSize: "5",
  });
  const res = await call(subject, `${DRIVE_BASE}/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: (Partial<DriveFileMeta> & { size?: string })[] };
  const exact = data.files?.[0];
  if (exact?.id) {
    return {
      id: exact.id,
      name: exact.name ?? wanted,
      mimeType: exact.mimeType ?? "",
      size: Number(exact.size ?? 0),
    };
  }

  const stem = (value: string) => value.replace(/\.[a-z0-9]{2,5}$/i, "").trim().toLowerCase();
  const target = stem(wanted);
  const all = await listFolderImages(subject, folderId, 1000);
  return all.find((file) => stem(file.name) === target) ?? null;
}

export type SheetTab = { title: string; sheetId: number; rowCount: number };

export async function listTabs(
  subject: Subject,
  spreadsheetId: string,
): Promise<{ name: string; tabs: SheetTab[] }> {
  const params = new URLSearchParams({
    fields: "properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)",
  });
  const res = await call(
    subject,
    `${SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${params.toString()}`,
  );
  const data = (await res.json()) as {
    properties?: { title?: string };
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number };
      };
    }[];
  };

  return {
    name: data.properties?.title ?? "",
    tabs: (data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? "",
      sheetId: s.properties?.sheetId ?? 0,
      rowCount: s.properties?.gridProperties?.rowCount ?? 0,
    })),
  };
}

/**
 * Raw cell values for a tab.
 *
 * UNFORMATTED_VALUE keeps a checkbox as a real boolean and a price as a
 * number, rather than whatever the sheet's display locale renders — parsing a
 * localised string back into a value would be guesswork.
 */
export async function readValues(
  subject: Subject,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const range = `${sheetTitle.replace(/'/g, "''")}`;
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const res = await call(
    subject,
    `${SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${range}'`)}?${params.toString()}`,
  );
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );
}

export type DriveFileMeta = { id: string; name: string; mimeType: string; size: number };

export async function driveFileMeta(subject: Subject, fileId: string): Promise<DriveFileMeta> {
  const params = new URLSearchParams({ fields: "id,name,mimeType,size" });
  const res = await call(
    subject,
    `${DRIVE_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
  );
  const data = (await res.json()) as Partial<DriveFileMeta> & { size?: string };
  return {
    id: data.id ?? fileId,
    name: data.name ?? "",
    mimeType: data.mimeType ?? "",
    size: Number(data.size ?? 0),
  };
}

/** Downloads a Drive file's bytes. Callers must bound the size beforehand. */
export async function downloadDriveFile(subject: Subject, fileId: string): Promise<Buffer> {
  const res = await call(
    subject,
    `${DRIVE_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { accept: "*/*" },
  );
  return Buffer.from(await res.arrayBuffer());
}

/** The shared request path, for the Analytics and Search Console clients. */
export { call as googleCall };
