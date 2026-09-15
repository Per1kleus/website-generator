import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { authorizeUrl, githubConfigured, newState } from "@/server/github/oauth";
import { isDesktop, selfOrigin } from "@/server/runtime";

/**
 * Starts the GitHub consent flow for the signed-in creator.
 *
 * Same shape as the Google connect route, deliberately: one state cookie, one
 * return cookie, both httpOnly, both short-lived. The state is what stops a
 * forged callback attaching somebody else's GitHub account to this session.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  if (!githubConfigured()) {
    return NextResponse.json(
      {
        error:
          "GitHub is not configured on this server. Ask whoever runs it to create a GitHub OAuth app and set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
      },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const returnTo = url.searchParams.get("returnTo") ?? "/";
  // The origin the server is actually reachable at. Desktop runs on an
  // ephemeral loopback port, and GitHub matches the redirect URI exactly.
  const origin = selfOrigin(url.origin);

  const state = newState();
  const jar = await cookies();
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  jar.set("wg_github_state", state, cookieOpts);
  jar.set("wg_github_return", returnTo.startsWith("/") ? returnTo : "/", cookieOpts);

  const consent = authorizeUrl(origin, state);

  // A desktop build must send the user to their own browser rather than
  // loading a sign-in page inside the app window.
  if (isDesktop() && url.searchParams.get("mode") === "url") {
    return NextResponse.json({ url: consent, flow: "system-browser" });
  }
  return NextResponse.redirect(consent);
}

export const dynamic = "force-dynamic";
