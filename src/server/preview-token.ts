import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { derivedKey } from "./crypto";

/**
 * A capability for one project's preview, and nothing else.
 *
 * The live preview runs the generated website in a sandboxed frame with no
 * origin of its own, which is what keeps it away from this application's
 * cookies, storage, DOM and APIs. The cost of that isolation is that the
 * framed document cannot authenticate with the session cookie: a request it
 * makes is cross-site by construction, so `wg_session` (SameSite=Lax) is not
 * attached.
 *
 * The website still needs its own photographs, and switching language still
 * has to fetch the next page. So the render endpoint mints one of these and
 * puts it in those URLs. It is deliberately the weakest credential in the
 * system:
 *
 *   - it names exactly one project, and grants nothing outside it;
 *   - it is read-only by construction — no endpoint that writes accepts one;
 *   - it expires within two hours, and never lasts less than one;
 *   - it is signed with a key derived from the app secret for this purpose
 *     alone, so it cannot be replayed as a session or a stored-token key.
 *
 * If it leaks, what leaks is the ability to read a website its owner is about
 * to publish to the public internet anyway.
 */

/**
 * Tokens are issued per window rather than per request.
 *
 * Every render would otherwise mint a fresh token, giving every image a URL
 * nobody had seen before — the browser would re-download the whole gallery on
 * each refresh, and two renders of the same page would differ in their query
 * strings alone. Rounding the expiry up to the next hour makes the URL for a
 * given asset stable for at least an hour, so the cache works and two renders
 * agree byte for byte.
 */
const WINDOW_MS = 1000 * 60 * 60;
const KEY_PURPOSE = "preview-token/v1";

function sign(payload: string): string {
  return createHmac("sha256", derivedKey(KEY_PURPOSE)).update(payload).digest("base64url");
}

export function mintPreviewToken(projectId: string, now = Date.now()): string {
  // One window past the end of the current one, so a token minted at :59 is
  // still good for an hour rather than for a minute.
  const expiry = (Math.floor(now / WINDOW_MS) + 2) * WINDOW_MS;
  const payload = `${projectId}.${expiry}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** The project this token may read, or null if it is invalid or expired. */
export function readPreviewToken(token: string, now = Date.now()): string | null {
  const [encoded, signature] = (token ?? "").split(".");
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a mismatch rather than returning false.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const separator = payload.lastIndexOf(".");
  if (separator < 1) return null;
  const projectId = payload.slice(0, separator);
  const expiry = Number(payload.slice(separator + 1));
  if (!Number.isFinite(expiry) || expiry <= now) return null;

  return projectId;
}
