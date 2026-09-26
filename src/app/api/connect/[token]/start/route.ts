import { NextResponse } from "next/server";
import { selfOrigin } from "@/server/runtime";
import { resolveLink } from "@/server/connect/links";
import { startConnection } from "@/server/connect/flow";

/**
 * Send the client to Google.
 *
 * A GET, because it is reached by pressing a button that is a link: the client
 * leaves this application entirely, signs in to Google on Google's own pages,
 * and comes back. Nothing about their Google account is typed here, and this
 * server never sees a password.
 *
 * An unusable link redirects back to the connection page rather than rendering
 * an error, so the client sees one screen explaining the situation instead of a
 * bare JSON body.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const back = (reason: string) =>
    NextResponse.redirect(
      new URL(`/connect/${encodeURIComponent(token)}?google=${reason}`, url.origin),
    );

  const resolved = resolveLink(token);
  if (!resolved) return back("link");

  // The origin Google will be told to return to. It has to come from the
  // running server rather than from this request alone, because a desktop
  // install listens on an ephemeral port and Google matches the redirect URI
  // exactly.
  const started = startConnection(resolved.link, selfOrigin(url.origin));
  if (!started.ok) return back("unconfigured");

  return NextResponse.redirect(started.url);
}

export const dynamic = "force-dynamic";
