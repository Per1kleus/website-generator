import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets, saveVersion, updateProjectSite } from "@/server/projects";
import { syncPlacements } from "@/server/images";
import { googleConfigured } from "@/server/google/oauth";
import { googleAccess, subjectForProject } from "@/server/google/credentials";
import { REQUIRED_COLUMNS, SUGGESTED_CATEGORIES } from "@/server/menu/processor";
import {
  disconnectMenuSource, EMPTY_STATS, getMenuSource, recordSync, setMenuDriveFolder,
  setMenuSource,
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
    /* Which Google connection this project reads with — the client's own when
       they have connected one, otherwise the creator's. No credential. */
    google: { ...googleAccess(id, user.id), configured: googleConfigured() },
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
    folderId?: string;
    folderName?: string;
  };

  if (body.action === "disconnect") {
    disconnectMenuSource(id);
    return NextResponse.json({ ok: true, source: null });
  }

  /* The folder the dish photographs are in.
     Separate from choosing the spreadsheet because the two are chosen at
     different times — and, when a client connects their own Google account,
     by different people. Setting one must not blank the other. */
  if (body.action === "configure-folder") {
    if (!body.folderId) {
      return NextResponse.json({ error: "Choose a folder." }, { status: 400 });
    }
    const source = setMenuDriveFolder(id, {
      id: body.folderId,
      name: body.folderName ?? "",
    });
    return NextResponse.json({ ok: true, source });
  }

  if (body.action === "disconnect-folder") {
    // Only the reference is cleared. Nothing in the client's Drive is touched,
    // and images already downloaded stay on the website.
    const source = setMenuDriveFolder(id, { id: "", name: "" });
    return NextResponse.json({ ok: true, source });
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
    subject: subjectForProject(id, user.id),
    projectId: id,
    site: project.site,
    spreadsheetId: source.spreadsheet_id,
    sheetTitle: source.sheet_title,
    refreshImages: Boolean(body.refreshImages),
    // Empty unless a Drive folder is connected, in which case an `imageurl`
    // cell may be a plain file name. Existing sheets are unaffected.
    driveFolderId: source.drive_folder_id,
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
  const published = await refreshDeployment(
    id, result.site, user.id, new URL(req.url).origin,
  );

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
