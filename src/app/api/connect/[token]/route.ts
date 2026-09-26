import { NextResponse } from "next/server";
import { listAnalyticsProperties } from "@/server/google/insights";
import { GoogleError, listFolders, listSpreadsheets, listTabs } from "@/server/google/api";
import { projectConnection } from "@/server/google/oauth";
import { projectSubject, isConnectService, type ConnectService } from "@/server/google/subject";
import { resolveLink } from "@/server/connect/links";
import { SERVICE_PURPOSE } from "@/server/connect/flow";
import { connectionView, selectResource, verifyAll } from "@/server/connect/verify";

/**
 * The client's side of a connection link.
 *
 * Reached without a session, by someone who has no account here. The token in
 * the path is the whole authorisation, and it names exactly one project — so
 * every handler below starts from `resolveLink` and works on the project that
 * comes back. There is no parameter anywhere in this file by which a caller
 * could name a project, a user or a token store.
 *
 * `notFound()`-shaped failure is uniform on purpose: an unknown token, a
 * withdrawn link, an expired link and a deleted project all produce the same
 * 404 with the same sentence, so probing the space tells the prober nothing —
 * not even whether a token was once real.
 */

const GENERIC = "This link is not valid. Ask for a new one.";

function notFound() {
  return NextResponse.json({ error: GENERIC }, { status: 404 });
}

/** The public shape. No project id, no user, no ids the client did not choose. */
function publicView(token: string) {
  const resolved = resolveLink(token);
  if (!resolved) return null;
  const { link, project } = resolved;
  const view = connectionView(project);

  return {
    businessName: project.business_name,
    /* Which permissions this link asks for, each with the reason. The list
       comes from the link row, so the screen cannot show — or ask for —
       anything the token was not created with. */
    asks: link.services.map((service) => ({
      service,
      ...SERVICE_PURPOSE[service],
    })),
    googleConnected: Boolean(projectConnection(project.id)),
    connectedEmail: view.email,
    status: view.status,
    services: view.services.filter((s) => link.services.includes(s.service)),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const view = publicView(token);
  if (!view) return notFound();
  return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const resolved = resolveLink(token);
  if (!resolved) return notFound();
  const { link, project } = resolved;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    service?: string;
    id?: string;
    name?: string;
    sheetTitle?: string;
    query?: string;
  };

  /* A service the link does not ask for is not "forbidden", it is unknown:
     this link has no notion of it. */
  const service: ConnectService | null =
    body.service && isConnectService(body.service) && link.services.includes(body.service)
      ? body.service
      : null;

  /* Everything past this point reads Google, and reads it strictly as the
     client's own connection.

     `projectSubject` rather than the usual fallback resolution: the creator's
     credentials must never be reachable from an unauthenticated route, so a
     project with no connection of its own cannot list anything here, even
     though the builder screens legitimately would. */
  if (!projectConnection(project.id)) {
    return NextResponse.json(
      { error: "Connect your Google account first." },
      { status: 400 },
    );
  }
  const subject = projectSubject(project.id);

  try {
    if (body.action === "resources") {
      if (!service) return NextResponse.json({ error: "Nothing to choose." }, { status: 400 });

      if (service === "analytics") {
        const properties = await listAnalyticsProperties(subject);
        // Only what the picker shows. Google's own account/property names, as
        // the client already sees them in Analytics.
        return NextResponse.json({
          choices: properties.map((p) => ({
            id: p.id,
            name: p.name,
            detail: p.account,
          })),
        });
      }

      if (service === "sheets") {
        // Second step: the tabs inside a chosen file.
        if (body.id) {
          const { tabs } = await listTabs(subject, body.id);
          return NextResponse.json({ tabs: tabs.map((t) => ({ title: t.title, rows: t.rowCount })) });
        }
        const files = await listSpreadsheets(subject, body.query ?? "");
        return NextResponse.json({
          choices: files.map((f) => ({ id: f.id, name: f.name, detail: "" })),
        });
      }

      const folders = await listFolders(subject, body.query ?? "");
      return NextResponse.json({
        choices: folders.map((f) => ({ id: f.id, name: f.name, detail: "" })),
      });
    }

    if (body.action === "select") {
      if (!service) return NextResponse.json({ error: "Nothing to choose." }, { status: 400 });
      const result = await selectResource({
        project,
        service,
        id: body.id ?? "",
        name: body.name,
        sheetTitle: body.sheetTitle,
      });
      return NextResponse.json(
        result.ok
          ? { ok: true, ...publicView(token) }
          : { error: result.error, advice: result.advice },
        { status: result.ok ? 200 : 400 },
      );
    }

    if (body.action === "verify") {
      await verifyAll(project);
      return NextResponse.json({ ok: true, ...publicView(token) });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    /* Google's own words are logged, where a developer will look for them, and
       never sent to the client — a business owner reading "403
       insufficientPermissions" learns nothing they can act on. */
    if (err instanceof GoogleError) {
      console.error("[connect] Google refused:", err.status, err.message);
      return NextResponse.json(
        {
          error:
            err.status === 401
              ? "Your Google connection has expired. Please connect again."
              : "Google would not answer that just now. Please try again shortly.",
          reauth: err.status === 401,
        },
        { status: err.status === 401 ? 401 : 502 },
      );
    }
    console.error("[connect] unexpected failure:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
