import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus } from "@/server/github/oauth";

/** Whether GitHub is connected. Never what it is connected with. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ github: connectionStatus(user.id) });
}

export const dynamic = "force-dynamic";
