import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { BackupPanel } from "@/components/BackupPanel";

export const metadata: Metadata = { title: "Backup" };

export default async function BackupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();

  return <BackupPanel projectId={id} businessName={project.business_name} />;
}
