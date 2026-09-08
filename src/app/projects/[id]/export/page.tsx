import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject } from "@/server/projects";
import { AppShell } from "@/components/AppShell";
import { AppBar, Card } from "@/components/ui";
import { ExportActions } from "@/components/ExportActions";

export const metadata: Metadata = { title: "Export" };

export default async function ExportPage({
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
    <AppShell>
      <AppBar title="Export" subtitle={project.business_name} back={`/projects/${id}`} />

      <Card className="my-4">
        <h2 className="font-bold">Download as a ZIP</h2>
        <p className="mt-1.5 text-sm text-muted">
          A complete, self-contained website: one HTML file plus your images.
          It works offline and can be uploaded to any static host.
        </p>
      </Card>

      <ExportActions projectId={id} businessName={project.business_name} />

      <Card className="mt-4">
        <h2 className="font-bold">What is in the file</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li><code>index.html</code> — the whole site, styles included</li>
          <li><code>images/</code> — your uploaded photos, already optimised</li>
          <li><code>robots.txt</code> and a short <code>README.md</code></li>
        </ul>
      </Card>
    </AppShell>
  );
}
