import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets } from "@/server/projects";
import { SectionEditor } from "@/components/SectionEditor";

export const metadata: Metadata = { title: "Edit" };

export default async function EditPage({
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
    <SectionEditor
      projectId={id}
      businessName={project.business_name}
      initialSite={project.site}
      assets={listAssets(id).map((a) => ({ id: a.id, filename: a.filename, alt: a.alt }))}
    />
  );
}
