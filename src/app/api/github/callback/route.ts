import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus, exchangeCode } from "@/server/github/oauth";
import { selfOrigin } from "@/server/runtime";

/** Completes the GitHub flow and stores the token, encrypted, server-side. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("wg_github_state")?.value ?? "";
  const returnTo = jar.get("wg_github_return")?.value ?? "/";
  jar.delete("wg_github_state");
  jar.delete("wg_github_return");

  const back = (reason: string) =>
    NextResponse.redirect(
      new URL(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}github=${encodeURIComponent(reason)}`,
        url.origin,
      ),
    );

  // Whatever GitHub actually said stays in the log, where a failure is
  // diagnosed. The creator gets a word the screen can translate.
  const error = url.searchParams.get("error");
  if (error) {
    console.error("[github] consent failed:", error);
    return back(error === "access_denied" ? "denied" : "failed");
  }

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state !== expected) {
    console.error("[github] callback state did not match the one issued");
    return back("state");
  }
  if (!code) {
    console.error("[github] callback carried no authorisation code");
    return back("failed");
  }

  const result = await exchangeCode(user.id, code, selfOrigin(url.origin));
  if (!result.ok) return back("failed");

  // Approving the sign-in without the repository permission would fail later,
  // at the confusing moment: halfway through a publish.
  if (connectionStatus(user.id).missingPermissions) {
    console.error("[github] connected without the repo scope");
    return back("partial");
  }

  return back("connected");
}

export const dynamic = "force-dynamic";
