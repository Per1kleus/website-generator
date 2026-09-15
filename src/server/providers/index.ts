import "server-only";
import type { DeployPlatform } from "../deploy-model";
import { builtinProvider } from "./builtin";
import { netlifyProvider, vercelProvider } from "./external";
import { githubProvider } from "./github";
import type { DeployProvider } from "./types";

/**
 * Every place that hosts a generated website.
 *
 * The one list. Routes, the publishing screen and the deployment engine all
 * read it rather than each keeping their own idea of what the platforms are —
 * which is how "vercel" once appeared in three separate arrays that had to be
 * kept in step by hand.
 */
const PROVIDERS: Record<DeployPlatform, DeployProvider> = {
  builtin: builtinProvider,
  github: githubProvider,
  vercel: vercelProvider,
  netlify: netlifyProvider,
};

export const PLATFORMS = Object.keys(PROVIDERS) as DeployPlatform[];

export function isPlatform(value: unknown): value is DeployPlatform {
  return typeof value === "string" && (PLATFORMS as string[]).includes(value);
}

export function providerFor(platform: DeployPlatform): DeployProvider {
  return PROVIDERS[platform] ?? builtinProvider;
}

/** Which providers this creator can actually publish with, right now. */
export function availability(userId: string): Record<DeployPlatform, boolean> {
  return Object.fromEntries(
    PLATFORMS.map((id) => [id, PROVIDERS[id].available(userId)]),
  ) as Record<DeployPlatform, boolean>;
}

export type { DeployProvider, PublishContext, PublishResult } from "./types";
