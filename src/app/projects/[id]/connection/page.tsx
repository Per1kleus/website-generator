import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { googleConfigured } from "@/server/google/oauth";
import { googleAccess } from "@/server/google/credentials";
import { linkState, listEvents, listLinks } from "@/server/connect/links";
import { connectionView } from "@/server/connect/verify";
import { ConnectionPanel } from "@/components/ConnectionPanel";

export const metadata: Metadata = { title: "Client Google connection" };

export default async function ConnectionPage({
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
    <ConnectionPanel
      projectId={id}
      businessName={project.business_name}
      isMenuProject={project.site_kind === "menu"}
      initial={{
        configured: googleConfigured(),
        access: googleAccess(id, user.id),
        connection: connectionView(project),
        links: listLinks(id).map((link) => ({
          id: link.id,
          label: link.label,
          services: link.services,
          state: linkState(link),
          expires_at: link.expires_at,
          used_at: link.used_at,
          created_at: link.created_at,
        })),
        events: listEvents(id, 30),
      }}
    />
  );
}
