import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets, saveVersion, updateProjectSite } from "@/server/projects";
import { syncPlacements } from "@/server/images";
import { connectionInfo, googleConfigured } from "@/server/google/oauth";
import { REQUIRED_COLUMNS, SUGGESTED_CATEGORIES } from "@/server/menu/processor";
import {
  disconnectMenuSource, EMPTY_STATS, getMenuSource, recordSync, setMenuSource,
} from "@/server/menu/source";
import { syncMenu } from "@/server/menu/sync";
import { refreshDeployment } from "@/server/deploy";

/**
 * The builder application's Digital Menu Data endpoint.
 *
 * This is creator-only configuration; none of it is reachable from, or
 * embedded in, the generated public menu.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({
    google: { ...connectionInfo(user.id), configured: googleConfigured() },
    source: getMenuSource(id),
    requiredColumns: REQUIRED_COLUMNS,
    suggestedCategories: SUGGESTED_CATEGORIES,
    isMenuProject: project.site_kind === "menu",
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json()) as {
    action?: string;
    spreadsheetId?: string;
    spreadsheetName?: string;
    sheetTitle?: string;
    refreshImages?: boolean;
  };

  if (body.action === "disconnect") {
    disconnectMenuSource(id);
    return NextResponse.json({ ok: true, source: null });
  }

  if (body.action === "configure") {
    if (!body.spreadsheetId || !body.sheetTitle) {
      return NextResponse.json({ error: "Choose a spreadsheet and a sheet." }, { status: 400 });
    }
    const source = setMenuSource(id, {
      spreadsheetId: body.spreadsheetId,
      spreadsheetName: body.spreadsheetName ?? "",
      sheetTitle: body.sheetTitle,
    });
    return NextResponse.json({ ok: true, source });
  }

  /* Sync ----------------------------------------------------------------- */
  const source = getMenuSource(id);
  if (!source?.spreadsheet_id) {
    return NextResponse.json({ error: "No spreadsheet is connected yet." }, { status: 400 });
  }
  if (!project.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const result = await syncMenu({
    userId: user.id,
    projectId: id,
    site: project.site,
    spreadsheetId: source.spreadsheet_id,
    sheetTitle: source.sheet_title,
    refreshImages: Boolean(body.refreshImages),
  });

  recordSync(id, {
    ok: result.ok,
    error: result.error,
    stats: result.stats ?? EMPTY_STATS,
    findings: result.findings,
  });

  if (!result.ok || !result.site) {
    // The previously synced menu is left in place: the public page keeps
    // serving the last good data rather than emptying or inventing content.
    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "Synchronisation failed.",
        reauth: result.reauth ?? false,
        source: getMenuSource(id),
      },
      { status: 502 },
    );
  }

  // A snapshot before each sync, so a bad spreadsheet edit is always undoable.
  saveVersion(id, `Before menu sync`, project.site);
  updateProjectSite(id, user.id, syncPlacements(result.site, listAssets(id)));

  // Push the new data to an already-live site. Only the menu content changes;
  // the design is regenerated from the same unchanged theme.
  const published = await refreshDeployment(id, result.site);

  return NextResponse.json({
    ok: true,
    source: getMenuSource(id),
    stats: result.stats,
    findings: result.findings,
    republished: published,
  });
}

// Reading a sheet, downloading images and translating new strings.
export const maxDuration = 600;
