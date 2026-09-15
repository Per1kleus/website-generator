import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { getLatestDeployment, hasUnpublishedChanges, slugify } from "@/server/deploy";
import { publicView } from "@/server/deploy-view";
import { availability } from "@/server/providers";
import { connectionStatus as githubStatus } from "@/server/github/oauth";
import { checkPublishable } from "@/server/publish-gate";
import { DeployPanel } from "@/components/DeployPanel";

export const metadata: Metadata = { title: "Publish" };

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
      // Filtered on the way out, like every other deployment response: the
      // screen gets the fields it draws and nothing else.
      initialDeployment={publicView(getLatestDeployment(id))}
      initialGate={checkPublishable(id, project.site)}
      initialHasChanges={hasUnpublishedChanges(id, project.site)}
      available={availability(user.id)}
      // Whether GitHub is connected, and how. Never the token.
      github={githubStatus(user.id)}
    />
  );
}
