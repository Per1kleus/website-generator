/**
 * Validating a domain name a creator typed.
 *
 * A domain name reaches three places that punish carelessness: a DNS lookup,
 * a GitHub API body, and a `CNAME` file written into the published website.
 * So this is a strict allowlist of the characters a hostname may contain
 * rather than a check for the characters that would hurt — an allowlist stays
 * correct when somebody later finds a new way to be creative.
 *
 * In `lib/` and dependency-free, so the browser and the server validate with
 * exactly the same function and cannot disagree about what is acceptable.
 */

export type DomainState =
  /** Nothing connected. The GitHub Pages address is the website. */
  | "none"
  /** Saved, and the DNS records have not been created yet. */
  | "dns-required"
  /** Records exist but do not yet point here, or have not propagated. */
  | "waiting-dns"
  /** DNS resolves to GitHub Pages. */
  | "dns-detected"
  /** Told GitHub about the domain; it is provisioning. */
  | "configuring"
  /** Serving, but the certificate is not ready, so https:// may fail. */
  | "https-pending"
  /** Reachable over HTTPS at the custom domain. */
  | "active"
  /** Something is wrong and the creator has to act. */
  | "error";

export const DOMAIN_STATE_LABEL: Record<DomainState, string> = {
  none: "Not connected",
  "dns-required": "DNS configuration required",
  "waiting-dns": "Waiting for DNS",
  "dns-detected": "DNS detected",
  configuring: "Configuring GitHub Pages",
  "https-pending": "HTTPS pending",
  active: "Active",
  error: "Needs attention",
};

/** The four addresses GitHub Pages serves apex domains from. */
export const GITHUB_PAGES_IPS = [
  "185.199.108.153",
  "185.199.109.153",
  "185.199.110.153",
  "185.199.111.153",
];

export type DomainCheck =
  | { ok: true; domain: string; apex: boolean }
  | { ok: false; error: string };

/**
 * Normalise and check a domain.
 *
 * Accepts what a person actually types — a pasted URL, a trailing slash, a
 * `www.` prefix, capitals — and returns the bare hostname, or says exactly
 * what is wrong with it.
 */
export function checkDomain(input: string): DomainCheck {
  let value = (input ?? "").trim().toLowerCase();
  if (!value) return { ok: false, error: "Enter a domain name." };

  /* A pasted address is the common case, so read it rather than refusing it —
     but only as far as is unambiguous.

     Stripping a path from anything would mean "evil.com/../x" quietly
     becoming "evil.com": a different domain from the one that was typed,
     connected without a word. So a scheme is removed, and a path is removed
     only when there was a scheme to make it a URL. A bare "example.gr/shop"
     is a mistake, and is said to be one. */
  const hadScheme = /^https?:\/\//.test(value);
  value = value.replace(/^https?:\/\//, "");
  if (hadScheme) value = value.replace(/\/.*$/, "");
  // A single trailing slash is a typing habit, not an intention.
  value = value.replace(/\/$/, "").replace(/\.$/, "");
  if (value.includes("/")) {
    return { ok: false, error: "Enter just the domain name, with no path after it." };
  }
  // A port, a user-info prefix or a query is not part of a hostname and is
  // more likely a paste accident than an intention.
  if (/[@:?#]/.test(value)) {
    return { ok: false, error: "Enter just the domain name, with no port, path or @ sign." };
  }
  if (value.length > 253) return { ok: false, error: "That domain name is too long." };

  const labels = value.split(".");
  if (labels.length < 2) {
    return { ok: false, error: "Enter a full domain name, such as example.gr." };
  }
  for (const label of labels) {
    if (!label) return { ok: false, error: "That domain name has an empty part in it." };
    if (label.length > 63) return { ok: false, error: "One part of that domain name is too long." };
    // Letters, digits and inner hyphens. Nothing else: this string is written
    // into a file inside the published website and sent to the GitHub API.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return {
        ok: false,
        error: "A domain name can only contain letters, numbers and hyphens.",
      };
    }
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, error: "That does not end in a valid domain ending, such as .gr or .com." };
  }
  // An IP address is not a domain and cannot have a certificate issued for it.
  if (/^\d+(\.\d+)+$/.test(value)) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }
  // GitHub will not serve a Pages site under its own domains.
  if (value === "github.io" || value.endsWith(".github.io") || value.endsWith(".github.com")) {
    return { ok: false, error: "That is a GitHub address, not a domain you can connect." };
  }

  return { ok: true, domain: value, apex: labels.length === 2 };
}

export type DnsRecord = { type: "A" | "CNAME"; name: string; value: string };

/**
 * The records that have to exist, given the shape of the domain.
 *
 * An apex domain (`example.gr`) cannot be a CNAME — that is a DNS rule, not a
 * GitHub one — so it needs the four A records. A subdomain
 * (`www.example.gr`) takes a single CNAME. Showing the wrong one is how a
 * creator spends an afternoon on a record that was never going to work.
 */
export function requiredRecords(domain: string, pagesHost: string): DnsRecord[] {
  const check = checkDomain(domain);
  if (!check.ok) return [];
  if (check.apex) {
    return GITHUB_PAGES_IPS.map((ip) => ({ type: "A" as const, name: "@", value: ip }));
  }
  const host = check.domain.split(".")[0];
  return [{ type: "CNAME", name: host, value: pagesHost }];
}
