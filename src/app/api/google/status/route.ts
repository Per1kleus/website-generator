import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus } from "@/server/google/oauth";

/**
 * What the signed-in creator's Google connection can do.
 *
 * Read-only and token-free by construction: `connectionStatus` selects the
 * email and the granted scopes and nothing else, so there is no path from this
 * endpoint to an access token, a refresh token or a client secret.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ google: connectionStatus(user.id) });
}

export const dynamic = "force-dynamic";
