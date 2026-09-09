import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { connectionInfo, googleConfigured } from "@/server/google/oauth";
import { getMenuSource } from "@/server/menu/source";
import { MenuDataManager } from "@/components/MenuDataManager";

export const metadata: Metadata = { title: "Digital Menu Data" };

export default async function MenuDataPage({
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
    <MenuDataManager
      projectId={id}
      businessName={project.business_name}
      initialSource={getMenuSource(id)}
      initialGoogle={{ ...connectionInfo(user.id), configured: googleConfigured() }}
    />
  );
}
