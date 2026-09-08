"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconPlus, IconProjects, IconUser } from "./icons";

/**
 * The mobile navigation system (requirement 2).
 *
 * Phones get a bottom tab bar sitting above the home indicator; large screens
 * get a persistent left rail instead. These are two different navigations, not
 * one navigation squeezed — a desktop sidebar is never shown on a phone.
 */

const TABS = [
  { href: "/", label: "Projects", icon: IconProjects, match: (p: string) => p === "/" },
  {
    href: "/projects/new",
    label: "Create",
    icon: IconPlus,
    match: (p: string) => p.startsWith("/projects/new"),
  },
  { href: "/account", label: "Profile", icon: IconUser, match: (p: string) => p.startsWith("/account") },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-lg md:hidden"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[var(--spacing-touch-lg)] flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] font-semibold transition-colors ${
                  active ? "text-brand" : "text-muted"
                }`}
              >
                <Icon size={22} />
                <span>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col md:gap-1 md:border-r md:border-line md:bg-surface md:p-4"
    >
      <Link href="/" className="mb-6 flex items-center gap-2 px-2 py-2 text-base font-bold">
        <span aria-hidden="true">🛠️</span> Website Generator
      </Link>
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[var(--spacing-touch)] items-center gap-3 rounded-xl px-3 text-sm font-semibold ${
              active
                ? "bg-brand-soft text-brand"
                : "text-muted hover:bg-elevated"
            }`}
          >
            <Icon size={20} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Page wrapper. `pad` adds room for the bottom nav so the last row of content
 * is never trapped under it — a classic mobile bug.
 */
export function AppShell({
  children,
  nav = true,
}: {
  children: React.ReactNode;
  nav?: boolean;
}) {
  return (
    <div className="min-h-[100svh] md:pl-60">
      {nav && <SideRail />}
      <main
        id="main"
        className="mx-auto w-full max-w-3xl safe-x pb-[calc(var(--bottomnav-h)+var(--safe-bottom)+1.5rem)] md:pb-10 lg:max-w-5xl"
      >
        {children}
      </main>
      {nav && <BottomNav />}
    </div>
  );
}
