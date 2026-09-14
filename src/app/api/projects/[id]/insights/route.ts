import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, saveVersion, updateProjectSite } from "@/server/projects";
import { connectionStatus } from "@/server/google/oauth";
import {
  analyticsReport, clearProperty, getProperty, GoogleError, isRangeId,
  listAnalyticsProperties, listSearchConsoleSites, measurementIdFor, searchConsoleReport,
  setProperty, type RangeId,
} from "@/server/google/insights";
import { googleApiFailure } from "@/lib/google-errors";

/**
 * Analytics and Search Console for one project.
 *
 * Every response here is either something Google returned or an honest
 * statement that it did not. There is no cached "last known good" figure and
 * no placeholder: a failing API produces a message, not a number.
 *
 * Nothing in any response carries a credential. The OAuth token is used inside
 * the server-side client and never travels outward; the single Google value
 * that does reach a browser — and then only the generated website — is the
 * public measurement id.
 */

type Service = "analytics" | "searchConsole";

function fail(err: unknown) {
  if (err instanceof GoogleError) {
    // The technical reason is logged; the creator gets something actionable.
    console.error("[insights] Google refused:", err.status, err.message);
    const failure = googleApiFailure(err.status, err.reauth);
    return NextResponse.json(
      { error: failure.message, advice: failure.advice, reauth: err.reauth },
      { status: err.status === 401 ? 401 : 502 },
    );
  }
  console.error("[insights] unexpected failure:", err);
  return NextResponse.json({ error: "Could not reach Google." }, { status: 502 });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const url = new URL(req.url);
  const want = url.searchParams.get("report");
  const rangeParam = url.searchParams.get("range") ?? "28d";
  const google = connectionStatus(user.id);

  const state = {
    google: { connected: google.connected, analytics: google.analytics, searchConsole: google.searchConsole },
    analytics: getProperty(id, "analytics"),
    searchConsole: getProperty(id, "searchConsole"),
  };

  // Just the connection state, for the screen's first paint.
  if (!want) return NextResponse.json(state);

  if (!isRangeId(rangeParam)) {
    return NextResponse.json(
      { error: "That date range is not one Google reports on here." },
      { status: 400 },
    );
  }
  const range: RangeId = rangeParam;

  try {
    // Lists of what the account owns, for choosing a property.
    if (want === "analyticsProperties") {
      if (!google.analytics) {
        return NextResponse.json({ error: "Analytics access has not been granted." }, { status: 403 });
      }
      return NextResponse.json({ properties: await listAnalyticsProperties(user.id) });
    }

    if (want === "searchConsoleSites") {
      if (!google.searchConsole) {
        return NextResponse.json(
          { error: "Search Console access has not been granted." },
          { status: 403 },
        );
      }
      return NextResponse.json({ sites: await listSearchConsoleSites(user.id) });
    }

    if (want === "analytics") {
      const property = getProperty(id, "analytics");
      if (!property) {
        return NextResponse.json({ error: "No Analytics property is connected." }, { status: 400 });
      }
      return NextResponse.json({
        report: await analyticsReport(user.id, property.property_id, range),
        property,
      });
    }

    if (want === "searchConsole") {
      const property = getProperty(id, "searchConsole");
      if (!property) {
        return NextResponse.json({ error: "No Search Console property is connected." }, { status: 400 });
      }
      return NextResponse.json({
        report: await searchConsoleReport(user.id, property.property_id, range),
        property,
      });
    }

    return NextResponse.json({ error: "Unknown report." }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    service?: string;
    propertyId?: string;
    propertyName?: string;
    consentAcknowledged?: boolean;
  };
  const service = (body.service === "analytics" || body.service === "searchConsole"
    ? body.service
    : null) as Service | null;
  if (!service) return NextResponse.json({ error: "Which service?" }, { status: 400 });

  try {
    if (body.action === "disconnect") {
      clearProperty(id, service);
      // Disconnecting Analytics must also take the tag off the website, or the
      // next publish would keep sending data to a property the creator
      // believes they have disconnected.
      if (service === "analytics" && project.site?.meta.analytics) {
        const site = {
          ...project.site,
          meta: { ...project.site.meta, analytics: undefined },
        };
        saveVersion(id, "Before disconnecting Analytics", project.site);
        updateProjectSite(id, user.id, site);
      }
      return NextResponse.json({ ok: true, [service]: null });
    }

    if (body.action === "consent") {
      if (!project.site?.meta.analytics) {
        return NextResponse.json({ error: "Connect Analytics first." }, { status: 400 });
      }
      const site = {
        ...project.site,
        meta: {
          ...project.site.meta,
          analytics: {
            ...project.site.meta.analytics,
            consentAcknowledged: Boolean(body.consentAcknowledged),
          },
        },
      };
      updateProjectSite(id, user.id, site);
      return NextResponse.json({ ok: true, consentAcknowledged: Boolean(body.consentAcknowledged) });
    }

    if (!body.propertyId) return NextResponse.json({ error: "Choose a property." }, { status: 400 });

    if (service === "analytics") {
      // The public measurement id comes from Google, not from the creator
      // typing one: a mistyped id silently sends a client's traffic nowhere.
      const measurementId = await measurementIdFor(user.id, body.propertyId);
      if (!measurementId) {
        return NextResponse.json(
          {
            error: "That property has no website data stream yet.",
            advice: "In Google Analytics, add a Web data stream to this property, then try again.",
          },
          { status: 400 },
        );
      }
      setProperty(id, "analytics", {
        id: body.propertyId,
        name: body.propertyName ?? body.propertyId,
        measurementId,
      });

      // The site document carries the id, so publishing emits the tag.
      if (project.site) {
        const site = {
          ...project.site,
          meta: {
            ...project.site.meta,
            analytics: {
              measurementId,
              // Connecting is not consenting. It starts false every time, so
              // nobody is quietly opted in by reconnecting.
              consentAcknowledged: false,
            },
          },
        };
        saveVersion(id, "Before connecting Analytics", project.site);
        updateProjectSite(id, user.id, site);
      }

      return NextResponse.json({ ok: true, analytics: getProperty(id, "analytics") });
    }

    setProperty(id, "searchConsole", {
      id: body.propertyId,
      name: body.propertyName ?? body.propertyId,
    });
    return NextResponse.json({ ok: true, searchConsole: getProperty(id, "searchConsole") });
  } catch (err) {
    return fail(err);
  }
}

export const dynamic = "force-dynamic";
