import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus, exchangeCode } from "@/server/google/oauth";
import { isDesktop, selfOrigin } from "@/server/runtime";
import { googleFailure } from "@/lib/google-errors";
import { completeConnection } from "@/server/connect/flow";
import { dropConnectState, peekConnectState } from "@/server/connect/links";

/**
 * Completes the consent flow and stores the tokens server-side.
 *
 * Two flows come back through this one URL, and that is deliberate: Google
 * matches a redirect URI exactly, and requiring a second one to be registered
 * would make client connections an installation step rather than a feature.
 *
 * They are told apart by the state. A client connection's state is a row
 * created when the link was opened; a creator's is a value in their own
 * httpOnly cookie. The client branch is tried first and, crucially, before any
 * session is looked for — the client has no session and must not be sent to a
 * login page.
 */
export async function GET(req: Request) {
  const clientConnection = await handleClientConnection(req);
  if (clientConnection) return clientConnection;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("wg_google_state")?.value ?? "";
  const returnTo = jar.get("wg_google_return")?.value ?? "/";

  jar.delete("wg_google_state");
  jar.delete("wg_google_return");

  const fail = (reason: string) =>
    isDesktop()
      ? closeTab(reason)
      : NextResponse.redirect(
          new URL(`${returnTo}?google=${encodeURIComponent(reason)}`, url.origin),
        );

  // Whatever Google actually said is kept here, where a failure is diagnosed.
  // What the creator sees is the translation in lib/google-errors.ts; the two
  // are deliberately different audiences.
  const error = url.searchParams.get("error");
  if (error) {
    console.error("[google] consent failed:", error);
    return fail(error === "access_denied" ? "denied" : "failed");
  }

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state !== expected) {
    console.error("[google] callback state did not match the one issued");
    return fail("state");
  }
  if (!code) {
    console.error("[google] callback carried no authorisation code");
    return fail("failed");
  }

  const result = await exchangeCode(user.id, code, selfOrigin(url.origin), state);
  if (!result.ok) {
    console.error("[google] token exchange failed");
    return fail("failed");
  }

  // Consent is per permission: someone can approve reading spreadsheets and
  // decline reading Drive, and the flow still "succeeds". Saying so now is the
  // difference between a clear message here and a confusing failure later,
  // when a menu image silently will not load.
  if (connectionStatus(user.id).missingPermissions) {
    console.error("[google] connected with an incomplete set of scopes");
    return fail("partial");
  }

  // On desktop this page is open in the user's own browser, not in the app.
  // Redirecting would leave them staring at the builder in the wrong window,
  // so tell them plainly to go back and let the app pick the change up.
  if (isDesktop()) return closeTab();

  return NextResponse.redirect(new URL(`${returnTo}?google=connected`, url.origin));
}

/**
 * The client-connection branch.
 *
 * Returns a response when this callback belongs to a connection link, and null
 * when it does not — in which case the creator's own flow carries on below,
 * unchanged.
 *
 * Nothing here needs, or looks at, a session. What authorises the write is the
 * state row, which names the link, which names the project. A callback whose
 * state is not one of ours is not ours.
 */
async function handleClientConnection(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  if (!state) return null;

  // Looked at without consuming: if this turns out to be a creator's callback
  // the row must still be here for the real attempt.
  const pending = peekConnectState(state);
  if (!pending) return null;

  const to = (token: string, query: string) =>
    NextResponse.redirect(new URL(`/connect/${encodeURIComponent(token)}?${query}`, url.origin));

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code") ?? "";

  if (error || !code) {
    // Whatever Google said is kept where a failure is diagnosed. The client
    // sees a sentence they can act on. The attempt is thrown away either way,
    // so a refused consent screen cannot be replayed into a successful one.
    console.error("[connect] consent did not complete:", error || "no code");
    dropConnectState(state);
    return to(pending.link_id, `google=${error === "access_denied" ? "denied" : "failed"}`);
  }

  const result = await completeConnection(state, code, selfOrigin(url.origin));
  if (!result.ok) {
    return to(result.token ?? pending.link_id, `google=${result.reason}`);
  }

  // Consent is per permission: a client can approve reading their analytics
  // and decline the rest, and the flow still "succeeds". Saying so now is the
  // difference between one clear sentence here and a mystery later.
  return to(result.token, result.missing.length ? "google=partial" : "google=connected");
}

/**
 * The page the system browser lands on after consent, in a desktop build.
 *
 * Self-contained: it is served to an ordinary browser tab that has no access
 * to the application's styles, and it must read clearly to a non-technical
 * user in either outcome.
 */
function closeTab(reason = ""): Response {
  const failed = Boolean(reason);
  const problem = failed ? googleFailure(reason) : null;
  const title = failed
    ? reason === "partial"
      ? "Some permissions were not approved"
      : "Google was not connected"
    : "Google connected";
  const body = problem
    ? `${problem.message} ${problem.advice}`
    : "You can close this tab and return to Website Generator.";

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:#f7f7f8;color:#14141a}
@media (prefers-color-scheme:dark){body{background:#0d0d11;color:#f2f2f5}}
main{max-width:24rem;padding:2rem;text-align:center}
h1{font-size:1.125rem;margin:0 0 .5rem}
p{color:#62626e;font-size:.9375rem;line-height:1.55;margin:0}
@media (prefers-color-scheme:dark){p{color:#a0a0ad}}
.mark{font-size:2.5rem;margin-bottom:.75rem}
</style></head><body><main>
<div class="mark" aria-hidden="true">${failed ? "\u26a0\ufe0f" : "\u2705"}</div>
<h1>${title}</h1><p>${body}</p>
</main></body></html>`,
    {
      status: failed ? 400 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}
