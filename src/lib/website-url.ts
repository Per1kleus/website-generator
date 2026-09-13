/**
 * The optional "existing website" a creator can supply.
 *
 * The address is typed by a person and then handed to the research step as a
 * page to read. It is therefore untrusted in two separate ways, and this
 * module deals with the first one: what the string itself is allowed to be.
 *
 *   - Only http and https. `javascript:`, `data:` and `file:` are addresses a
 *     browser or a fetcher would act on, and none of them is a website.
 *   - No credentials. `https://user:pass@host` is either a mistake or a way to
 *     smuggle a secret into a prompt and a log; neither is worth supporting.
 *   - Nothing that resolves to this machine or a private network. The research
 *     step never fetches from this process — the page is read by Google's
 *     grounding infrastructure, which cannot see a private network at all — so
 *     this is not the barrier that keeps internal services safe. It exists so
 *     that "http://localhost:3000" fails with an explanation instead of
 *     quietly producing research about nothing.
 *
 * The second kind of untrust — what the page *says* — is handled where the
 * page is actually read, in server/research.ts: the content is evidence about
 * a business, never an instruction.
 */

export type WebsiteUrlResult =
  /** A usable address, or "" when the field was left empty — which is allowed. */
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Hosts that are this computer, or a name only a local network resolves. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid"];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const n = parts.map(Number);
  if (n.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = n;
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including the cloud metadata address
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    a >= 224 // multicast and reserved
  );
}

function isDisallowedHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  // An IPv6 literal keeps its brackets in URL.hostname. Rather than reasoning
  // about the several ways of writing ::1, none of them is accepted: a real
  // business website has a name.
  if (host.startsWith("[")) return true;
  if (isPrivateIpv4(host)) return true;
  return false;
}

/**
 * Check the address a creator typed.
 *
 * An empty field is a success with an empty address — the whole point of the
 * feature is that it is optional, so "not supplied" must never read as an
 * error anywhere downstream.
 */
export function checkWebsiteUrl(raw: string): WebsiteUrlResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: true, url: "" };

  const bad = (error: string): WebsiteUrlResult => ({ ok: false, error });

  if (input.length > 2000) return bad("That web address is too long to be a real one.");
  if (/\s/.test(input)) return bad("A web address cannot contain spaces.");

  // A scheme-less "example.com" is what most people type, and it is not
  // ambiguous. Anything that looks like some other scheme is left alone so it
  // fails the protocol check below rather than being silently rewritten.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return bad("That does not look like a web address. It should look like https://example.com");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return bad("Only http:// and https:// addresses can be used.");
  }
  if (url.username || url.password) {
    return bad("Leave the username and password out of the address.");
  }

  const host = url.hostname.toLowerCase();
  if (!host) return bad("That web address has no website name in it.");
  if (isDisallowedHost(host)) {
    return bad("That address points at this computer or a private network, so it cannot be read.");
  }
  // A public website has a dotted name. This also rejects a single word typed
  // into the field by mistake, which is the common case.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return bad("That does not look like a web address. It should look like https://example.com");
  }

  // The fragment is a position on a page, not part of the address of one, and
  // it is the one part a research step has no use for.
  url.hash = "";
  return { ok: true, url: url.toString() };
}

/** True for an address that is usable, or absent. Never true for a broken one. */
export function isUsableWebsiteUrl(raw: string): boolean {
  return checkWebsiteUrl(raw).ok;
}

/** The bare host, for saying which site could not be read. */
export function websiteHost(raw: string): string {
  const checked = checkWebsiteUrl(raw);
  if (!checked.ok || !checked.url) return "";
  try {
    return new URL(checked.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
