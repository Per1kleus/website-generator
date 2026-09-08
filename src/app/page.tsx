import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listProjects } from "@/server/projects";
import { AppShell } from "@/components/AppShell";
import { AppBar, Card, LinkButton } from "@/components/ui";
import { ProjectCard } from "@/components/ProjectCard";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = listProjects(user.id);
  const firstName = user.name.split(" ")[0];

  return (
    <AppShell>
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
          {/* Cards stack vertically on phones and become a grid only where
              there is genuine horizontal room — never a dense table. */}
          <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} />
              </li>
            ))}
          </ul>

          <Card className="mt-4 border-dashed text-center">
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
