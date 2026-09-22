import "server-only";
import {
  checkDomain, requiredRecords, type DnsRecord, type DomainState,
} from "@/lib/domain";
import { getLatestDeployment, type Deployment } from "./deploy";
import { db } from "./db";
import { GitHubError, getPages, enforceHttps, setPagesDomain } from "./github/api";
import { domainState, inspectDns, type DnsFinding } from "./github/domain";
import { pagesHost } from "./providers/github";

/**
 * What a browser is allowed to know about a deployment, and the custom-domain
 * lifecycle that changes it.
 *
 * The two live together because they are the same concern from opposite
 * ends: one decides what leaves the server, the other is the only code that
 * writes the fields it lets out.
 */

/* ------------------------------------------------------- the allowlist */

/**
 * A deployment, as the publishing screen sees it.
 *
 * An allowlist rather than a redaction list. Nothing on a deployment row is a
 * credential today — tokens live encrypted in the account tables and are
 * never copied here — but a field added in six months is not automatically
 * public, which is the property worth having.
 *
 * `repo_url` is included and `repo_name` with it: this is the project owner's
 * own screen, behind their own session, and knowing which repository their
 * client's website lives in is the point. Neither reaches a client — the
 * client preview renders a website and nothing else, and the published site
 * is static files with no reference to any of this.
 */
export type DeploymentView = {
  id: string;
  project_id: string;
  platform: Deployment["platform"];
  slug: string;
  status: Deployment["status"];
  url: string;
  log: string[];
  error: string | null;
  created_at: number;
  updated_at: number;
  published_at: number;
  unpublished_at: number;
  site_hash: string;
  version_id: string;

  repo_owner: string;
  repo_name: string;
  repo_private: number;
  repo_url: string;
  commit_sha: string;
  pages_status: string;
  pages_url: string;

  custom_domain: string;
  domain_status: DomainState;
  domain_error: string;
  domain_checked_at: number;
  /** The records the creator has to create, when a domain is connected. */
  domain_records: DnsRecord[];
  /** Whether the domain is an apex or a subdomain, which decides the records. */
  domain_kind: "apex" | "subdomain" | "";
  /** The Pages host a CNAME should point at, for the instructions. */
  pages_host: string;
};

export function publicView(deployment: Deployment | null): DeploymentView | null {
  if (!deployment) return null;
  const host = deployment.repo_owner ? pagesHost(deployment.repo_owner) : "";
  return {
    id: deployment.id,
    project_id: deployment.project_id,
    platform: deployment.platform,
    slug: deployment.slug,
    status: deployment.status,
    url: deployment.url,
    log: deployment.log,
    error: deployment.error,
    created_at: deployment.created_at,
    updated_at: deployment.updated_at,
    published_at: deployment.published_at,
    unpublished_at: deployment.unpublished_at,
    site_hash: deployment.site_hash,
    version_id: deployment.version_id,

    repo_owner: deployment.repo_owner,
    repo_name: deployment.repo_name,
    repo_private: deployment.repo_private,
    repo_url: deployment.repo_url,
    commit_sha: deployment.commit_sha,
    pages_status: deployment.pages_status,
    pages_url: deployment.pages_url,

    custom_domain: deployment.custom_domain,
    domain_status: (deployment.domain_status || "none") as DomainState,
    domain_error: deployment.domain_error,
    domain_checked_at: deployment.domain_checked_at,
    domain_records:
      deployment.custom_domain && host
        ? mergeFoundFlags(deployment.id, requiredRecords(deployment.custom_domain, host))
        : [],
    domain_kind: (() => {
      const check = checkDomain(deployment.custom_domain);
      return check.ok ? check.kind : "";
    })(),
    pages_host: host,
  };
}

/**
 * The per-record "found" flags from the last check.
 *
 * Kept in memory rather than in a column: it is a fact about DNS thirty
 * seconds ago, not about the deployment, and a stale flag surviving a restart
 * would be worse than no flag. An absent entry simply means "not checked
 * yet", which the screen shows as exactly that.
 */
const lastComparison = new Map<string, { at: number; records: DnsRecord[] }>();

function mergeFoundFlags(deploymentId: string, records: DnsRecord[]): DnsRecord[] {
  const remembered = lastComparison.get(deploymentId);
  if (!remembered) return records;
  return records.map((record) => {
    const match = remembered.records.find(
      (r) => r.type === record.type && r.value === record.value && r.name === record.name,
    );
    return match ? { ...record, found: match.found } : record;
  });
}

/* ------------------------------------------------------ custom domains */

function saveDomain(
  id: string,
  patch: { domain?: string; status?: DomainState; error?: string; checked?: boolean },
) {
  const current = db
    .prepare("SELECT custom_domain, domain_status, domain_error FROM deployments WHERE id = ?")
    .get(id) as { custom_domain: string; domain_status: string; domain_error: string } | undefined;
  if (!current) return;
  db.prepare(
    `UPDATE deployments
        SET custom_domain = ?, domain_status = ?, domain_error = ?, domain_checked_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.domain ?? current.custom_domain,
    patch.status ?? current.domain_status,
    patch.error ?? "",
    patch.checked ? Date.now() : 0,
    Date.now(),
    id,
  );
}

type DomainResult =
  | { ok: true; records: DnsRecord[]; dns?: DnsFinding }
  | { ok: false; error: string };

/**
 * Connect a domain the client bought.
 *
 * Deliberately does not claim to have done more than it has. This application
 * has no DNS provider connected and cannot create a record on anybody's
 * behalf, so connecting a domain means: check the name is usable, record it,
 * tell GitHub about it if the site is already live, and show the exact
 * records a person has to create. The state it lands in reflects what is
 * actually true at that moment, checked by looking rather than assumed.
 */
export async function connectDomain(
  projectId: string,
  userId: string,
  input: string,
): Promise<DomainResult> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment) {
    return { ok: false, error: "Publish the website once before connecting a domain." };
  }
  if (deployment.platform !== "github") {
    return {
      ok: false,
      error:
        "Custom domains are set up through GitHub Pages. Publish this website to GitHub Pages first.",
    };
  }

  const check = checkDomain(input);
  if (!check.ok) return { ok: false, error: check.error };

  // One domain cannot serve two websites, and the second one to be connected
  // would silently take the first one's traffic.
  const clash = db
    .prepare("SELECT project_id FROM deployments WHERE custom_domain = ? AND project_id != ?")
    .get(check.domain, projectId) as { project_id: string } | undefined;
  if (clash) {
    return {
      ok: false,
      error: "That domain is already connected to another project in this application.",
    };
  }

  const host = deployment.repo_owner ? pagesHost(deployment.repo_owner) : "";
  const records = requiredRecords(check.domain, host);

  /* Changing from one domain to another.
     The old name has to stop being GitHub's idea of this site's domain, or it
     is left claimed: GitHub refuses to serve the same domain from two Pages
     sites, so a stale claim would block whoever legitimately wants that name
     next — often the same client moving to a different project here. Clearing
     it is the first thing, before the new one is recorded, so a failure
     halfway leaves the old domain working rather than neither. */
  const previous = deployment.custom_domain;
  if (previous && previous !== check.domain) {
    if (deployment.repo_owner && deployment.repo_name) {
      try {
        await setPagesDomain(userId, deployment.repo_owner, deployment.repo_name, "");
      } catch (err) {
        console.error("[domain] could not clear the previous domain:", err);
        return {
          ok: false,
          error:
            "The previous domain could not be removed from GitHub Pages, so the new one was not connected. Try again in a moment.",
        };
      }
    }
    lastComparison.delete(deployment.id);
  }

  saveDomain(deployment.id, { domain: check.domain, status: "dns-required", error: "" });

  /* Tell GitHub now when there is something to tell it about.
     The CNAME file only reaches the repository on the next publish, and
     GitHub rewrites that file from this setting — so setting it here means a
     creator who has already published does not have to publish again just to
     start the DNS clock. A refusal is not fatal: the domain stays recorded
     and the next publish sets it. */
  if (deployment.status === "live" && deployment.repo_owner && deployment.repo_name) {
    try {
      await setPagesDomain(userId, deployment.repo_owner, deployment.repo_name, check.domain);
    } catch (err) {
      const message =
        err instanceof GitHubError ? err.message : "GitHub could not be told about the domain.";
      saveDomain(deployment.id, { domain: check.domain, status: "dns-required", error: message });
      return { ok: true, records };
    }
  }

  // Land on the truth rather than on "configuring": if the creator set the
  // DNS up in advance, this is already further along than it looks.
  await refreshDomain(projectId, userId);
  return { ok: true, records };
}

/**
 * Re-check a connected domain and record where it has got to.
 *
 * Every state here comes from an observation: a DNS answer, GitHub's own
 * Pages settings, or an HTTPS request that either worked or did not.
 */
/**
 * How often a check may actually go out to DNS and GitHub.
 *
 * Two windows, because two different things are being prevented.
 *
 * An **automatic** re-check is polling, and polling DNS every few seconds
 * learns nothing: propagation is measured in minutes and a certificate in
 * tens of minutes. A minute is already generous.
 *
 * A person **pressing Check again** is not polling — they have just typed
 * four records into a registrar's panel and are asking the one question this
 * screen exists to answer. Refusing to look would make the feature feel
 * broken at precisely the moment it matters. So that path really looks, and
 * the only thing held back is a stuck button: a couple of seconds, which no
 * DNS change happens inside anyway.
 */
const AUTOMATIC_INTERVAL_MS = 60_000;
const EXPLICIT_INTERVAL_MS = 3_000;

export async function refreshDomain(
  projectId: string,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true; dns: DnsFinding; throttled?: boolean } | { ok: false; error: string }> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment?.custom_domain) {
    return { ok: false, error: "No custom domain is connected." };
  }

  /* An active domain does not need re-checking on a timer at all — it is
     serving — so only an unfinished one is polled, and even then not faster
     than the thing being waited for can change. */
  const sinceLast = Date.now() - (deployment.domain_checked_at || 0);
  const remembered = lastComparison.get(deployment.id);
  const window = opts.force ? EXPLICIT_INTERVAL_MS : AUTOMATIC_INTERVAL_MS;
  if (deployment.domain_checked_at && sinceLast < window && remembered) {
    return {
      ok: true,
      throttled: true,
      dns: {
        aRecords: [], cnames: [],
        pointsAtPages: deployment.domain_status === "active",
        resolves: true,
        comparison: {
          records: remembered.records,
          matched: remembered.records.filter((r) => r.found).length,
          conflicts: [],
          complete: remembered.records.every((r) => r.found),
        },
      },
    };
  }

  const host = deployment.repo_owner ? pagesHost(deployment.repo_owner) : "";

  let configuredCname = "";
  let httpsState = "";
  if (deployment.repo_owner && deployment.repo_name) {
    try {
      const pages = await getPages(userId, deployment.repo_owner, deployment.repo_name);
      configuredCname = pages?.cname ?? "";
      httpsState = pages?.httpsState ?? "";
    } catch (err) {
      // GitHub being unreachable does not change the DNS answer, so the check
      // carries on and simply knows less.
      console.error("[domain] could not read Pages settings:", err);
    }
  }

  const { state, detail, dns } = await domainState({
    domain: deployment.custom_domain,
    pagesHost: host,
    configuredCname,
    httpsState,
  });

  // Once a certificate exists, ask GitHub to redirect http:// to https://.
  // Before that it refuses, which is why this is attempted on every poll
  // rather than once, and why a refusal is ignored rather than reported.
  if (state === "active" && deployment.repo_owner && deployment.repo_name) {
    await enforceHttps(userId, deployment.repo_owner, deployment.repo_name);
  }

  // Remember which records were actually seen, so the screen can tick them
  // off one by one rather than reporting a single pass/fail.
  lastComparison.set(deployment.id, { at: Date.now(), records: dns.comparison.records });

  saveDomain(deployment.id, { status: state, error: detail, checked: true });

  // The public address follows the domain once it is genuinely serving.
  if (state === "active") {
    db.prepare("UPDATE deployments SET url = ? WHERE id = ?").run(
      `https://${deployment.custom_domain}/`,
      deployment.id,
    );
  }

  return { ok: true, dns };
}

/**
 * Disconnect the domain.
 *
 * The website goes back to its GitHub Pages address, which never stopped
 * working. Nothing is deleted: not the repository, not the deployment, not
 * the history.
 */
export async function disconnectDomain(
  projectId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment?.custom_domain) return { ok: false, error: "No custom domain is connected." };

  if (deployment.repo_owner && deployment.repo_name) {
    try {
      await setPagesDomain(userId, deployment.repo_owner, deployment.repo_name, "");
    } catch (err) {
      console.error("[domain] could not clear the Pages domain:", err);
    }
  }

  lastComparison.delete(deployment.id);
  saveDomain(deployment.id, { domain: "", status: "none", error: "" });
  if (deployment.pages_url) {
    db.prepare("UPDATE deployments SET url = ? WHERE id = ?").run(
      deployment.pages_url,
      deployment.id,
    );
  }
  return { ok: true };
}

export { inspectDns };
