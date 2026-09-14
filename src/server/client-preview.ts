import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "./db";
import { getVersionSite, listVersions, type Version } from "./projects";
import type { Site } from "@/lib/site";

/**
 * A link a creator can send a client.
 *
 * Two decisions shape everything here.
 *
 * **The link is the capability.** There is no account for the client, no
 * password and no sign-in — a person being shown a website for approval will
 * not create one, and asking them to would mean the feature goes unused. So
 * the token has to carry the whole weight: 32 bytes of crypto-strong
 * randomness, generated independently of the project it points at. It is not
 * derived from a project id, an email, a slug or a counter, because anything
 * derived is guessable by someone who knows the inputs.
 *
 * **The link is pinned to one version.** It resolves to a saved document, not
 * to "whatever the project currently is". That is what makes an approval mean
 * something: if the creator edits the site afterwards, the client's approval
 * stays attached to the thing they actually looked at, and the new work needs
 * a new link. Treating an old approval as approval of a changed website would
 * be the single most damaging thing this feature could do.
 */

export type ClientPreview = {
  id: string;
  project_id: string;
  version_id: string;
  label: string;
  revoked: number;
  created_at: number;
};

export type ClientResponse = {
  id: string;
  preview_id: string;
  /** "approved" or "changes". */
  kind: string;
  message: string;
  resolved: number;
  created_at: number;
};

/** 43 characters of base64url — 256 bits, not enumerable. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Create a link for the project's current state.
 *
 * The current state has to be a saved version before it can be pinned to, so
 * the newest version is used. Every write path in `server/projects.ts` records
 * one, which means "the newest version" and "what the creator is looking at"
 * are the same document.
 */
export function createPreview(projectId: string, label = ""): ClientPreview | null {
  const latest = listVersions(projectId)[0];
  if (!latest) return null;

  const id = newToken();
  db.prepare(
    `INSERT INTO client_previews (id, project_id, version_id, label, revoked, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, projectId, latest.id, label || `Version ${latest.number}`, Date.now());

  return getPreview(id);
}

export function getPreview(id: string): ClientPreview | null {
  if (!id || id.length < 20) return null;
  return (
    (db.prepare("SELECT * FROM client_previews WHERE id = ?").get(id) as ClientPreview) ?? null
  );
}

/**
 * Resolve a link to the document it names.
 *
 * The one function the public route uses, and the only place a token turns
 * into anything. A revoked link, an unknown token and a version that no longer
 * exists all come back the same way — null — so a client cannot tell the
 * difference between a link that never existed and one that was withdrawn.
 */
export function resolvePreview(
  id: string,
): { preview: ClientPreview; site: Site; version: Version | null } | null {
  const preview = getPreview(id);
  if (!preview || preview.revoked) return null;

  const site = getVersionSite(preview.version_id, preview.project_id);
  if (!site) return null;

  const version = listVersions(preview.project_id).find((v) => v.id === preview.version_id) ?? null;
  return { preview, site, version };
}

export function listPreviews(projectId: string): (ClientPreview & {
  /** 1-based version number, for a creator who thinks in versions. */
  versionNumber: number;
  responses: ClientResponse[];
})[] {
  const versions = listVersions(projectId);
  const rows = db
    .prepare("SELECT * FROM client_previews WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as ClientPreview[];

  return rows.map((row) => ({
    ...row,
    versionNumber: versions.find((v) => v.id === row.version_id)?.number ?? 0,
    responses: listResponses(row.id),
  }));
}

export function revokePreview(id: string, projectId: string): void {
  db.prepare("UPDATE client_previews SET revoked = 1 WHERE id = ? AND project_id = ?").run(
    id,
    projectId,
  );
}

/* ------------------------------------------------------------- responses */

/** What the message field will accept, so a client cannot post a novel. */
export const MAX_FEEDBACK = 2000;

/**
 * Record what the client said.
 *
 * Clients add rows here and nothing else. There is deliberately no path from
 * this table to the website document: feedback is a message to the creator,
 * who decides what to do about it. A client who could edit the site directly
 * would be a client who could break it.
 */
export function recordResponse(
  previewId: string,
  kind: "approved" | "changes",
  message: string,
): ClientResponse | null {
  const preview = getPreview(previewId);
  if (!preview || preview.revoked) return null;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO client_responses (id, preview_id, kind, message, resolved, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, previewId, kind, message.slice(0, MAX_FEEDBACK), Date.now());

  return (
    (db.prepare("SELECT * FROM client_responses WHERE id = ?").get(id) as ClientResponse) ?? null
  );
}

export function listResponses(previewId: string): ClientResponse[] {
  return db
    .prepare("SELECT * FROM client_responses WHERE preview_id = ? ORDER BY created_at DESC")
    .all(previewId) as ClientResponse[];
}

/** Ownership is proved through the preview's project, never taken on trust. */
export function resolveResponse(responseId: string, projectId: string): void {
  db.prepare(
    `UPDATE client_responses SET resolved = 1
      WHERE id = ? AND preview_id IN (SELECT id FROM client_previews WHERE project_id = ?)`,
  ).run(responseId, projectId);
}

/**
 * The approval standing for a project right now.
 *
 * "Right now" is the point: an approval belongs to the version it was given
 * for, so this reports which version was approved and leaves the comparison
 * with the current one to the caller. Nothing here ever carries an old
 * approval forward onto new work.
 */
export function approvalState(projectId: string): {
  approvedVersion: number | null;
  approvedAt: number;
  openFeedback: number;
} {
  const previews = listPreviews(projectId);
  let approvedVersion: number | null = null;
  let approvedAt = 0;
  let openFeedback = 0;

  for (const preview of previews) {
    for (const response of preview.responses) {
      if (response.kind === "approved" && response.created_at > approvedAt) {
        approvedAt = response.created_at;
        approvedVersion = preview.versionNumber;
      }
      if (response.kind === "changes" && !response.resolved) openFeedback += 1;
    }
  }

  return { approvedVersion, approvedAt, openFeedback };
}
