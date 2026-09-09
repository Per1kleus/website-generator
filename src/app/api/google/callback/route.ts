import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { exchangeCode } from "@/server/google/oauth";
import { isDesktop, selfOrigin } from "@/server/runtime";

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
    isDesktop()
      ? closeTab(reason)
      : NextResponse.redirect(
          new URL(`${returnTo}?google=${encodeURIComponent(reason)}`, url.origin),
        );

  const error = url.searchParams.get("error");
  if (error) return fail(error === "access_denied" ? "denied" : "failed");

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || state !== expected) return fail("state");
  if (!code) return fail("failed");

  const result = await exchangeCode(user.id, code, selfOrigin(url.origin), state);
  if (!result.ok) return fail("failed");

  // On desktop this page is open in the user's own browser, not in the app.
  // Redirecting would leave them staring at the builder in the wrong window,
  // so tell them plainly to go back and let the app pick the change up.
  if (isDesktop()) return closeTab();

  return NextResponse.redirect(new URL(`${returnTo}?google=connected`, url.origin));
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
  const title = failed ? "Google was not connected" : "Google connected";
  const body = failed
    ? reason === "denied"
      ? "You declined the permission request. Nothing was changed."
      : "Something went wrong. Go back to Website Generator and try again."
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
