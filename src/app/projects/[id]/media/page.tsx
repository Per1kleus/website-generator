import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets } from "@/server/projects";
import { MediaManager } from "@/components/MediaManager";

export const metadata: Metadata = { title: "Images" };

export default async function MediaPage({
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
    <MediaManager
      projectId={id}
      businessName={project.business_name}
      initialAssets={listAssets(id)}
    />
  );
}
