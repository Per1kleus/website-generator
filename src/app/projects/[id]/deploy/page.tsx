import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { getLatestDeployment, platformAvailable, slugify } from "@/server/deploy";
import { DeployPanel } from "@/components/DeployPanel";

export const metadata: Metadata = { title: "Deploy" };

export default async function DeployPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();
  if (!project.site) redirect(`/projects/${id}`);

  return (
    <DeployPanel
      projectId={id}
      businessName={project.business_name}
      defaultSlug={slugify(project.business_name)}
      initialDeployment={getLatestDeployment(id)}
      available={{
        builtin: true,
        vercel: platformAvailable("vercel"),
        netlify: platformAvailable("netlify"),
      }}
    />
  );
}
