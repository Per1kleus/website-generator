import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import type { Site } from "@/lib/site";
import { buildBundle, resizedBytes } from "./bundle";

/**
 * Deployment from a phone (requirement 13).
 *
 * `builtin` is a real deployment: the rendered site and its images are written
 * to disk and served publicly at /s/<slug>, with no authentication. That is
 * what makes "deploy from a café, with only a phone" actually true rather than
 * a screen that pretends.
 *
 * Vercel and Netlify are offered when the operator has configured an API
 * token. Without one we say so plainly instead of faking a green tick.
 */

export const PUBLISH_DIR = path.join(
  process.env.WG_DATA_DIR ?? path.join(process.cwd(), "data"),
  "published",
);

export type DeployPlatform = "builtin" | "vercel" | "netlify";

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

type DeploymentRow = Omit<Deployment, "log"> & { log: string };

export function platformAvailable(platform: DeployPlatform): boolean {
  if (platform === "builtin") return true;
  if (platform === "vercel") return Boolean(process.env.VERCEL_TOKEN);
  if (platform === "netlify") return Boolean(process.env.NETLIFY_AUTH_TOKEN);
  return false;
}

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
            published_at = ?, site_hash = ?, unpublished_at = ?
      WHERE id = ?`,
  ).run(
    merged.status, merged.url, JSON.stringify(merged.log), merged.error, Date.now(),
    merged.published_at ?? 0, merged.site_hash ?? "", merged.unpublished_at ?? 0,
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
): Deployment {
  const id = randomUUID();
  const slug = uniqueSlug(requestedSlug || site.meta.businessName, projectId);
  const now = Date.now();

  db.prepare(
    `INSERT INTO deployments (id, project_id, platform, slug, status, url, log, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', '', '[]', ?, ?)`,
  ).run(id, projectId, platform, slug, now, now);

  // Same pattern as generation: the response returns now, the work continues.
  void runDeployment(id, site, platform, slug, origin);

  return getDeployment(id)!;
}

async function runDeployment(
  id: string,
  site: Site,
  platform: DeployPlatform,
  slug: string,
  origin: string,
) {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    log(id, "Preparing files", "preparing");
    await pause(300);

    // The public base URL is known here, so every page gets a real canonical
    // and real hreflang links rather than relative guesses.
    const siteBase = `${origin.replace(/\/$/, "")}/s/${slug}`;
    const bundle = buildBundle(site, siteBase);

    /* Built beside the live site, never on top of it.
       ------------------------------------------------------------------
       Writing straight into the served directory means deleting a working
       website and then hoping: a failure halfway through — a disk full, an
       unreadable photograph, the process being killed — used to leave the
       public URL serving a half-written site with no way back.

       So the new version is assembled under a staging name, and only once it
       is complete does it change places with the live one. Both renames are
       within one directory, so each is a single atomic operation as far as
       any reader is concerned: a visitor sees the old site or the new one,
       never a mixture. */
    log(id, "Building the site", "building");
    const target = path.join(PUBLISH_DIR, slug);
    const staging = path.join(PUBLISH_DIR, `.staging-${id}`);
    const previous = path.join(PUBLISH_DIR, `.previous-${id}`);
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
      // Nothing has been swapped in yet, so the live site is exactly as it
      // was. Clear the half-built copy and report the real reason.
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    log(id, `${site.meta.locales.length} language${site.meta.locales.length === 1 ? "" : "s"}, ${images} image${images === 1 ? "" : "s"} bundled`);

    const hadPrevious = existsSync(target);
    try {
      if (hadPrevious) await rename(target, previous);
      await rename(staging, target);
    } catch (err) {
      // Put the old site back before giving up. The window in which neither
      // exists is one rename wide and only reachable if the second rename
      // fails, which is why the first thing the failure path does is undo it.
      if (hadPrevious && existsSync(previous) && !existsSync(target)) {
        await rename(previous, target).catch(() => {});
      }
      await rm(staging, { recursive: true, force: true });
      throw err;
    }
    // The old version is only discarded once the new one is serving.
    await rm(previous, { recursive: true, force: true });

    log(id, "Deploying", "deploying");
    await pause(400);

    if (platform === "builtin") {
      log(id, "Published");
      update(id, {
        status: "live",
        url: `${siteBase}/`,
        published_at: Date.now(),
        site_hash: siteFingerprint(site),
        unpublished_at: 0,
      });
      return;
    }

    // Vercel / Netlify need an operator-provided token. Rather than pretend,
    // fail loudly with the exact reason and leave the built files in place.
    const tokenVar = platform === "vercel" ? "VERCEL_TOKEN" : "NETLIFY_AUTH_TOKEN";
    if (!process.env[tokenVar]) {
      throw new Error(
        `${platform === "vercel" ? "Vercel" : "Netlify"} is not connected. ` +
          `Ask whoever runs this app to set ${tokenVar}, or deploy with built-in hosting instead.`,
      );
    }

    const defaultDoc = bundle.find(
      (f): f is Extract<typeof f, { kind: "text" }> =>
        f.kind === "text" && f.name === `${site.meta.defaultLocale}/index.html`,
    );
    const url = await deployToProvider(
      platform,
      slug,
      defaultDoc?.content ?? "",
      (line) => log(id, line),
    );
    log(id, "Published");
    update(id, {
      status: "live",
      url,
      published_at: Date.now(),
      site_hash: siteFingerprint(site),
      unpublished_at: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deployment failed";
    update(id, { status: "failed", error: message });
    log(id, `Failed: ${message}`);
  }
}

/** Uploads a single-file site to Vercel or Netlify via their REST APIs. */
async function deployToProvider(
  platform: "vercel" | "netlify",
  slug: string,
  html: string,
  onLog: (line: string) => void,
): Promise<string> {
  if (platform === "vercel") {
    onLog("Uploading to Vercel");
    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: slug,
        target: "production",
        files: [{ file: "index.html", data: html }],
        projectSettings: { framework: null },
      }),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? "Vercel rejected the deployment.");
    return `https://${data.url}`;
  }

  onLog("Uploading to Netlify");
  const create = await fetch("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: slug }),
  });
  const site = (await create.json()) as { id?: string; ssl_url?: string; url?: string; message?: string };
  if (!create.ok || !site.id) throw new Error(site.message ?? "Netlify rejected the site.");

  const deploy = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`,
      "Content-Type": "application/zip",
    },
    // Buffer is not a valid BodyInit for the fetch types; a view is.
    body: new Uint8Array(await zipSingleFile(html)),
  });
  if (!deploy.ok) throw new Error("Netlify rejected the upload.");

  return site.ssl_url ?? site.url ?? `https://${slug}.netlify.app`;
}

async function zipSingleFile(html: string): Promise<Buffer> {
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on("data", (c: Buffer) => chunks.push(c));
  archive.append(html, { name: "index.html" });
  await archive.finalize();
  return Buffer.concat(chunks);
}

/**
 * Take a published website down.
 *
 * The files go; the row stays. Keeping it means the slug stays reserved — so
 * a client's bookmark cannot later land on somebody else's site — and the
 * history of what was published when stays readable. Re-publishing reuses the
 * same slug, so the URL a creator already gave out keeps working.
 */
export async function unpublish(projectId: string): Promise<boolean> {
  const deployment = getLatestDeployment(projectId);
  if (!deployment || deployment.status !== "live") return false;

  if (deployment.platform === "builtin") {
    await rm(path.join(PUBLISH_DIR, deployment.slug), { recursive: true, force: true });
  }
  // A Vercel or Netlify site is theirs to remove, from their dashboard: this
  // application has no mandate to delete something on an account it merely
  // holds a token for. The status says so rather than pretending.
  update(deployment.id, { status: "unpublished", unpublished_at: Date.now(), error: null });
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
export async function refreshDeployment(projectId: string, site: Site): Promise<string | null> {
  const deployment = getLatestDeployment(projectId);
  // Only built-in hosting is ours to rewrite; a Vercel/Netlify site needs a
  // fresh deploy through their API, which is the creator's explicit action.
  if (!deployment || deployment.status !== "live" || deployment.platform !== "builtin") {
    return null;
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
