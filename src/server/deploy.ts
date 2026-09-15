import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import type { Site } from "@/lib/site";
import { buildBundle, resizedBytes } from "./bundle";
import { providerFor } from "./providers";
import {
  PUBLISH_DIR, siteFingerprint, slugify, uniqueSlug,
  type Deployment, type DeploymentRow, type DeployPlatform,
} from "./deploy-model";

/* The shared vocabulary lives one level down, so the providers can use it
   without importing the engine that uses them. Re-exported here because this
   is still the module everything else asks. */
export {
  PUBLISH_DIR, siteFingerprint, slugify, uniqueSlug,
  type Deployment, type DeployPlatform,
} from "./deploy-model";

/**
 * Deployment from a phone (requirement 13).
 *
 * This file is the engine, and it is deliberately ignorant of where a website
 * ends up. It owns the deployment row, the queue, the log, the site
 * fingerprint, the version that went live and the guarantee that a failure
 * never leaves a half-written website in front of the public. Where the files
 * go is a provider's business — `server/providers/` — so adding GitHub Pages
 * added a file there rather than a branch here.
 *
 * `builtin` is a real deployment: the rendered site and its images are written
 * to disk and served publicly at /s/<slug>, with no authentication. That is
 * what makes "deploy from a café, with only a phone" actually true rather than
 * a screen that pretends.
 *
 * `github` publishes to a private GitHub repository and serves it through
 * GitHub Pages, which is the production path — the website keeps working when
 * this application is closed.
 *
 * Vercel and Netlify are offered when the operator has configured an API
 * token. Without one we say so plainly instead of faking a green tick.
 */

export function platformAvailable(platform: DeployPlatform, userId = ""): boolean {
  return providerFor(platform).available(userId);
}

function rowToDeployment(row: DeploymentRow): Deployment {
  return { ...row, log: JSON.parse(row.log) as string[] };
}

export function getDeployment(id: string): Deployment | null {
  const row = db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as
    | DeploymentRow
    | undefined;
  return row ? rowToDeployment(row) : null;
}

export function getLatestDeployment(projectId: string): Deployment | null {
  const row = db
    .prepare("SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as DeploymentRow | undefined;
  return row ? rowToDeployment(row) : null;
}

function update(id: string, patch: Partial<Deployment>) {
  const current = getDeployment(id);
  if (!current) return;
  const merged = { ...current, ...patch };
  db.prepare(
    `UPDATE deployments
        SET status = ?, url = ?, log = ?, error = ?, updated_at = ?,
            published_at = ?, site_hash = ?, unpublished_at = ?,
            repo_owner = ?, repo_name = ?, repo_private = ?, repo_url = ?,
            commit_sha = ?, pages_status = ?, pages_url = ?,
            custom_domain = ?, domain_status = ?, domain_error = ?,
            domain_checked_at = ?, version_id = ?
      WHERE id = ?`,
  ).run(
    merged.status, merged.url, JSON.stringify(merged.log), merged.error, Date.now(),
    merged.published_at ?? 0, merged.site_hash ?? "", merged.unpublished_at ?? 0,
    merged.repo_owner ?? "", merged.repo_name ?? "", merged.repo_private ?? 1,
    merged.repo_url ?? "", merged.commit_sha ?? "",
    merged.pages_status ?? "", merged.pages_url ?? "",
    merged.custom_domain ?? "", merged.domain_status ?? "none",
    merged.domain_error ?? "", merged.domain_checked_at ?? 0,
    merged.version_id ?? "",
    id,
  );
}

function log(id: string, line: string, status?: Deployment["status"]) {
  const current = getDeployment(id);
  if (!current) return;
  update(id, { log: [...current.log, line], ...(status ? { status } : {}) });
}

export function startDeployment(
  projectId: string,
  site: Site,
  platform: DeployPlatform,
  requestedSlug: string,
  origin: string,
  userId: string,
  versionId = "",
): Deployment {
  const slug = uniqueSlug(requestedSlug || site.meta.businessName, projectId);
  const now = Date.now();

  /* Publishing again updates the website that is already there.
     ------------------------------------------------------------------
     The slug is the address, and the address is unique — so a second
     deployment to the same one is not a second website, it is this website
     changing. Inserting a new row would either collide with the unique index
     or, worse, quietly produce a duplicate site at a different address while
     the creator believes they updated the one they gave their client.

     The same reasoning is what stops a second GitHub repository being created
     on every publish: the row carries the repository it made last time, so
     reusing the row is what makes the repository stable. */
    const existing = db
      .prepare("SELECT id FROM deployments WHERE project_id = ? AND slug = ?")
      .get(projectId, slug) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  if (existing) {
    db.prepare(
      `UPDATE deployments
          SET platform = ?, status = 'queued', log = '[]', error = NULL, updated_at = ?
        WHERE id = ?`,
    ).run(platform, now, id);
  } else {
    db.prepare(
      `INSERT INTO deployments (id, project_id, platform, slug, status, url, log, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', '', '[]', ?, ?)`,
    ).run(id, projectId, platform, slug, now, now);
  }

  // Which saved version is going live. The generator stays the source of
  // truth for history; this is only a pointer into it, so a rollback that
  // republishes an older version is recorded as exactly that.
  if (versionId) update(id, { version_id: versionId });

  // Same pattern as generation: the response returns now, the work continues.
  void runDeployment(id, site, platform, slug, origin, projectId, userId);

  return getDeployment(id)!;
}

async function runDeployment(
  id: string,
  site: Site,
  platform: DeployPlatform,
  slug: string,
  origin: string,
  projectId: string,
  userId: string,
) {
  const provider = providerFor(platform);
  const staging = path.join(PUBLISH_DIR, `.staging-${id}`);

  try {
    if (!provider.available(userId)) throw new Error(provider.unavailableReason());

    log(id, "Preparing files", "preparing");

    /* The public address, before anything is built.
       Every canonical link, hreflang link and sitemap entry in the bundle
       contains it, so it has to be known first — and it differs per provider:
       /s/<slug> here, <login>.github.io/<repo> on GitHub, the client's own
       domain once one is connected. */
    const deployment = getDeployment(id);
    const baseCtx = { projectId, userId, slug, origin, deployment };
    const siteBase = (await provider.publicBaseUrl(baseCtx)).replace(/\/$/, "");

    log(id, "Building the site", "building");
    const bundle = [...buildBundle(site, siteBase), ...((await provider.extraFiles?.(baseCtx)) ?? [])];

    /* Built beside the live site, never on top of it.
       ------------------------------------------------------------------
       Writing straight into the served directory means deleting a working
       website and then hoping: a failure halfway through — a disk full, an
       unreadable photograph, the process being killed — used to leave the
       public URL serving a half-written site with no way back.

       So the new version is assembled under a staging name, and the provider
       swaps it in only once it is complete. The built-in provider renames a
       directory; the GitHub provider moves a branch ref. Both are one step as
       far as a visitor is concerned. */
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });

    let images = 0;
    try {
      for (const file of bundle) {
        const dest = path.join(staging, file.name);
        await mkdir(path.dirname(dest), { recursive: true });
        if (file.kind === "text") {
          await writeFile(dest, file.content, "utf8");
        } else if (file.kind === "resize") {
          if (existsSync(file.source)) await writeFile(dest, await resizedBytes(file));
        } else if (existsSync(file.source)) {
          await copyFile(file.source, dest);
          images += 1;
        }
      }
    } catch (err) {
      // Nothing has been handed to the provider yet, so the live site is
      // exactly as it was. Clear the half-built copy and report the reason.
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    log(id, `${site.meta.locales.length} language${site.meta.locales.length === 1 ? "" : "s"}, ${images} image${images === 1 ? "" : "s"} bundled`);

    log(id, "Deploying", "deploying");
    const result = await provider.publish({
      deploymentId: id,
      projectId,
      userId,
      slug,
      site,
      stagingDir: staging,
      bundle,
      baseUrl: siteBase,
      origin,
      deployment: getDeployment(id)!,
      log: (line) => log(id, line),
    });

    update(id, {
      status: "live",
      url: result.url,
      published_at: Date.now(),
      site_hash: siteFingerprint(site),
      unpublished_at: 0,
      error: null,
      ...(result.meta ?? {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deployment failed";
    update(id, { status: "failed", error: message });
    log(id, `Failed: ${message}`);
  } finally {
    // A provider that consumed the staging directory has already moved it;
    // one that copied out of it has not. Either way nothing is left behind.
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Take a published website down.
 *
 * The files go; the row stays. Keeping it means the slug stays reserved — so
 * a client's bookmark cannot later land on somebody else's site — and the
 * history of what was published when stays readable. Re-publishing reuses the
 * same slug, so the URL a creator already gave out keeps working.
 */
export async function unpublish(projectId: string, userId = ""): Promise<boolean> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment || deployment.status !== "live") return false;

  /* Taking the website down is not permission to delete anything.
     The built-in provider removes the files it served; GitHub switches Pages
     off and leaves the repository, its history and every file in it exactly
     where they are; a Vercel or Netlify site is theirs to remove from their
     own dashboard. A failure to reach the provider must still mark the site
     as down here, because a creator pressing "take it down" has to see it
     take effect — the error is recorded alongside. */
  let error: string | null = null;
  try {
    await providerFor(deployment.platform).unpublish(deployment, userId);
  } catch (err) {
    error = err instanceof Error ? err.message : "The host could not be reached.";
    console.error("[deploy] unpublish reported:", error);
  }

  update(deployment.id, {
    status: "unpublished",
    unpublished_at: Date.now(),
    error,
    pages_status: "",
  });
  return true;
}

/**
 * Whether the live site is behind the project's current document.
 *
 * Compared by fingerprint, so this is only true when the website itself would
 * actually come out different.
 */
export function hasUnpublishedChanges(projectId: string, site: Site | null): boolean {
  const deployment = getLatestDeployment(projectId);
  if (!deployment || deployment.status !== "live" || !site) return false;
  // A deployment from before fingerprints existed has nothing to compare, and
  // claiming "changed" on no evidence would be a guess.
  if (!deployment.site_hash) return false;
  return deployment.site_hash !== siteFingerprint(site);
}

/**
 * Rewrites the published files for a project that is already live.
 *
 * Used after a menu sync so the customer-facing page reflects the spreadsheet
 * without a manual redeploy. Only the built output changes — the same Site
 * document theme is rendered, so the visual design cannot move.
 *
 * Returns the live URL when something was republished, otherwise null.
 */
export async function refreshDeployment(
  projectId: string,
  site: Site,
  userId = "",
  origin = "",
): Promise<string | null> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment || deployment.status !== "live") return null;

  /* A hosted provider cannot be rewritten in place, so it is republished.
     Built-in hosting is files on this disk, which can simply be overwritten.
     A GitHub Pages site is a commit in somebody's repository: the only way to
     change it is to push another one, which is the ordinary publish path. It
     runs in the background exactly as a manual publish does, so a menu sync
     still returns immediately. */
  if (deployment.platform !== "builtin") {
    if (!userId) return null;
    const started = startDeployment(
      projectId, site, deployment.platform, deployment.slug, origin, userId,
    );
    return started.url || deployment.url;
  }

  try {
    const base = deployment.url.replace(/\/$/, "");
    const target = path.join(PUBLISH_DIR, deployment.slug);
    for (const file of buildBundle(site, base)) {
      const dest = path.join(target, file.name);
      await mkdir(path.dirname(dest), { recursive: true });
      if (file.kind === "text") await writeFile(dest, file.content, "utf8");
      else if (file.kind === "resize") {
        if (existsSync(file.source)) await writeFile(dest, await resizedBytes(file));
      } else if (existsSync(file.source)) await copyFile(file.source, dest);
    }
    // The live site now matches this document, so say so — otherwise the
    // project would keep claiming unpublished changes forever.
    update(deployment.id, { site_hash: siteFingerprint(site), published_at: Date.now() });
    return deployment.url;
  } catch (err) {
    console.error("[deploy] refresh failed:", err);
    return null;
  }
}
