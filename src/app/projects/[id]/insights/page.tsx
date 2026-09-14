import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { connectionStatus } from "@/server/google/oauth";
import { getProperty } from "@/server/google/insights";
import { InsightsPanel } from "@/components/InsightsPanel";

export const metadata: Metadata = { title: "Analytics" };

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();

  const google = connectionStatus(user.id);

  return (
    <InsightsPanel
      projectId={id}
      businessName={project.business_name}
      initial={{
        // Only the three booleans the screen needs. The email, the scopes and
        // anything else on the connection stay on the server.
        google: {
          connected: google.connected,
          analytics: google.analytics,
          searchConsole: google.searchConsole,
        },
        analytics: getProperty(id, "analytics"),
        searchConsole: getProperty(id, "searchConsole"),
      }}
      consentAcknowledged={Boolean(project.site?.meta.analytics?.consentAcknowledged)}
    />
  );
}
