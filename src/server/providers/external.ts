import "server-only";
import type { Site } from "@/lib/site";
import { swapIntoPlace } from "./builtin";
import type { DeployProvider, PublishContext } from "./types";

/**
 * Vercel and Netlify, exactly as they were.
 *
 * Moved into provider shape without a change in behaviour: both still write
 * the site locally first (which is what the engine always did for every
 * platform), still upload only the default-language document, and still
 * refuse loudly rather than faking success when the operator has configured
 * no token. If either grows into a real multi-file deployment later, it is
 * this file that changes and nothing else.
 */

function defaultDocument(bundle: PublishContext["bundle"], site: Site): string {
  const doc = bundle.find(
    (f): f is Extract<typeof f, { kind: "text" }> =>
      f.kind === "text" && f.name === `${site.meta.defaultLocale}/index.html`,
  );
  return doc?.content ?? "";
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

export const vercelProvider: DeployProvider = {
  id: "vercel",
  label: "Vercel",

  available: () => Boolean(process.env.VERCEL_TOKEN),
  unavailableReason: () =>
    "Vercel is not connected. Ask whoever runs this app to set VERCEL_TOKEN, or publish with built-in hosting instead.",

  async publicBaseUrl(ctx) {
    return `${ctx.origin.replace(/\/$/, "")}/s/${ctx.slug}`;
  },

  async publish(ctx) {
    await swapIntoPlace(ctx.stagingDir, ctx.slug, ctx.deploymentId);
    if (!process.env.VERCEL_TOKEN) throw new Error(vercelProvider.unavailableReason());

    ctx.log("Uploading to Vercel");
    const res = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: ctx.slug,
        target: "production",
        files: [{ file: "index.html", data: defaultDocument(ctx.bundle, ctx.site) }],
        projectSettings: { framework: null },
      }),
    });
    const data = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? "Vercel rejected the deployment.");
    ctx.log("Published");
    return { url: `https://${data.url}` };
  },

  async unpublish() {
    // A Vercel project is theirs to remove, from their dashboard: this
    // application has no mandate to delete something on an account it merely
    // holds a token for.
  },
};

export const netlifyProvider: DeployProvider = {
  id: "netlify",
  label: "Netlify",

  available: () => Boolean(process.env.NETLIFY_AUTH_TOKEN),
  unavailableReason: () =>
    "Netlify is not connected. Ask whoever runs this app to set NETLIFY_AUTH_TOKEN, or publish with built-in hosting instead.",

  async publicBaseUrl(ctx) {
    return `${ctx.origin.replace(/\/$/, "")}/s/${ctx.slug}`;
  },

  async publish(ctx) {
    await swapIntoPlace(ctx.stagingDir, ctx.slug, ctx.deploymentId);
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) throw new Error(netlifyProvider.unavailableReason());

    ctx.log("Uploading to Netlify");
    const create = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: ctx.slug }),
    });
    const site = (await create.json()) as {
      id?: string;
      ssl_url?: string;
      url?: string;
      message?: string;
    };
    if (!create.ok || !site.id) throw new Error(site.message ?? "Netlify rejected the site.");

    const deploy = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/zip" },
      // Buffer is not a valid BodyInit for the fetch types; a view is.
      body: new Uint8Array(await zipSingleFile(defaultDocument(ctx.bundle, ctx.site))),
    });
    if (!deploy.ok) throw new Error("Netlify rejected the upload.");

    ctx.log("Published");
    return { url: site.ssl_url ?? site.url ?? `https://${ctx.slug}.netlify.app` };
  },

  async unpublish() {
    // As with Vercel: the site belongs to the Netlify account, not to us.
  },
};
