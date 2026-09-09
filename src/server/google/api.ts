import "server-only";
import { accessTokenFor } from "./oauth";

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

async function call(userId: string, url: string, accept = "application/json"): Promise<Response> {
  const token = await accessTokenFor(userId);
  if (!token) {
    throw new GoogleError("Your Google account is not connected.", 401, true);
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
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
    throw new GoogleError("That spreadsheet no longer exists, or was moved.", 404);
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
export async function listSpreadsheets(userId: string, query = ""): Promise<SpreadsheetRef[]> {
  const clauses = ["mimeType='application/vnd.google-apps.spreadsheet'", "trashed=false"];
  if (query.trim()) {
    // Escape single quotes: they terminate the Drive query string literal.
    clauses.push(`name contains '${query.trim().replace(/'/g, "\\'")}'`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const res = await call(userId, `${DRIVE_BASE}/drive/v3/files?${params.toString()}`);
  const data = (await res.json()) as { files?: SpreadsheetRef[] };
  return data.files ?? [];
}

export type SheetTab = { title: string; sheetId: number; rowCount: number };

export async function listTabs(
  userId: string,
  spreadsheetId: string,
): Promise<{ name: string; tabs: SheetTab[] }> {
  const params = new URLSearchParams({
    fields: "properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)",
  });
  const res = await call(
    userId,
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
  userId: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const range = `${sheetTitle.replace(/'/g, "''")}`;
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const res = await call(
    userId,
    `${SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${range}'`)}?${params.toString()}`,
  );
  const data = (await res.json()) as { values?: unknown[][] };
  return (data.values ?? []).map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
  );
}

export type DriveFileMeta = { id: string; name: string; mimeType: string; size: number };

export async function driveFileMeta(userId: string, fileId: string): Promise<DriveFileMeta> {
  const params = new URLSearchParams({ fields: "id,name,mimeType,size" });
  const res = await call(
    userId,
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
export async function downloadDriveFile(userId: string, fileId: string): Promise<Buffer> {
  const res = await call(
    userId,
    `${DRIVE_BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    "*/*",
  );
  return Buffer.from(await res.arrayBuffer());
}
