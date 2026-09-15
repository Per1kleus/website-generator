import "server-only";
import type { Site } from "@/lib/site";
import type { BundleFile } from "../bundle";
import type { Deployment, DeployPlatform } from "../deploy-model";

/**
 * What a hosting provider has to be able to do.
 *
 * Everything that is the same for every provider stays in `server/deploy.ts`:
 * the deployment row, the queue, the log, the publish gate, the site
 * fingerprint, the version that went live, and building the file set from the
 * one bundler. A provider is only the last step — "here is a finished static
 * website in a directory, put it somewhere public" — plus the two questions
 * that step needs answered first.
 *
 * That boundary is what keeps GitHub out of the rest of the application. The
 * engine never asks "is this GitHub?"; it asks the provider for a base URL,
 * for extra files, and to publish. A fifth provider is a new file in this
 * folder and a line in the registry.
 */

/** Everything a provider is given. No credential is among it. */
export type PublishContext = {
  deploymentId: string;
  projectId: string;
  /** Who is publishing. Providers fetch their own credentials for this user. */
  userId: string;
  slug: string;
  site: Site;
  /** The finished static website, already written to disk. */
  stagingDir: string;
  bundle: BundleFile[];
  /** The public address the bundle was built for. */
  baseUrl: string;
  /** This application's own origin, for providers that host locally. */
  origin: string;
  /** The row as it stands, including any provider metadata from last time. */
  deployment: Deployment;
  log: (line: string) => void;
};

/** What the engine records once a provider succeeds. */
export type PublishResult = {
  /** The address to give a client. */
  url: string;
  /** Provider metadata to persist on the deployment row. */
  meta?: ProviderMeta;
};

export type ProviderMeta = Partial<
  Pick<
    Deployment,
    | "repo_owner"
    | "repo_name"
    | "repo_private"
    | "repo_url"
    | "commit_sha"
    | "pages_status"
    | "pages_url"
    | "custom_domain"
    | "domain_status"
    | "domain_error"
    | "domain_checked_at"
  >
>;

/** What the engine needs before it can build the bundle. */
export type BaseUrlContext = {
  projectId: string;
  userId: string;
  slug: string;
  origin: string;
  deployment: Deployment | null;
};

export type DeployProvider = {
  id: DeployPlatform;
  /** What a person calls it. */
  label: string;

  /**
   * Whether this provider can be used right now.
   *
   * Takes the user because availability is per-creator for anything connected
   * by OAuth: a server-wide token is one answer for everybody, a connected
   * account is not.
   */
  available(userId: string): boolean;

  /** What the creator must do when it is not available. One sentence. */
  unavailableReason(): string;

  /**
   * The public address the website will live at.
   *
   * Called before the bundle is built, because every canonical link, hreflang
   * link and sitemap entry inside the bundle contains it.
   */
  publicBaseUrl(ctx: BaseUrlContext): Promise<string>;

  /**
   * Files this provider needs in the bundle that no other provider does.
   *
   * GitHub Pages needs a `CNAME` file to serve a custom domain. Rather than
   * teaching the shared bundler about GitHub, the provider contributes it.
   */
  extraFiles?(ctx: BaseUrlContext): Promise<BundleFile[]>;

  /** Put the finished website somewhere public. */
  publish(ctx: PublishContext): Promise<PublishResult>;

  /**
   * Take the public website down.
   *
   * Never destroys anything that is not the deployment itself: a repository,
   * a Vercel project or a Netlify site belongs to the account it lives in,
   * and unpublishing a website is not permission to delete it.
   */
  unpublish(deployment: Deployment, userId: string): Promise<void>;
};
