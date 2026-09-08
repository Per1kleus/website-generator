import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { DevicePreview } from "@/components/DevicePreview";

export const metadata: Metadata = { title: "Preview" };

export default async function PreviewPage({
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

  return <DevicePreview projectId={id} businessName={project.business_name} />;
}
