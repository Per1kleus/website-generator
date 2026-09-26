import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveLink } from "@/server/connect/links";
import { SERVICE_PURPOSE } from "@/server/connect/flow";
import { connectionView } from "@/server/connect/verify";
import { projectConnection } from "@/server/google/oauth";
import { ClientConnectScreen } from "@/components/ClientConnectScreen";

/**
 * The client's whole view of connecting their Google account.
 *
 * Outside the signed-in area, like the preview link: reached from an email by
 * someone who has no account here and should not need one. What the browser is
 * handed is deliberately small — the business name, the permissions being
 * asked for and what has been chosen so far. No project id, no user, no link
 * table, no internal path, and no token but the one already in the address bar.
 *
 * `notFound()` covers an unknown token, a withdrawn link, an expired link and a
 * deleted project alike, so guessing tells the guesser nothing.
 */

export const metadata: Metadata = {
  title: "Connect your Google account",
  // A connection link is private correspondence, not public content.
  robots: { index: false, follow: false },
};

export default async function ConnectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = resolveLink(token);
  if (!resolved) notFound();

  const { link, project } = resolved;
  const view = connectionView(project);

  return (
    <ClientConnectScreen
      token={token}
      businessName={project.business_name}
      asks={link.services.map((service) => ({ service, ...SERVICE_PURPOSE[service] }))}
      googleConnected={Boolean(projectConnection(project.id))}
      connectedEmail={view.email}
      status={view.status}
      services={view.services.filter((s) => link.services.includes(s.service))}
    />
  );
}

export const dynamic = "force-dynamic";
