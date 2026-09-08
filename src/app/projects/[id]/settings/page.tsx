import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { ProjectSettings } from "@/components/ProjectSettings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
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
    <ProjectSettings
      projectId={id}
      initial={{
        business_name: project.business_name,
        business_type: project.business_type,
        maps_url: project.maps_url,
        location: project.location,
        phone: project.phone,
        email: project.email,
        description: project.description,
      }}
    />
  );
}
