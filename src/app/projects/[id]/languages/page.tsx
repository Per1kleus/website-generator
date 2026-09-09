import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { LanguageManager } from "@/components/LanguageManager";

export const metadata: Metadata = { title: "Languages" };

export default async function LanguagesPage({
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
    <LanguageManager
      projectId={id}
      businessName={project.business_name}
      initialSite={project.site}
    />
  );
}
