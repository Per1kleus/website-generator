import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import {
  getLatestDeployment, platformAvailable, startDeployment,
  type DeployPlatform,
} from "@/server/deploy";

const PLATFORMS: DeployPlatform[] = ["builtin", "vercel", "netlify"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ deployment: getLatestDeployment(id) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const body = (await req.json()) as { platform?: string; slug?: string };
  const platform = (PLATFORMS.includes(body.platform as DeployPlatform)
    ? body.platform
    : "builtin") as DeployPlatform;

  if (!platformAvailable(platform)) {
    return NextResponse.json(
      { error: "That platform is not connected on this server." },
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
