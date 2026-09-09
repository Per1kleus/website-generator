import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { GoogleError, listSpreadsheets } from "@/server/google/api";

/** Spreadsheets the connected account can read, for the picker. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const query = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ spreadsheets: await listSpreadsheets(user.id, query) });
  } catch (err) {
    if (err instanceof GoogleError) {
      return NextResponse.json({ error: err.message, reauth: err.reauth }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not reach Google." }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
