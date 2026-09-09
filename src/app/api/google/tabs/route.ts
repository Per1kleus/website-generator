import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { GoogleError, listTabs } from "@/server/google/api";

/** Tabs within one spreadsheet, for the second step of the picker. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const spreadsheetId = new URL(req.url).searchParams.get("spreadsheetId") ?? "";
  if (!spreadsheetId) {
    return NextResponse.json({ error: "No spreadsheet was given." }, { status: 400 });
  }

  try {
    return NextResponse.json(await listTabs(user.id, spreadsheetId));
  } catch (err) {
    if (err instanceof GoogleError) {
      return NextResponse.json({ error: err.message, reauth: err.reauth }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not reach Google." }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
