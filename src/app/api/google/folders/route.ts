import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { GoogleError, listFolders } from "@/server/google/api";
import { subjectForProject } from "@/server/google/credentials";

/**
 * Drive folders, for choosing where a menu's photographs live.
 *
 * `projectId` selects that project's own Google connection — the client's
 * account when they connected one — and is checked for ownership before it is
 * used for anything, exactly as the spreadsheet picker does.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const query = url.searchParams.get("q") ?? "";
  const projectId = url.searchParams.get("projectId") ?? "";
  if (projectId && !getProject(projectId, user.id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const subject = projectId ? subjectForProject(projectId, user.id) : user.id;

  try {
    return NextResponse.json({ folders: await listFolders(subject, query) });
  } catch (err) {
    if (err instanceof GoogleError) {
      return NextResponse.json({ error: err.message, reauth: err.reauth }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not reach Google." }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
