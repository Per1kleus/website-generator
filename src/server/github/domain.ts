import "server-only";
import { Resolver } from "node:dns/promises";
import { checkDomain, GITHUB_PAGES_IPS, type DomainState } from "@/lib/domain";

/**
 * Is the domain actually pointing here, and does HTTPS work?
 *
 * Both questions are answered by looking, never by assuming. The application
 * does not control anybody's DNS — it cannot create a record, and saying "✓
 * Configured" because a creator pressed a button would be the most expensive
 * lie in this feature, since the person who finds out is the client whose
 * website does not load.
 *
 * So: resolve the name, compare what came back against what GitHub Pages
 * serves, and fetch the site over HTTPS. Anything that is not a clear yes is
 * reported as "not yet", with what to do about it.
 */

/**
 * A resolver that does not use the process's cached answers.
 *
 * DNS is the thing being waited on, so a cached negative answer from ninety
 * seconds ago is exactly the answer that must not be reused.
 */
function resolver(): Resolver {
  const r = new Resolver({ timeout: 5000, tries: 2 });
  const servers = (process.env.WG_DNS_SERVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) r.setServers(servers);
  return r;
}

export type DnsFinding = {
  /** What the name currently resolves to, for showing back to the creator. */
  aRecords: string[];
  cnames: string[];
  /** True when those values are GitHub Pages. */
  pointsAtPages: boolean;
  /** True when the name resolves to something, whatever it is. */
  resolves: boolean;
};

export async function inspectDns(domain: string, pagesHost: string): Promise<DnsFinding> {
  const check = checkDomain(domain);
  if (!check.ok) return { aRecords: [], cnames: [], pointsAtPages: false, resolves: false };

  const r = resolver();
  const [aRecords, cnames] = await Promise.all([
    r.resolve4(check.domain).catch(() => [] as string[]),
    r.resolveCname(check.domain).catch(() => [] as string[]),
  ]);

  const host = pagesHost.toLowerCase().replace(/\.$/, "");
  const cnameMatch = cnames.some((c) => {
    const target = c.toLowerCase().replace(/\.$/, "");
    // A CNAME to the project's own Pages host, or to any github.io host: an
    // organisation may point at a differently-named Pages site legitimately.
    return target === host || target.endsWith(".github.io");
  });
  // An apex domain is resolved through the A records even when it was set up
  // as an ALIAS/ANAME, so comparing addresses is what works in both cases.
  const aMatch = aRecords.length > 0 && aRecords.every((ip) => GITHUB_PAGES_IPS.includes(ip));

  return {
    aRecords,
    cnames,
    pointsAtPages: cnameMatch || aMatch,
    resolves: aRecords.length > 0 || cnames.length > 0,
  };
}

/**
 * Does the site actually answer over HTTPS at this domain?
 *
 * The certificate is the last thing to arrive and the thing that breaks the
 * site in a visitor's browser when it is missing, so it is checked by making
 * the request a visitor would make. A TLS failure is a "not yet", not an
 * error: GitHub takes minutes to issue a certificate after DNS lands.
 */
export async function httpsWorks(domain: string): Promise<boolean> {
  const check = checkDomain(domain);
  if (!check.ok) return false;
  try {
    const res = await fetch(`https://${check.domain}/`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "website-generator" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Work out which state a connected domain is in.
 *
 * Deliberately ordered from "nothing has happened yet" to "finished", so a
 * creator watching it move always sees forward progress rather than a status
 * that flickers between two equally true descriptions.
 */
export async function domainState(args: {
  domain: string;
  pagesHost: string;
  /** What GitHub says its Pages CNAME is set to. */
  configuredCname: string;
  /** GitHub's certificate state, when it has one. */
  httpsState: string;
  /**
   * How to find out whether HTTPS works. Defaults to actually fetching the
   * site, and exists as a parameter only so a test can reach the last state
   * without a real certificate on a real domain — which is the one thing a
   * test environment cannot produce. Nothing in the application passes it.
   */
  probe?: (domain: string) => Promise<boolean>;
}): Promise<{ state: DomainState; detail: string; dns: DnsFinding }> {
  const { domain, pagesHost, configuredCname, httpsState, probe = httpsWorks } = args;
  const check = checkDomain(domain);
  if (!check.ok) {
    return {
      state: "error",
      detail: check.error,
      dns: { aRecords: [], cnames: [], pointsAtPages: false, resolves: false },
    };
  }

  const dns = await inspectDns(check.domain, pagesHost);

  if (!dns.resolves) {
    return {
      state: "dns-required",
      detail:
        "This domain does not resolve yet. Create the records below at whoever the domain is registered with.",
      dns,
    };
  }

  if (!dns.pointsAtPages) {
    const found = [...dns.cnames, ...dns.aRecords].slice(0, 4).join(", ");
    return {
      state: "waiting-dns",
      detail: found
        ? `This domain currently points at ${found}, which is not GitHub Pages. Check the records below, then wait for the change to propagate.`
        : "This domain does not point at GitHub Pages yet.",
      dns,
    };
  }

  if (configuredCname.toLowerCase() !== check.domain) {
    return {
      state: "dns-detected",
      detail: "DNS is correct. Publish to finish setting the domain on GitHub Pages.",
      dns,
    };
  }

  if (await probe(check.domain)) {
    return { state: "active", detail: "", dns };
  }

  // DNS is right and GitHub knows about the domain, so the only thing left is
  // the certificate. GitHub says so itself when it can.
  return {
    state: "https-pending",
    detail:
      httpsState && httpsState !== "approved"
        ? `GitHub is still issuing the HTTPS certificate (${httpsState}). This usually takes a few minutes and can take up to an hour.`
        : "GitHub is still issuing the HTTPS certificate. This usually takes a few minutes and can take up to an hour.",
    dns,
  };
}
