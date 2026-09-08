import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { getLatestJob } from "@/server/jobs";
import { GenerationProgress } from "@/components/GenerationProgress";

export const metadata: Metadata = { title: "Generating" };

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();

  // Server-rendered initial state: the screen is correct on first paint even
  // on a cold app launch over a slow connection, before any polling starts.
  return (
    <GenerationProgress
      projectId={project.id}
      businessName={project.business_name}
      initialStatus={project.status}
      initialJob={getLatestJob(project.id)}
    />
  );
}
