import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listVersions } from "@/server/projects";
import { VersionList } from "@/components/VersionList";

export const metadata: Metadata = { title: "Versions" };

export default async function VersionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();

  return (
    <VersionList
      projectId={id}
      businessName={project.business_name}
      initialVersions={listVersions(id)}
    />
  );
}
