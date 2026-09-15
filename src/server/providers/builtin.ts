import "server-only";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { PUBLISH_DIR } from "../deploy-model";
import type { DeployProvider, PublishContext } from "./types";

/**
 * Hosting from this application's own server, at /s/<slug>.
 *
 * Unchanged behaviour, moved: the atomic directory swap that used to sit in
 * the middle of `runDeployment` is the built-in provider's publish step,
 * because that is exactly what it always was. Every other provider now gets
 * the same guarantee expressed in its own terms — GitHub moves a branch ref
 * once, this moves a directory once.
 */

/**
 * Swap a finished directory into place, keeping the old one until it is safe.
 *
 * Shared, because Vercel and Netlify deployments have always also written the
 * site locally and continue to. Both renames are within one directory, so
 * each is atomic as far as any reader is concerned: a visitor sees the old
 * site or the new one, never a mixture.
 */
export async function swapIntoPlace(
  stagingDir: string,
  slug: string,
  deploymentId: string,
): Promise<void> {
  const target = path.join(PUBLISH_DIR, slug);
  const previous = path.join(PUBLISH_DIR, `.previous-${deploymentId}`);

  const hadPrevious = existsSync(target);
  try {
    if (hadPrevious) await rename(target, previous);
    await rename(stagingDir, target);
  } catch (err) {
    // Put the old site back before giving up. The window in which neither
    // exists is one rename wide and only reachable if the second rename
    // fails, which is why the first thing the failure path does is undo it.
    if (hadPrevious && existsSync(previous) && !existsSync(target)) {
      await rename(previous, target).catch(() => {});
    }
    await rm(stagingDir, { recursive: true, force: true });
    throw err;
  }
  // The old version is only discarded once the new one is serving.
  await rm(previous, { recursive: true, force: true });
}

export const builtinProvider: DeployProvider = {
  id: "builtin",
  label: "Built-in hosting",

  available: () => true,
  unavailableReason: () => "",

  async publicBaseUrl(ctx) {
    return `${ctx.origin.replace(/\/$/, "")}/s/${ctx.slug}`;
  },

  async publish(ctx: PublishContext) {
    await swapIntoPlace(ctx.stagingDir, ctx.slug, ctx.deploymentId);
    ctx.log("Published");
    return { url: `${ctx.baseUrl}/` };
  },

  async unpublish(deployment) {
    await rm(path.join(PUBLISH_DIR, deployment.slug), { recursive: true, force: true });
  },
};
