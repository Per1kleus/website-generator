"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  IconClose, IconDownload, IconEye, IconGlobe, IconImage, IconLayers, IconMenu,
  IconPalette, IconPencil, IconPlus, IconProjects, IconRocket, IconSettings,
  IconSheet, IconUser,
} from "./icons";

/**
 * The desktop workspace.
 *
 * This is a Windows application, so navigation is a persistent sidebar: every
 * destination visible at once, the project's own screens listed beneath the
 * application's, and the whole width of the window given to the work. There is
 * no bottom tab bar — that is a phone pattern, and on a desktop it wastes the
 * one edge a mouse reaches least.
 *
 * The sidebar still collapses into a drawer on a narrow window, because a
 * resized window should stay usable. That is responsiveness, not a phone
 * layout: the desktop arrangement is the design, and the narrow one is the
 * fallback.
 *
 * Generated customer websites are untouched by any of this. They stay
 * mobile-first and responsive; this file is the builder's own chrome.
 */

const APP_LINKS = [
  { href: "/", label: "Projects", icon: IconProjects, match: (p: string) => p === "/" },
  {
    href: "/projects/new",
    label: "New project",
    icon: IconPlus,
    match: (p: string) => p.startsWith("/projects/new"),
  },
  { href: "/account", label: "Profile", icon: IconUser, match: (p: string) => p.startsWith("/account") },
];

/** The screens of one project, in the order the work actually happens. */
const PROJECT_LINKS = [
  { slug: "", label: "Overview", icon: IconLayers },
  { slug: "preview", label: "Preview", icon: IconEye },
  { slug: "edit", label: "Content", icon: IconPencil },
  { slug: "design", label: "Design", icon: IconPalette },
  { slug: "media", label: "Media", icon: IconImage },
  { slug: "menu-data", label: "Menu data", icon: IconSheet, menuOnly: true },
  { slug: "languages", label: "Languages", icon: IconGlobe },
  { slug: "versions", label: "Versions", icon: IconLayers },
  { slug: "export", label: "Export", icon: IconDownload },
  { slug: "deploy", label: "Publish", icon: IconRocket },
  { slug: "settings", label: "Settings", icon: IconSettings },
];

function projectIdFrom(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  if (!match || match[1] === "new") return null;
  return match[1];
}

const linkClass = (active: boolean) =>
  `flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${
    active ? "bg-brand-soft text-brand" : "text-muted hover:bg-elevated hover:text-ink"
  }`;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const projectId = projectIdFrom(pathname);
  const [project, setProject] = useState<{ name: string; kind: string } | null>(null);

  // The project's name and kind decide the heading and whether the menu screen
  // belongs in the list. One small request per project, not per screen.
  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${projectId}/status`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.name) setProject({ name: data.name, kind: data.kind ?? "website" });
      })
      .catch(() => {
        /* the sidebar still works without the label */
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <Link
        href="/"
        onClick={onNavigate}
        className="mb-4 flex items-center gap-2 px-2.5 py-1.5 text-sm font-bold"
      >
        <span aria-hidden="true">🛠️</span> Website Generator
      </Link>

      {APP_LINKS.map((link) => {
        const Icon = link.icon;
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            <Icon size={17} />
            {link.label}
          </Link>
        );
      })}

      {projectId && (
        <>
          <p className="mt-5 truncate px-2.5 pb-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
            {project?.name ?? "Project"}
          </p>
          {PROJECT_LINKS.filter((link) => !link.menuOnly || project?.kind === "menu").map((link) => {
            const href = link.slug ? `/projects/${projectId}/${link.slug}` : `/projects/${projectId}`;
            const active = link.slug
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === href;
            const Icon = link.icon;
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={linkClass(active)}
              >
                <Icon size={17} />
                {link.label}
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  return (
    <nav
      aria-label="Main"
      className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-56 lg:border-r lg:border-line lg:bg-surface"
    >
      <SidebarContent />
    </nav>
  );
}

/** The same navigation as a drawer, for a window too narrow for a sidebar. */
function NavDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A drawer that survives navigation would cover the page it just opened.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <div className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-line bg-surface px-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-elevated"
        >
          <IconMenu size={20} />
        </button>
        <span className="text-sm font-bold">Website Generator</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-[80]">
          <div
            className="absolute inset-0 bg-black/45"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="Main"
            className="relative h-full w-64 max-w-[85vw] border-r border-line bg-surface"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-elevated"
            >
              <IconClose size={18} />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </div>
  );
}

/**
 * Page wrapper.
 *
 * `wide` gives a screen the whole workspace — the editor and the preview use
 * it. Everything else keeps a comfortable reading measure, because a settings
 * form stretched across 1400px is harder to use, not easier.
 */
export function AppShell({
  children,
  nav = true,
  wide = false,
}: {
  children: React.ReactNode;
  nav?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`min-h-[100svh] ${nav ? "lg:pl-56" : ""}`}>
      {nav && <Sidebar />}
      {nav && <NavDrawer />}
      <main
        id="main"
        className={`w-full safe-x pb-10 ${wide ? "" : "mx-auto max-w-4xl"}`}
      >
        {children}
      </main>
    </div>
  );
}
