import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { disconnectProject, googleConfigured } from "@/server/google/oauth";
import { googleAccess } from "@/server/google/credentials";
import {
  clearServiceStatuses, createLink, linkState, listEvents, listLinks, recordEvent, revokeLink,
} from "@/server/connect/links";
import { connectionView, verifyAll } from "@/server/connect/verify";

/**
 * The creator's side of client Google connections.
 *
 * Ownership is enforced at the query, once, for every action: `getProject`
 * takes the signed-in user's id, so a project that is not theirs is
 * indistinguishable from one that does not exist.
 *
 * What a response may contain is the state of the connection and the links the
 * creator created — which they have to be able to copy and send. What it never
 * contains is a Google credential: none of the functions called here can return
 * one, and the token stores are not reachable from this file.
 */

async function load(ctx: { params: Promise<{ id: string }> }, userId: string) {
  const { id } = await ctx.params;
  return { id, project: getProject(id, userId) };
}

function state(projectId: string, userId: string) {
  const project = getProject(projectId, userId)!;
  return {
    configured: googleConfigured(),
    access: googleAccess(projectId, userId),
    connection: connectionView(project),
    links: listLinks(projectId).map((link) => ({
      // The token, because the creator has to be able to send the link. It is
      // theirs already; this screen is the only place it is shown.
      id: link.id,
      label: link.label,
      services: link.services,
      state: linkState(link),
      expires_at: link.expires_at,
      used_at: link.used_at,
      created_at: link.created_at,
    })),
    // No credential, no authorisation code and no link token — see
    // server/connect/links.ts for why the audit trail holds none of them.
    events: listEvents(projectId, 30),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, project } = await load(ctx, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(state(id, user.id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, project } = await load(ctx, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    label?: string;
    linkId?: string;
    expiryDays?: number;
  };

  if (body.action === "create-link") {
    if (!googleConfigured()) {
      return NextResponse.json(
        { error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before sending a client link." },
        { status: 400 },
      );
    }
    // The permissions come from the project's kind, not from this request —
    // there is no parameter here that could widen them.
    createLink(id, project.site_kind, {
      label: (body.label ?? "").slice(0, 80),
      expiryDays: typeof body.expiryDays === "number" ? body.expiryDays : undefined,
    });
    return NextResponse.json({ ok: true, ...state(id, user.id) });
  }

  if (body.action === "revoke-link") {
    // Scoped by project, so a link id from another project cannot be revoked
    // through this route even by its owner.
    const removed = revokeLink(body.linkId ?? "", id);
    return NextResponse.json(
      removed ? { ok: true, ...state(id, user.id) } : { error: "That link is not on this project." },
      { status: removed ? 200 : 400 },
    );
  }

  if (body.action === "verify") {
    await verifyAll(project);
    return NextResponse.json({ ok: true, ...state(id, user.id) });
  }

  if (body.action === "disconnect") {
    /* Withdraw the credentials and nothing else.
       ------------------------------------------------------------------
       The website, the menu data already synced, every saved version, the
       published site and the Analytics property this project uses all stay
       exactly as they are. Nothing in the client's Google account is touched:
       their spreadsheet, their folder and their Analytics property are theirs,
       and disconnecting is withdrawing permission, not deleting work.

       What stops working is future reading: a menu sync or an insights report
       will fall back to the creator's own connection, and say plainly if that
       one cannot see the client's material either. */
    disconnectProject(id);
    clearServiceStatuses(id);
    recordEvent(id, "disconnected", { detail: "by the project owner" });
    return NextResponse.json({ ok: true, ...state(id, user.id) });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export const dynamic = "force-dynamic";
