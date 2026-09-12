import type { ReadinessReport } from "./checklist";

/**
 * What state a project is actually in.
 *
 * The database already knows whether a project is a draft, generating, ready
 * or failed. That is a record of what the *machine* did, and it is not the
 * question a person has when they open the list — theirs is "which of these
 * can I send, and which needs me". So the stored status is combined with the
 * readiness score and the publish record into the small set of states that
 * answer it, and no more than that: every extra state is one the creator has
 * to learn.
 */

export type ProjectState =
  | "draft"
  | "generating"
  | "ready-for-review"
  | "ready-to-publish"
  | "published"
  | "needs-attention"
  | "failed";

export type StateInfo = {
  id: ProjectState;
  label: string;
  /** One line explaining what the state means, for a tooltip or a card. */
  hint: string;
  /** Traffic-light role, for the UI to colour by. */
  tone: "neutral" | "progress" | "good" | "warn" | "bad";
};

export const PROJECT_STATES: Record<ProjectState, StateInfo> = {
  draft: {
    id: "draft",
    label: "Draft",
    hint: "Not generated yet.",
    tone: "neutral",
  },
  generating: {
    id: "generating",
    label: "Generating",
    hint: "The website is being built.",
    tone: "progress",
  },
  "ready-for-review": {
    id: "ready-for-review",
    label: "Ready for review",
    hint: "Generated, with things worth looking at before it goes out.",
    tone: "warn",
  },
  "ready-to-publish": {
    id: "ready-to-publish",
    label: "Ready to publish",
    hint: "Everything checks out.",
    tone: "good",
  },
  published: {
    id: "published",
    label: "Published",
    hint: "Live at its public address.",
    tone: "good",
  },
  "needs-attention": {
    id: "needs-attention",
    label: "Needs attention",
    hint: "Something must be fixed before this is sent to a client.",
    tone: "bad",
  },
  failed: {
    id: "failed",
    label: "Failed",
    hint: "Generation did not finish.",
    tone: "bad",
  },
};

export type StatusInput = {
  /** The stored project status. */
  status: string;
  /** Whether a site document exists at all. */
  hasSite: boolean;
  /** The readiness report, when one could be computed. */
  readiness: ReadinessReport | null;
  /** The latest deployment's status, if the project was ever published. */
  deploymentStatus?: string | null;
};

/**
 * The state, derived rather than stored.
 *
 * Deriving it means it cannot go stale: a project that was "ready to publish"
 * yesterday and had its phone number deleted this morning says so the next
 * time anybody looks, without anything having to remember to update a column.
 */
export function projectState(input: StatusInput): ProjectState {
  if (input.status === "generating") return "generating";
  if (input.status === "failed") return "failed";
  if (!input.hasSite) return "draft";

  // A critical readiness failure outranks everything, published or not: a live
  // site that lost its contact details is the most urgent case there is, not
  // the calmest.
  if (input.readiness?.status === "NOT READY") return "needs-attention";

  if (input.deploymentStatus === "live") return "published";

  if (!input.readiness) return "ready-for-review";
  return input.readiness.status === "READY" ? "ready-to-publish" : "ready-for-review";
}

export function stateInfo(state: ProjectState): StateInfo {
  return PROJECT_STATES[state];
}

/** "Today", "yesterday", "3 days ago" — the resolution a person actually wants. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}
