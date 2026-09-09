import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { authorizeUrl, googleConfigured } from "@/server/google/oauth";

/** Starts the Google consent flow for the signed-in creator. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  if (!googleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/";

  // A random state, held in an httpOnly cookie, so a forged callback cannot
  // attach someone else's Google account to this session.
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("wg_google_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  jar.set("wg_google_return", returnTo.startsWith("/") ? returnTo : "/", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authorizeUrl(url.origin, state));
}
