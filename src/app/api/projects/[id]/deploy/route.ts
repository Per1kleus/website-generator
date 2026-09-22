import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, listVersions } from "@/server/projects";
import {
  getLatestDeployment, hasUnpublishedChanges, startDeployment, unpublish,
  type DeployPlatform,
} from "@/server/deploy";
import { availability, isPlatform, providerFor } from "@/server/providers";
import { checkPublishable } from "@/server/publish-gate";
import { connectionStatus as githubStatus } from "@/server/github/oauth";
import { connectDomain, disconnectDomain, refreshDomain, publicView } from "@/server/deploy-view";

/**
 * Publishing, and everything about where a website is published.
 *
 * One route, because it is one screen: the publish gate, the deployment, the
 * hosting provider, the repository and the custom domain are all facets of
 * "is this website in front of the public, and where". Splitting them would
 * mean the screen polling four endpoints to answer one question.
 *
 * Every response is filtered through `publicView`, which is the allowlist for
 * what a browser may know about a deployment. No credential passes it, and no
 * credential could: tokens are never on a deployment row in the first place.
 */

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // The gate is computed here so the screen can show, before anyone presses
  // anything, whether publishing would be refused and why.
  return NextResponse.json({
    deployment: publicView(getLatestDeployment(id)),
    gate: checkPublishable(id, project.site),
    hasChanges: hasUnpublishedChanges(id, project.site),
    available: availability(user.id),
    github: githubStatus(user.id),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  // Ownership is checked here, once, for every action below. A project that
  // is not this user's is indistinguishable from one that does not exist.
  const project = getProject(id, user.id);
  if (!project?.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    platform?: string;
    slug?: string;
    action?: string;
    domain?: string;
  };

  if (body.action === "unpublish") {
    const removed = await unpublish(id, user.id);
    return NextResponse.json({
      ok: removed,
      deployment: publicView(getLatestDeployment(id)),
      ...(removed ? {} : { error: "This website is not published." }),
    });
  }

  /* ---------------------------------------------------- custom domains */

  if (body.action === "connect-domain") {
    const result = await connectDomain(id, user.id, body.domain ?? "");
    return NextResponse.json(
      result.ok
        ? { ok: true, deployment: publicView(getLatestDeployment(id)), records: result.records }
        : { error: result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (body.action === "disconnect-domain") {
    const result = await disconnectDomain(id, user.id);
    return NextResponse.json(
      result.ok ? { ok: true, deployment: publicView(getLatestDeployment(id)) } : { error: result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  if (body.action === "check-domain") {
    /* A person pressed the button, so this really looks. The window that
       applies here only stops a double-click, not a considered retry. */
    const result = await refreshDomain(id, user.id, { force: true });
    return NextResponse.json(
      result.ok
        ? {
            ok: true,
            deployment: publicView(getLatestDeployment(id)),
            dns: result.dns,
            // True when this answer is the last observation rather than a
            // fresh one. DNS does not change in seconds, and saying so is
            // better than pretending to have looked again.
            throttled: Boolean(result.throttled),
          }
        : { error: result.error },
      { status: result.ok ? 200 : 400 },
    );
  }

  /* ---------------------------------------------------------- publish */

  const platform = (isPlatform(body.platform) ? body.platform : "builtin") as DeployPlatform;
  const provider = providerFor(platform);

  if (!provider.available(user.id)) {
    return NextResponse.json({ error: provider.unavailableReason() }, { status: 400 });
  }

  /* Refuse to put something broken in front of the public.
     The checks are the ones the project screen already shows, so a creator is
     never blocked by a rule they have not seen; and only issues the checklist
     itself calls critical block, because refusing to publish over a meta
     description that could be better would be the tool getting in the way. */
  const gate = checkPublishable(id, project.site);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "This website cannot be published yet.", gate },
      { status: 400 },
    );
  }

  const deployment = startDeployment(
    id,
    project.site,
    platform,
    body.slug ?? "",
    new URL(req.url).origin,
    user.id,
    // Which saved version is going public. The version history itself is
    // untouched — this only records which of its entries is the live one.
    listVersions(id)[0]?.id ?? "",
  );
  return NextResponse.json({ ok: true, deployment: publicView(deployment) });
}

export const dynamic = "force-dynamic";
