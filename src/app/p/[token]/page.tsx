import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listResponses, resolvePreview } from "@/server/client-preview";
import { ClientPreviewScreen } from "@/components/ClientPreviewScreen";

/**
 * The client's whole view of the application.
 *
 * Outside the signed-in area on purpose: this page is reached by a link in an
 * email, by someone who has no account here and should not need one. What it
 * hands the browser is deliberately small — the business name, the languages
 * the site has, and whether this link has already been answered. No project
 * id, no version id, no user, no score, no internal path.
 *
 * `notFound()` covers a bad token, a withdrawn link and a deleted version
 * alike, so guessing tells the guesser nothing.
 */

export const metadata: Metadata = {
  title: "Website preview",
  // A preview link is private correspondence, not public content.
  robots: { index: false, follow: false },
};

export default async function ClientPreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = resolvePreview(token);
  if (!resolved) notFound();

  const { site } = resolved;
  // Only whether a decision was already made — never who made it or when, and
  // never anyone else's link.
  const answered = listResponses(resolved.preview.id)[0]?.kind ?? "";

  return (
    <ClientPreviewScreen
      token={token}
      businessName={site.meta.businessName}
      locales={[...site.meta.locales]}
      defaultLocale={site.meta.defaultLocale}
      alreadyAnswered={answered}
    />
  );
}

export const dynamic = "force-dynamic";
