import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { exchangeCode } from "@/server/google/oauth";

/** Completes the consent flow and stores the tokens server-side. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("wg_google_state")?.value ?? "";
  const returnTo = jar.get("wg_google_return")?.value ?? "/";

  jar.delete("wg_google_state");
  jar.delete("wg_google_return");

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`${returnTo}?google=${encodeURIComponent(reason)}`, url.origin));

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "denied" : "failed");

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state !== expected) return fail("state");
  if (!code) return fail("failed");

  const result = await exchangeCode(user.id, code, url.origin);
  if (!result.ok) return fail("failed");

  return NextResponse.redirect(new URL(`${returnTo}?google=connected`, url.origin));
}
