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
  | { ok: true; domain: string; apex: boolean; kind: "apex" | "subdomain" }
  | { ok: false; error: string };

/**
 * Names that can never be a client's public website.
 *
 * Two groups, both reserved by the IETF and neither resolvable on the public
 * internet: the special-use names (RFC 6761) and the documentation ones (RFC
 * 2606). A certificate can never be issued for any of them, so connecting one
 * would leave a domain stuck at "HTTPS pending" for ever with no explanation.
 * Saying so at the point of typing is the only useful moment.
 */
const RESERVED_TLDS = new Set([
  "localhost", "local", "localdomain", "internal", "intranet", "lan", "home",
  "corp", "private", "test", "example", "invalid", "onion", "alt",
]);

/** Address ranges that are not reachable from the internet. */
function isPrivateAddress(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

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
    return {
      ok: false,
      error: isPrivateAddress(value)
        ? "That is a private network address, which the public internet cannot reach."
        : "Enter a domain name, not an IP address.",
    };
  }
  /* Reserved and internal names.
     None of these resolve on the public internet and no certificate authority
     will ever issue for them, so a domain like this would sit at "HTTPS
     pending" until somebody gave up. Refusing it now, by name, saves that. */
  if (RESERVED_TLDS.has(tld) || labels.includes("localhost")) {
    return {
      ok: false,
      error: `.${tld} is a reserved name that only works inside a private network, so a public website cannot use it.`,
    };
  }
  if (value.endsWith(".home.arpa") || value === "home.arpa" || value.endsWith(".in-addr.arpa")) {
    return { ok: false, error: "That is an internal network name, not a public domain." };
  }
  // GitHub will not serve a Pages site under its own domains.
  if (value === "github.io" || value.endsWith(".github.io") || value.endsWith(".github.com")) {
    return { ok: false, error: "That is a GitHub address, not a domain you can connect." };
  }

  const apex = labels.length === 2;
  return { ok: true, domain: value, apex, kind: apex ? "apex" : "subdomain" };
}

export type DnsRecord = {
  type: "A" | "CNAME";
  /** What to type in the "host"/"name" column at the registrar. */
  name: string;
  value: string;
  /** Seconds. A short TTL while a domain is being set up is a kindness. */
  ttl: number;
  /** Whether this exact record was found in DNS. Filled in by the checker. */
  found?: boolean;
};

/**
 * A TTL low enough that a mistake is cheap to fix.
 *
 * An hour is the usual registrar default and it is the wrong default while a
 * domain is being connected: a typo cached for an hour is an hour of a client
 * seeing the wrong thing. 3600 is what most panels will accept as a minimum
 * without complaint, and 600 where they allow it — so 3600 is recommended and
 * the copy alongside says shorter is better.
 */
export const RECOMMENDED_TTL = 3600;

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
    return GITHUB_PAGES_IPS.map((ip) => ({
      type: "A" as const,
      name: "@",
      value: ip,
      ttl: RECOMMENDED_TTL,
    }));
  }
  // Everything before the registrable domain: "www", or "shop.eu" for a
  // deeper name. Registrars want that, not the whole hostname.
  const host = check.domain.split(".").slice(0, -2).join(".");
  return [{ type: "CNAME", name: host, value: pagesHost, ttl: RECOMMENDED_TTL }];
}

/**
 * Which of the required records are actually in DNS, and what is in the way.
 *
 * "DNS failed" is never a useful thing to tell somebody who has just spent
 * twenty minutes in a registrar's control panel. Three of four A records
 * present is a different problem from four records pointing at the old host,
 * which is different again from a CNAME on an apex domain that a registrar
 * should never have accepted — and each has a different next step.
 */
export type DnsComparison = {
  records: DnsRecord[];
  /** Required records that are present. */
  matched: number;
  /** Values that are there and should not be. */
  conflicts: { type: "A" | "CNAME"; value: string; why: string }[];
  /** True when every required record is present and nothing conflicts. */
  complete: boolean;
};

export function compareDns(
  domain: string,
  pagesHost: string,
  found: { aRecords: string[]; cnames: string[] },
): DnsComparison {
  const check = checkDomain(domain);
  if (!check.ok) return { records: [], matched: 0, conflicts: [], complete: false };

  const required = requiredRecords(check.domain, pagesHost);
  const foundA = found.aRecords.map((v) => v.trim());
  const foundCname = found.cnames.map((v) => v.toLowerCase().replace(/\.$/, ""));
  const conflicts: DnsComparison["conflicts"] = [];

  const records = required.map((record) => {
    if (record.type === "A") return { ...record, found: foundA.includes(record.value) };
    const target = record.value.toLowerCase();
    return {
      ...record,
      // A CNAME to this project's Pages host, or to any github.io — an
      // organisation may legitimately point at a differently-named site.
      found: foundCname.some((c) => c === target || c.endsWith(".github.io")),
    };
  });

  /* Anything present that is not wanted. An extra A record is not cosmetic:
     a quarter of visitors would be sent to whatever it points at. */
  for (const ip of foundA) {
    if (!GITHUB_PAGES_IPS.includes(ip)) {
      conflicts.push({
        type: "A",
        value: ip,
        why: "This A record sends visitors somewhere that is not GitHub Pages. Remove it.",
      });
    }
  }
  for (const cname of foundCname) {
    if (!cname.endsWith(".github.io")) {
      conflicts.push({
        type: "CNAME",
        value: cname,
        why: check.apex
          ? "An apex domain cannot use a CNAME. Remove it and add the four A records below."
          : "This CNAME points at a different service. Change it to the value below.",
      });
    }
  }

  const matched = records.filter((r) => r.found).length;
  return { records, matched, conflicts, complete: matched === records.length && !conflicts.length };
}
