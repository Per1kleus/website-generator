"use client";

import { AppShell } from "./AppShell";
import { AppBar, LinkButton } from "./ui";
import { SitePreview } from "./SitePreview";
import type { Locale } from "@/lib/locales";

/**
 * The full-screen preview.
 *
 * All of the work is in `SitePreview`, which is the same component the editor
 * panel, the project hub and the generation screen use — one preview, so the
 * device widths, the language switching and the failure handling cannot drift
 * apart between the places a creator meets them.
 *
 * This screen exists for the case where the site deserves the whole window:
 * it opens on Desktop, where the editor's cramped panel opens on Mobile.
 */
export function DevicePreview({
  projectId,
  businessName,
  locales,
  defaultLocale,
}: {
  projectId: string;
  businessName: string;
  locales: Locale[];
  defaultLocale: Locale;
}) {
  return (
    <AppShell wide>
      <AppBar title="Preview" subtitle={businessName} back={`/projects/${projectId}`} />

      <SitePreview
        projectId={projectId}
        businessName={businessName}
        locales={locales}
        defaultLocale={defaultLocale}
        initialDevice="desktop"
      />

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <LinkButton href={`/projects/${projectId}/edit`} size="lg" block className="sm:flex-1">
          Edit this website
        </LinkButton>
        <LinkButton
          href={`/projects/${projectId}/deploy`}
          variant="secondary"
          size="lg"
          block
          className="sm:flex-1"
        >
          Publish it
        </LinkButton>
      </div>
    </AppShell>
  );
}
