import "server-only";
import { createHash } from "node:crypto";
import path from "node:path";
import { db } from "./db";
import type { Site } from "@/lib/site";

/**
 * What a deployment *is*, separately from how one is carried out.
 *
 * The engine needs the providers and the providers need this — the address a
 * website will live at is built from the same slug the row is keyed by — so
 * the shared vocabulary lives here, below both of them, rather than in a
 * cycle between them. `server/deploy.ts` re-exports every name in this file,
 * so nothing that already imported them had to change.
 */

export const PUBLISH_DIR = path.join(
  process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data"),
  "published",
);

export type DeployPlatform = "builtin" | "github" | "vercel" | "netlify";

export type Deployment = {
  id: string;
  project_id: string;
  platform: DeployPlatform;
  slug: string;
  status: "queued" | "preparing" | "building" | "deploying" | "live" | "failed" | "unpublished";
  url: string;
  log: string[];
  error: string | null;
  created_at: number;
  updated_at: number;
  /** When it actually went live. 0 while it never did. */
  published_at: number;
  /** Fingerprint of the document that went live, for "changes since". */
  site_hash: string;
  /** When the creator took it down. 0 while it is up. */
  unpublished_at: number;

  /* Provider metadata. Empty for a built-in deployment, which is what every
     deployment made before this existed reads as. No credential is here, or
     could be: the token lives encrypted in the account table. */
  repo_owner: string;
  repo_name: string;
  /** 1 unless a repository was found public and could not be closed again. */
  repo_private: number;
  /** The repository's page on GitHub. For the owner, never for a client. */
  repo_url: string;
  commit_sha: string;
  /** GitHub's own word for the Pages build: "built", "building", "errored". */
  pages_status: string;
  pages_url: string;
  custom_domain: string;
  domain_status: string;
  domain_error: string;
  domain_checked_at: number;
  /** Which saved version is public. History itself stays in `versions`. */
  version_id: string;
};

/**
 * A fingerprint of exactly what was published.
 *
 * "Has this changed since it went live?" is answered by comparing documents,
 * not timestamps: `updated_at` moves when a project is renamed, when a version
 * is recorded, when anything at all is touched, and telling a creator their
 * live site is stale because they opened the editor would train them to
 * ignore the notice.
 */
export function siteFingerprint(site: Site): string {
  return createHash("sha256").update(JSON.stringify(site)).digest("hex").slice(0, 32);
}

export type DeploymentRow = Omit<Deployment, "log"> & { log: string };

/**
 * Whether a platform can be used, asked of the platform itself.
 *
 * Per-creator, because anything connected by OAuth has a different answer for
 * different people: a server-wide Vercel token is one answer for everybody, a
 * GitHub account somebody connected is not.
 */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "site"
  );
}

/** Appends `-2`, `-3`… until the slug is free. Slugs are globally unique. */
export function uniqueSlug(base: string, forProjectId: string): string {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  for (;;) {
    const taken = db
      .prepare("SELECT project_id FROM deployments WHERE slug = ?")
      .get(candidate) as { project_id: string } | undefined;
    if (!taken || taken.project_id === forProjectId) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}
