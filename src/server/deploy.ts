import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, UPLOAD_DIR } from "./db";
import { renderSite } from "@/lib/render";
import type { Site } from "@/lib/site";

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
  status: "queued" | "preparing" | "building" | "deploying" | "live" | "failed";
  url: string;
  log: string[];
  error: string | null;
  created_at: number;
  updated_at: number;
};

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
    `UPDATE deployments SET status = ?, url = ?, log = ?, error = ?, updated_at = ? WHERE id = ?`,
  ).run(merged.status, merged.url, JSON.stringify(merged.log), merged.error, Date.now(), id);
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

    const html = renderSite(site, { assetUrl: (assetId) => `images/${assetId}.webp` });

    log(id, "Building the site", "building");
    const target = path.join(PUBLISH_DIR, slug);
    await rm(target, { recursive: true, force: true });
    await mkdir(path.join(target, "images"), { recursive: true });
    await writeFile(path.join(target, "index.html"), html, "utf8");

    const imageIds = new Set<string>();
    for (const section of site.sections) {
      if (section.type === "gallery") section.props.imageIds.forEach((i) => imageIds.add(i));
      if (section.type === "hero" && section.props.imageId) imageIds.add(section.props.imageId);
      if (section.type === "about" && section.props.imageId) imageIds.add(section.props.imageId);
    }
    for (const assetId of imageIds) {
      const src = path.join(UPLOAD_DIR, `${assetId}.webp`);
      if (existsSync(src)) await copyFile(src, path.join(target, "images", `${assetId}.webp`));
    }
    log(id, `${imageIds.size} image${imageIds.size === 1 ? "" : "s"} bundled`);

    log(id, "Deploying", "deploying");
    await pause(400);

    if (platform === "builtin") {
      const url = `${origin.replace(/\/$/, "")}/s/${slug}`;
      log(id, "Published");
      update(id, { status: "live", url });
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

    const url = await deployToProvider(platform, slug, html, (line) => log(id, line));
    log(id, "Published");
    update(id, { status: "live", url });
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
