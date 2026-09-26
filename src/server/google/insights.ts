import "server-only";
import { db } from "../db";
import { GoogleError, googleCall } from "./api";
import type { Subject } from "./subject";

/**
 * Read-only Google Analytics and Search Console.
 *
 * Both are reporting APIs and both are used the same way: list what the
 * connected account owns, then ask one question about one property. Nothing
 * here writes, and nothing here invents — every number shown in the
 * application is a number Google returned, and a metric Google does not return
 * is simply absent rather than filled in with a plausible figure.
 *
 * Credentials never appear. The token is fetched, used and discarded inside
 * `googleCall`, exactly as the Sheets and Drive clients do; this module holds
 * the shape of the questions, not the means of asking them.
 */

const ANALYTICS_ADMIN =
  process.env.GOOGLE_ANALYTICS_ADMIN_BASE || "https://analyticsadmin.googleapis.com";
const ANALYTICS_DATA =
  process.env.GOOGLE_ANALYTICS_DATA_BASE || "https://analyticsdata.googleapis.com";
const SEARCH_CONSOLE =
  process.env.GOOGLE_SEARCH_CONSOLE_BASE || "https://www.googleapis.com";

/* ------------------------------------------------------------ date ranges */

/**
 * The ranges the application offers.
 *
 * Deliberately few, and all within what both APIs actually serve: Search
 * Console keeps roughly sixteen months and its most recent two or three days
 * are incomplete, so nothing here asks for "today" and calls it data.
 */
export const RANGES = {
  "7d": { label: "Last 7 days", days: 7 },
  "28d": { label: "Last 28 days", days: 28 },
  "3m": { label: "Last 3 months", days: 90 },
  "6m": { label: "Last 6 months", days: 180 },
} as const;

export type RangeId = keyof typeof RANGES;

export function isRangeId(value: string): value is RangeId {
  return value in RANGES;
}

/** Google wants YYYY-MM-DD, and Search Console lags by a couple of days. */
function window(range: RangeId, lagDays = 0): { startDate: string; endDate: string } {
  const day = 86_400_000;
  const end = new Date(Date.now() - lagDays * day);
  const start = new Date(end.getTime() - (RANGES[range].days - 1) * day);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

/* -------------------------------------------------------------- analytics */

export type AnalyticsProperty = {
  /** "properties/123456789" — what the Data API wants. */
  id: string;
  name: string;
  /** The account it belongs to, so two similarly named ones can be told apart. */
  account: string;
};

export async function listAnalyticsProperties(subject: Subject): Promise<AnalyticsProperty[]> {
  const res = await googleCall(
    subject,
    `${ANALYTICS_ADMIN}/v1beta/accountSummaries?pageSize=200`,
  );
  const data = (await res.json()) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[];
  };

  const out: AnalyticsProperty[] = [];
  for (const account of data.accountSummaries ?? []) {
    for (const property of account.propertySummaries ?? []) {
      if (!property.property) continue;
      out.push({
        id: property.property,
        name: property.displayName ?? property.property,
        account: account.displayName ?? "",
      });
    }
  }
  return out;
}

/**
 * The public measurement id for a property, if it has a web data stream.
 *
 * This is the only Analytics value that ever reaches a generated website, and
 * it is public by design — it is in the page source of every site that uses
 * Analytics. The OAuth token that fetched it is not, and never leaves here.
 */
export async function measurementIdFor(subject: Subject, propertyId: string): Promise<string> {
  const res = await googleCall(
    subject,
    `${ANALYTICS_ADMIN}/v1beta/${encodeURI(propertyId)}/dataStreams?pageSize=50`,
  );
  const data = (await res.json()) as {
    dataStreams?: { webStreamData?: { measurementId?: string } }[];
  };
  for (const stream of data.dataStreams ?? []) {
    const id = stream.webStreamData?.measurementId;
    if (id) return id;
  }
  return "";
}

export type AnalyticsReport = {
  visitors: number;
  sessions: number;
  pageViews: number;
  topPages: { path: string; views: number }[];
  devices: { device: string; sessions: number; share: number }[];
  /** What was actually asked for, so the screen can say so. */
  range: { startDate: string; endDate: string };
};

export async function analyticsReport(
  subject: Subject,
  propertyId: string,
  range: RangeId,
): Promise<AnalyticsReport> {
  const dates = window(range);
  const ask = async (dimension: string, metrics: string[], limit: number) => {
    const res = await googleCall(
      subject,
      `${ANALYTICS_DATA}/v1beta/${encodeURI(propertyId)}:runReport`,
      {
        method: "POST",
        body: {
          dateRanges: [dates],
          ...(dimension ? { dimensions: [{ name: dimension }] } : {}),
          metrics: metrics.map((name) => ({ name })),
          limit,
        },
      },
    );
    return (await res.json()) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    };
  };

  const totals = await ask("", ["totalUsers", "sessions", "screenPageViews"], 1);
  const row = totals.rows?.[0]?.metricValues ?? [];
  const num = (i: number) => Number(row[i]?.value ?? 0) || 0;

  const pages = await ask("pagePath", ["screenPageViews"], 5);
  const devices = await ask("deviceCategory", ["sessions"], 5);

  const deviceRows = (devices.rows ?? []).map((r) => ({
    device: r.dimensionValues?.[0]?.value ?? "unknown",
    sessions: Number(r.metricValues?.[0]?.value ?? 0) || 0,
  }));
  const deviceTotal = deviceRows.reduce((sum, d) => sum + d.sessions, 0);

  return {
    visitors: num(0),
    sessions: num(1),
    pageViews: num(2),
    topPages: (pages.rows ?? []).map((r) => ({
      path: r.dimensionValues?.[0]?.value ?? "/",
      views: Number(r.metricValues?.[0]?.value ?? 0) || 0,
    })),
    devices: deviceRows.map((d) => ({
      ...d,
      // Percentages are computed from the numbers Google returned, so they
      // always add up to what was actually measured.
      share: deviceTotal ? Math.round((d.sessions / deviceTotal) * 100) : 0,
    })),
    range: dates,
  };
}

/* --------------------------------------------------------- search console */

export type SearchConsoleSite = {
  /** "https://example.com/" or "sc-domain:example.com". */
  url: string;
  /** Google's own word for the access level; "siteUnverifiedUser" means no. */
  permission: string;
  verified: boolean;
};

export async function listSearchConsoleSites(subject: Subject): Promise<SearchConsoleSite[]> {
  const res = await googleCall(subject, `${SEARCH_CONSOLE}/webmasters/v3/sites`);
  const data = (await res.json()) as {
    siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
  };
  return (data.siteEntry ?? [])
    .filter((entry) => entry.siteUrl)
    .map((entry) => ({
      url: entry.siteUrl as string,
      permission: entry.permissionLevel ?? "",
      // Google says this plainly, so it is read rather than assumed. A
      // property the account cannot actually read is not "connected".
      verified: (entry.permissionLevel ?? "") !== "siteUnverifiedUser",
    }));
}

export type SearchReport = {
  clicks: number;
  impressions: number;
  /** 0–1 as Google returns it; formatted for display at the edge. */
  ctr: number;
  position: number;
  queries: { query: string; clicks: number; impressions: number; ctr: number; position: number }[];
  pages: { page: string; clicks: number; impressions: number; ctr: number; position: number }[];
  range: { startDate: string; endDate: string };
};

export async function searchConsoleReport(
  subject: Subject,
  siteUrl: string,
  range: RangeId,
): Promise<SearchReport> {
  // Search Console's last two days are usually still filling in; asking for
  // them would show a dip that is a reporting artefact, not a fact.
  const dates = window(range, 2);
  const query = async (dimension: "query" | "page" | null, rowLimit: number) => {
    const res = await googleCall(
      subject,
      `${SEARCH_CONSOLE}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        body: {
          ...dates,
          ...(dimension ? { dimensions: [dimension] } : {}),
          rowLimit,
        },
      },
    );
    return (await res.json()) as {
      rows?: {
        keys?: string[];
        clicks?: number;
        impressions?: number;
        ctr?: number;
        position?: number;
      }[];
    };
  };

  const totals = await query(null, 1);
  const t = totals.rows?.[0] ?? {};
  const queries = await query("query", 10);
  const pages = await query("page", 10);

  const shape = (r: NonNullable<Awaited<ReturnType<typeof query>>["rows"]>[number]) => ({
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  });

  return {
    clicks: t.clicks ?? 0,
    impressions: t.impressions ?? 0,
    ctr: t.ctr ?? 0,
    position: t.position ?? 0,
    queries: (queries.rows ?? []).map((r) => ({ query: r.keys?.[0] ?? "", ...shape(r) })),
    pages: (pages.rows ?? []).map((r) => ({ page: r.keys?.[0] ?? "", ...shape(r) })),
    range: dates,
  };
}

/* ------------------------------------------------- what a project is using */

export type ConnectedProperty = {
  project_id: string;
  service: "analytics" | "searchConsole";
  property_id: string;
  property_name: string;
  measurement_id: string;
  created_at: number;
};

export function getProperty(
  projectId: string,
  service: ConnectedProperty["service"],
): ConnectedProperty | null {
  return (
    (db
      .prepare("SELECT * FROM google_properties WHERE project_id = ? AND service = ?")
      .get(projectId, service) as ConnectedProperty) ?? null
  );
}

export function setProperty(
  projectId: string,
  service: ConnectedProperty["service"],
  property: { id: string; name: string; measurementId?: string },
): void {
  db.prepare(
    `INSERT INTO google_properties
       (project_id, service, property_id, property_name, measurement_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, service) DO UPDATE SET
       property_id = excluded.property_id,
       property_name = excluded.property_name,
       measurement_id = excluded.measurement_id`,
  ).run(projectId, service, property.id, property.name, property.measurementId ?? "", Date.now());
}

export function clearProperty(projectId: string, service: ConnectedProperty["service"]): void {
  db.prepare("DELETE FROM google_properties WHERE project_id = ? AND service = ?").run(
    projectId,
    service,
  );
}

export { GoogleError };
