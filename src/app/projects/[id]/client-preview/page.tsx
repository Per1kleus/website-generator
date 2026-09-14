import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listVersions } from "@/server/projects";
import { listPreviews } from "@/server/client-preview";
import { ClientPreviewPanel } from "@/components/ClientPreviewPanel";

export const metadata: Metadata = { title: "Client preview" };

export default async function ClientPreviewAdminPage({
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
    <ClientPreviewPanel
      projectId={id}
      businessName={project.business_name}
      initialPreviews={listPreviews(id)}
      currentVersion={listVersions(id)[0]?.number ?? 0}
    />
  );
}
