import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus } from "@/server/google/oauth";
import { AppShell } from "@/components/AppShell";
import { AppBar, Card } from "@/components/ui";
import { GoogleConnection } from "@/components/GoogleConnection";

export const metadata: Metadata = { title: "Google connections" };

/**
 * Google, in one place.
 *
 * The connection belongs to the person rather than to any one project, so it
 * gets a screen of its own instead of living inside the Digital Menu builder.
 * The status is read on the server, so the screen arrives already knowing the
 * answer rather than flashing "checking…" on every visit.
 */
export default async function GoogleConnectionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const status = connectionStatus(user.id);

  return (
    <AppShell>
      <AppBar title="Google connections" back="/account" />

      <Suspense fallback={null}>
        <GoogleConnection returnTo="/account/google" initial={status} />
      </Suspense>

      <Card>
        <h2 className="font-bold">What this is for</h2>
        <p className="mt-1.5 text-sm text-muted">
          A digital menu can be built from a Google Sheet you already keep: one
          row per dish, with prices and photographs. Connecting an account lets
          the app read that sheet and the Drive images it points at.
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing is written back. No other file is touched. Your access is
          stored encrypted on this computer and never leaves it, and you can
          disconnect at any time — the websites you have already generated are
          unaffected.
        </p>
      </Card>
    </AppShell>
  );
}
