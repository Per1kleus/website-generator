import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { getProject, listAssets, listVersions } from "@/server/projects";
import { validateSite } from "@/server/validate";
import { architecture } from "@/lib/architectures";
import { localeInfo } from "@/lib/locales";
import { AppShell } from "@/components/AppShell";
import { DesignQuestions, type DesignQuestion } from "@/components/DesignQuestions";
import { MenuDataCard } from "@/components/MenuDataCard";
import { VisualQaCard } from "@/components/VisualQaCard";
import { SitePreview } from "@/components/SitePreview";
import { ReadinessCard } from "@/components/ReadinessCard";
import { ProjectOverview, type Figure } from "@/components/ProjectOverview";
import { getMenuSource } from "@/server/menu/source";
import { AppBar, Banner, Card, LinkButton } from "@/components/ui";
import {
  IconDownload, IconEye, IconGlobe, IconImage, IconLayers, IconPalette,
  IconPencil, IconRocket, IconSettings, IconSheet,
} from "@/components/icons";
import { SITE_KINDS } from "@/lib/site";
import { assessReadiness } from "@/lib/checklist";
import { projectState, stateInfo } from "@/lib/project-status";
import { renderSite } from "@/lib/render";
import { getLatestDeployment } from "@/server/deploy";

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
  const isMenuProject = project.site_kind === "menu";
  const menuSource = isMenuProject ? getMenuSource(id) : null;
  const assets = listAssets(id);
  const findings = project.site ? validateSite(project.site) : [];
  // Identity analysis may leave design decisions open; those become questions.
  const identity = project.designSystem as {
    questions?: DesignQuestion[];
    qa?: { applied?: { id: string; what: string }[] };
  } | null;
  // Assessed live rather than read from the generation record: the creator has
  // been editing since, and a stale verdict is worse than none. The readiness
  // report carries the visual QA audit inside it, so the page renders the site
  // once and audits it once.
  const imageSizes = Object.fromEntries(
    assets.map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]),
  );
  const readiness = project.site
    ? assessReadiness({
        site: project.site,
        locale: project.site.meta.defaultLocale,
        html: renderSite(project.site, { locale: project.site.meta.defaultLocale }),
        images: imageSizes,
      })
    : null;
  const qa = readiness?.qa ?? null;
  const deployment = getLatestDeployment(id);
  const state = stateInfo(
    projectState({
      status: project.status,
      hasSite: Boolean(project.site),
      readiness,
      deploymentStatus: deployment?.status ?? null,
    }),
  );
  const questions = (identity?.questions ?? []).filter((q) => q?.question && q.options?.length);
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");

  const actions = [
    { href: `/projects/${id}/preview`, label: "Preview", hint: "Mobile, tablet, desktop", Icon: IconEye },
    { href: `/projects/${id}/edit`, label: "Edit sections", hint: `${project.site?.sections.length ?? 0} sections`, Icon: IconPencil },
    { href: `/projects/${id}/design`, label: "Design", hint: project.site ? architecture(project.site.theme.architecture).label : "Colours, fonts", Icon: IconPalette },
    { href: `/projects/${id}/media`, label: "Images", hint: `${assets.length} uploaded`, Icon: IconImage },
    ...(isMenuProject
      ? [{
          href: `/projects/${id}/menu-data`,
          label: "Menu data",
          hint: menuSource?.spreadsheet_id ? "Google Sheets" : "Not connected",
          Icon: IconSheet,
        }]
      : []),
    { href: `/projects/${id}/languages`, label: "Languages", hint: project.site ? project.site.meta.locales.map((l) => localeInfo(l).short).join(" · ") : "—", Icon: IconGlobe },
    { href: `/projects/${id}/versions`, label: "Versions", hint: `${versions.length} saved`, Icon: IconLayers },
    { href: `/projects/${id}/export`, label: "Export", hint: "Download a ZIP", Icon: IconDownload },
    { href: `/projects/${id}/deploy`, label: "Deploy", hint: "Publish it live", Icon: IconRocket },
    { href: `/projects/${id}/settings`, label: "Settings", hint: "Business details", Icon: IconSettings },
  ];

  // Each figure is read from the system that owns it, never recomputed here.
  const seoIssues = readiness?.categories.find((c) => c.id === "seo");
  const figures: Figure[] = readiness
    ? [
        {
          label: "Readiness",
          value: `${readiness.score}/100`,
          tone: readiness.status === "READY" ? "good" : readiness.status === "NOT READY" ? "bad" : "warn",
        },
        {
          label: "Layout QA",
          value: `${readiness.qa.score}/100`,
          tone: readiness.qa.score >= 90 ? "good" : readiness.qa.score >= 70 ? "warn" : "bad",
        },
        {
          label: "SEO",
          value: seoIssues?.verdict === "PASS" ? "Passed" : `${seoIssues?.score ?? 0}/15`,
          tone: seoIssues?.verdict === "PASS" ? "good" : seoIssues?.verdict === "FAIL" ? "bad" : "warn",
        },
        {
          label: "Performance",
          value: `${readiness.performance.score}/100`,
          tone:
            readiness.performance.score >= 90
              ? "good"
              : readiness.performance.score >= 70
                ? "warn"
                : "bad",
        },
      ]
    : [];

  return (
    <AppShell>
      <AppBar title={project.business_name} subtitle={kind?.label} back="/" />

      {project.site && (
        <ProjectOverview
          state={state}
          figures={figures}
          updatedAt={project.updated_at}
          publishedUrl={deployment?.status === "live" ? deployment.url : null}
        />
      )}

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
          {/* The website itself, not a button that leads to it. Someone
              arriving here should see what they made. */}
          <section className="my-4" aria-label="Live preview">
            <SitePreview
              projectId={id}
              businessName={project.business_name}
              locales={project.site.meta.locales}
              defaultLocale={project.site.meta.defaultLocale}
              initialDevice="desktop"
            />
          </section>

          <LinkButton
            href={`/projects/${id}/preview`}
            variant="secondary"
            size="lg"
            block
            className="mb-4"
          >
            <IconEye size={20} /> Open full-screen preview
          </LinkButton>

          {isMenuProject && <MenuDataCard projectId={id} source={menuSource} />}

          <DesignQuestions projectId={id} questions={questions} />

          {readiness && <ReadinessCard report={readiness} projectId={id} />}

          {qa && <VisualQaCard report={qa} corrections={identity?.qa?.applied ?? []} />}

          {errors.length > 0 && (
            <Banner tone="error">
              <span className="font-bold">
                {errors.length} thing{errors.length === 1 ? "" : "s"} need fixing
              </span>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-normal">
                {errors.map((f) => <li key={f.message}>{f.message}</li>)}
              </ul>
            </Banner>
          )}

          {warnings.length > 0 && (
            <Banner tone="warning">
              <span className="font-bold">
                {warnings.length} thing{warnings.length === 1 ? "" : "s"} to review
              </span>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-normal">
                {warnings.slice(0, 6).map((f) => <li key={f.message}>{f.message}</li>)}
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
