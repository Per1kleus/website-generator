import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listAssets, listProjects } from "@/server/projects";
import { getLatestDeployment } from "@/server/deploy";
import { assessReadiness } from "@/lib/checklist";
import { projectState } from "@/lib/project-status";
import { renderSite } from "@/lib/render";
import { AppShell } from "@/components/AppShell";
import { AppBar, Card, LinkButton } from "@/components/ui";
import { ProjectFilter } from "@/components/ProjectFilter";
import type { ProjectSummary } from "@/components/ProjectCard";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = listProjects(user.id);
  const firstName = user.name.split(" ")[0];

  // One readiness pass per project, computed here so the list shows the same
  // number the project screen does. Rendering and auditing are string work
  // over a document already in memory — no network, no model, no image decode.
  const summaries: Record<string, ProjectSummary> = {};
  for (const project of projects) {
    const deployment = getLatestDeployment(project.id);
    const readiness = project.site
      ? assessReadiness({
          site: project.site,
          locale: project.site.meta.defaultLocale,
          html: renderSite(project.site, { locale: project.site.meta.defaultLocale }),
          images: Object.fromEntries(
            listAssets(project.id).map((a) => [
              a.id,
              { width: a.width, height: a.height, bytes: a.bytes },
            ]),
          ),
        })
      : null;
    summaries[project.id] = {
      state: projectState({
        status: project.status,
        hasSite: Boolean(project.site),
        readiness,
        deploymentStatus: deployment?.status ?? null,
      }),
      score: readiness?.score ?? null,
      criticals: readiness?.issues.filter((i) => i.severity === "critical").length ?? 0,
      publishedUrl: deployment?.status === "live" ? deployment.url : null,
    };
  }

  return (
    <AppShell wide>
      <AppBar
        title="Projects"
        subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"}`}
        action={
          <LinkButton href="/projects/new" className="shrink-0">
            New
          </LinkButton>
        }
      />

      {projects.length === 0 ? (
        <div className="py-10 text-center">
          <div aria-hidden="true" className="mb-4 text-5xl">
            ✨
          </div>
          <h2 className="text-xl font-bold">Hi {firstName}</h2>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
            Create your first project. Enter a business, and a mobile-first
            website or digital menu is generated for you.
          </p>
          <LinkButton href="/projects/new" size="lg" className="mt-6">
            Create a project
          </LinkButton>
        </div>
      ) : (
        <>
          {/* Search, status chips, and a workspace grid: as many columns as
              the window genuinely has room for, down to one when narrow. */}
          <ProjectFilter projects={projects} summaries={summaries} />

          <Card className="mt-4 max-w-md border-dashed text-center">
            <p className="text-sm text-muted">Got another business?</p>
            <LinkButton href="/projects/new" variant="secondary" className="mt-3">
              Create a project
            </LinkButton>
          </Card>
        </>
      )}
    </AppShell>
  );
}
