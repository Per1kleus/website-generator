import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import {
  getLatestDeployment, hasUnpublishedChanges, platformAvailable, startDeployment,
  unpublish, type DeployPlatform,
} from "@/server/deploy";
import { checkPublishable } from "@/server/publish-gate";

const PLATFORMS: DeployPlatform[] = ["builtin", "vercel", "netlify"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // The gate is computed here so the screen can show, before anyone presses
  // anything, whether publishing would be refused and why.
  return NextResponse.json({
    deployment: getLatestDeployment(id),
    gate: checkPublishable(id, project.site),
    hasChanges: hasUnpublishedChanges(id, project.site),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const body = (await req.json()) as { platform?: string; slug?: string; action?: string };

  if (body.action === "unpublish") {
    const removed = await unpublish(id);
    return NextResponse.json({
      ok: removed,
      deployment: getLatestDeployment(id),
      ...(removed ? {} : { error: "This website is not published." }),
    });
  }

  const platform = (PLATFORMS.includes(body.platform as DeployPlatform)
    ? body.platform
    : "builtin") as DeployPlatform;

  if (!platformAvailable(platform)) {
    return NextResponse.json(
      { error: "That platform is not connected on this server." },
      { status: 400 },
    );
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
  );
  return NextResponse.json({ ok: true, deployment });
}

export const dynamic = "force-dynamic";
