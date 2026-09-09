import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listProjects } from "@/server/projects";
import { AppShell } from "@/components/AppShell";
import { AppBar, Card } from "@/components/ui";
import { AccountActions } from "@/components/AccountActions";
import { DesignEngineCard } from "@/components/DesignEngineCard";

export const metadata: Metadata = { title: "Profile" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const projects = listProjects(user.id);
  const live = projects.filter((p) => p.status === "ready").length;

  return (
    <AppShell>
      <AppBar title="Profile" />

      <Card className="my-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-soft text-lg font-bold text-brand"
          >
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">{user.name}</p>
            <p className="truncate text-sm text-muted">{user.email}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5">
        <Card className="text-center">
          <p className="text-2xl font-bold tabular-nums">{projects.length}</p>
          <p className="text-xs text-muted">Projects</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold tabular-nums">{live}</p>
          <p className="text-xs text-muted">Websites ready</p>
        </Card>
      </div>

      <DesignEngineCard />

      <AccountActions />

      <Card className="mt-4">
        <h2 className="font-bold">Install on your phone</h2>
        <p className="mt-1.5 text-sm text-muted">
          Add this app to your home screen for a full-screen, app-like
          experience. On iPhone use Share → Add to Home Screen; on Android use
          the browser menu → Install app. Everything works in the browser too —
          installing is optional.
        </p>
      </Card>
    </AppShell>
  );
}
