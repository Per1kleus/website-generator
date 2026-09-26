import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { GoogleError, listSpreadsheets } from "@/server/google/api";
import { subjectForProject } from "@/server/google/credentials";

/**
 * Spreadsheets the connected account can read, for the picker.
 *
 * `projectId` is optional and narrows this to that project's own Google
 * connection — which is the client's account when the client connected one, so
 * the creator picks from the spreadsheets that actually exist there rather than
 * from their own Drive. Ownership is checked before the id is used for
 * anything, and a project that is not this creator's simply is not found.
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
    return NextResponse.json({ spreadsheets: await listSpreadsheets(subject, query) });
  } catch (err) {
    if (err instanceof GoogleError) {
      return NextResponse.json({ error: err.message, reauth: err.reauth }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not reach Google." }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
