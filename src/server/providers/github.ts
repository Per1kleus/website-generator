import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkDomain } from "@/lib/domain";
import type { BundleFile } from "../bundle";
import { slugify, type Deployment } from "../deploy-model";
import {
  commitFiles, createRepo, disablePages, enablePages, ensurePrivate, getPages, getRepo,
  GitHubError, setPagesDomain, type Repo, type UploadFile,
} from "../github/api";
import { connectionStatus, ownerLogin } from "../github/oauth";
import type { BaseUrlContext, DeployProvider, ProviderMeta, PublishContext } from "./types";

/**
 * Generated website → private GitHub repository → GitHub Pages → public site.
 *
 * The repository is private and the website is public. That is not a
 * contradiction: GitHub Pages serves the built files from a private
 * repository without making the repository readable, which is exactly the
 * shape this needs — the client's photographs, prices, draft copy and commit
 * history stay closed, and the finished website is open.
 *
 * Everything before this file is untouched. The readiness gate, the bundler,
 * the version history, the client preview and the atomic-publish contract are
 * the existing ones; this is the last step of the same pipeline, and the only
 * part of the application that knows GitHub exists at all — besides the
 * connection screen and the API client it calls.
 */

/**
 * A repository name for a project.
 *
 * Deterministic, so republishing finds the same repository rather than
 * creating a second one; and derived from the slug the rest of the
 * application already computes, so the address a creator sees on the
 * publishing screen and the repository name agree.
 *
 * Re-slugified rather than trusted: this string ends up in a URL path. It can
 * only ever contain lowercase letters, digits and hyphens, so there is no
 * `..`, no `/`, no shell metacharacter and nothing to escape.
 */
export function repoNameFor(slug: string): string {
  const safe = slugify(slug);
  // GitHub allows up to 100 characters; the existing slug is capped at 48.
  return safe || "website";
}

/** The address GitHub Pages serves a project site from. */
export function pagesHost(owner: string): string {
  return `${owner.toLowerCase()}.github.io`;
}

export function pagesUrl(owner: string, repo: string): string {
  return `https://${pagesHost(owner)}/${repo}/`;
}

/**
 * Where this project's website lives, publicly.
 *
 * A connected custom domain wins, because the moment one is serving, it is
 * the address the client gives out and the address every canonical link in
 * the bundle has to carry.
 */
function publicBase(deployment: Deployment | null, owner: string, repo: string): string {
  const domain = deployment?.custom_domain ?? "";
  if (domain && checkDomain(domain).ok) return `https://${domain}`;
  return pagesUrl(owner, repo).replace(/\/$/, "");
}

/** Everything in the bundle, as bytes, ready to commit. */
async function filesToUpload(ctx: PublishContext): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const file of ctx.bundle) {
    // Read back from the staging directory rather than re-deriving: the
    // resized variants were produced when the directory was written, and
    // producing them twice would mean two chances to differ.
    const source = path.join(ctx.stagingDir, file.name);
    try {
      out.push({ path: file.name, bytes: await readFile(source) });
    } catch {
      // A photograph whose original has gone missing is skipped by the
      // writer too; the page falls back exactly as it does locally.
    }
  }
  return out;
}

export const githubProvider: DeployProvider = {
  id: "github",
  label: "GitHub Pages",

  available: (userId: string) => connectionStatus(userId).connected,

  unavailableReason: () =>
    "GitHub is not connected. Connect a GitHub account on this screen to publish to GitHub Pages.",

  async publicBaseUrl(ctx: BaseUrlContext) {
    const owner = await ownerLogin(ctx.userId);
    if (!owner) throw new GitHubError(githubProvider.unavailableReason(), 401, "auth", true);
    return publicBase(ctx.deployment, owner, repoNameFor(ctx.slug));
  },

  /**
   * GitHub Pages reads the custom domain from a `CNAME` file in the site.
   *
   * Setting it through the API alone is not enough: GitHub rewrites that file
   * from the API setting, and the next commit — which replaces the whole tree
   * — would drop it and take the domain down with it. So the file is part of
   * the bundle whenever a domain is connected.
   */
  async extraFiles(ctx: BaseUrlContext): Promise<BundleFile[]> {
    const domain = ctx.deployment?.custom_domain ?? "";
    const check = checkDomain(domain);
    if (!check.ok) return [];
    return [{ kind: "text", name: "CNAME", content: `${check.domain}\n` }];
  },

  async publish(ctx: PublishContext) {
    const owner = await ownerLogin(ctx.userId);
    if (!owner) throw new GitHubError(githubProvider.unavailableReason(), 401, "auth", true);
    const name = repoNameFor(ctx.slug);

    /* The repository, created once and reused for ever after.
       ------------------------------------------------------------------
       Republishing must update the website the client already has, so the
       repository is looked up first and only created when it is genuinely
       absent. A repository that exists is re-asserted private on every
       publish rather than assumed to still be private: a settings change
       made on GitHub months later must not quietly expose a client's
       material on the next deploy. */
    ctx.log("Checking the repository");
    let repo: Repo | null = await getRepo(ctx.userId, owner, name);
    if (!repo) {
      ctx.log(`Creating the private repository ${owner}/${name}`);
      repo = await createRepo(
        ctx.userId,
        name,
        `Website for ${ctx.site.meta.businessName}. Published by Website Generator.`,
      );
    } else if (!repo.private) {
      ctx.log("Making the repository private again");
      await ensurePrivate(ctx.userId, owner, name);
      repo = { ...repo, private: true };
    }

    const files = await filesToUpload(ctx);
    ctx.log(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}`);
    const commitSha = await commitFiles(
      ctx.userId,
      repo,
      files,
      `Publish ${ctx.site.meta.businessName}`,
      (uploaded, total) => {
        // A site of photographs takes a while; say so every so often rather
        // than leaving the screen on one line for a minute.
        if (uploaded === total || uploaded % 10 === 0) ctx.log(`Uploaded ${uploaded}/${total}`);
      },
    );

    /* Pages, switched on once and left alone afterwards.
       Asking GitHub to enable something already enabled is a 409, which is
       not a failure — it is the answer "already done". */
    ctx.log("Configuring GitHub Pages");
    let pages = await getPages(ctx.userId, owner, name);
    if (!pages) {
      try {
        pages = await enablePages(ctx.userId, owner, name, repo.defaultBranch);
      } catch (err) {
        if (err instanceof GitHubError && err.status === 409) {
          pages = await getPages(ctx.userId, owner, name);
        } else {
          throw err;
        }
      }
    }

    // A connected domain is told to GitHub here, once the CNAME file it reads
    // is actually in the commit that was just pushed.
    const domain = ctx.deployment.custom_domain ?? "";
    const check = checkDomain(domain);
    if (check.ok && pages && pages.cname.toLowerCase() !== check.domain) {
      ctx.log(`Pointing GitHub Pages at ${check.domain}`);
      await setPagesDomain(ctx.userId, owner, name, check.domain);
      pages = await getPages(ctx.userId, owner, name);
    }

    const url = publicBase(ctx.deployment, owner, name);
    const meta: ProviderMeta = {
      repo_owner: owner,
      repo_name: name,
      repo_private: 1,
      repo_url: repo.htmlUrl || `https://github.com/${owner}/${name}`,
      commit_sha: commitSha,
      pages_status: pages?.status || "building",
      pages_url: pages?.url || pagesUrl(owner, name),
      // A brand-new Pages site takes a minute or two to build. Saying "live"
      // is honest — the deployment succeeded — and the screen separately
      // shows what GitHub says about the build.
      /* Telling GitHub about the domain invalidates whatever the last DNS
         check concluded, so the next check really looks rather than
         repeating an observation taken before the configuration changed. */
      ...(check.ok ? { domain_status: "configuring" as const, domain_checked_at: 0 } : {}),
    };

    ctx.log("Published");
    return { url: `${url}/`, meta };
  },

  /**
   * Take the website down, keep everything else.
   *
   * Pages is switched off, which stops the public site immediately. The
   * repository, its history and every file in it stay exactly where they are:
   * unpublishing a website is not permission to delete a client's material,
   * and publishing again has to be one press rather than a rebuild from
   * nothing.
   */
  async unpublish(deployment: Deployment, userId: string) {
    if (!deployment.repo_owner || !deployment.repo_name) return;
    await disablePages(userId, deployment.repo_owner, deployment.repo_name);
  },
};
