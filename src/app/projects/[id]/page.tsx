import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets, listVersions } from "@/server/projects";
import { qaCheck } from "@/server/jobs";
import { AppShell } from "@/components/AppShell";
import { AppBar, Banner, Card, LinkButton } from "@/components/ui";
import {
  IconDownload, IconEye, IconImage, IconLayers, IconPalette,
  IconPencil, IconRocket, IconSettings,
} from "@/components/icons";
import { SITE_KINDS } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const user = await getCurrentUser();
  if (!user) return { title: "Project" };
  const { id } = await params;
  return { title: getProject(id, user.id)?.business_name ?? "Project" };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(id, user.id);
  if (!project) notFound();

  if (project.status === "generating") redirect(`/projects/${id}/generate`);

  const kind = SITE_KINDS.find((k) => k.id === project.site_kind);
  const versions = listVersions(id);
  const assets = listAssets(id);
  const warnings = project.site ? qaCheck(project.site) : [];

  const actions = [
    { href: `/projects/${id}/preview`, label: "Preview", hint: "Mobile, tablet, desktop", Icon: IconEye },
    { href: `/projects/${id}/edit`, label: "Edit sections", hint: `${project.site?.sections.length ?? 0} sections`, Icon: IconPencil },
    { href: `/projects/${id}/design`, label: "Design", hint: "Colours, fonts, layout", Icon: IconPalette },
    { href: `/projects/${id}/media`, label: "Images", hint: `${assets.length} uploaded`, Icon: IconImage },
    { href: `/projects/${id}/versions`, label: "Versions", hint: `${versions.length} saved`, Icon: IconLayers },
    { href: `/projects/${id}/export`, label: "Export", hint: "Download a ZIP", Icon: IconDownload },
    { href: `/projects/${id}/deploy`, label: "Deploy", hint: "Publish it live", Icon: IconRocket },
    { href: `/projects/${id}/settings`, label: "Settings", hint: "Business details", Icon: IconSettings },
  ];

  return (
    <AppShell>
      <AppBar title={project.business_name} subtitle={kind?.label} back="/" />

      {project.status === "failed" && (
        <Banner tone="error">
          Generation did not finish.{" "}
          <Link href={`/projects/${id}/generate`} className="underline">
            Try again
          </Link>
          .
        </Banner>
      )}

      {!project.site && project.status !== "failed" && (
        <Card className="my-4 text-center">
          <p className="text-sm text-muted">
            This project has not been generated yet.
          </p>
          <LinkButton href={`/projects/${id}/generate`} size="lg" className="mt-3">
            Generate website
          </LinkButton>
        </Card>
      )}

      {project.site && (
        <>
          <LinkButton
            href={`/projects/${id}/preview`}
            size="lg"
            block
            className="my-4"
          >
            <IconEye size={20} /> Preview website
          </LinkButton>

          {warnings.length > 0 && (
            <Banner tone="warning">
              <span className="font-bold">
                {warnings.length} thing{warnings.length === 1 ? "" : "s"} to review
              </span>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-normal">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Banner>
          )}

          {/* Two-up on the narrowest phones is still comfortable at 44px+ tall,
              and gives the whole toolset in one thumb-reachable screen. */}
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {actions.map(({ href, label, hint, Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex min-h-[5.5rem] flex-col justify-between rounded-card border border-line bg-surface p-3.5 active:scale-[0.98]"
                >
                  <span className="text-brand">
                    <Icon size={22} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
