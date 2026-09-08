"use client";

import { useState } from "react";
import { Button, useToast } from "./ui";
import { IconCopy, IconDownload, IconExternal } from "./icons";

/**
 * Export from a phone (requirement 12).
 *
 * The download is a plain <a download> to a streaming endpoint, which hands
 * the ZIP to the phone's native download manager / share sheet. Where the Web
 * Share API can share files (iOS Safari, Android Chrome), we offer that too,
 * so the user can drop the ZIP straight into Mail, Drive or WhatsApp.
 */
export function ExportActions({
  projectId,
  businessName,
}: {
  projectId: string;
  businessName: string;
}) {
  const [sharing, setSharing] = useState(false);
  const { toast, toastNode } = useToast();
  const href = `/api/projects/${projectId}/export`;

  async function share() {
    setSharing(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const slug =
        businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "website";
      const file = new File([blob], `${slug}.zip`, { type: "application/zip" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: businessName });
        toast("Shared");
      } else {
        // No file sharing on this browser — fall back to a normal download.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        toast("Downloaded");
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") toast("Could not share the file");
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <div className="grid gap-2.5">
        {/* A real link, so long-press → "Download link" works natively. */}
        <a
          href={href}
          download
          className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-semibold text-on-brand active:scale-[0.98]"
        >
          <IconDownload size={20} /> Export ZIP
        </a>

        <Button variant="secondary" size="lg" block loading={sharing} onClick={share}>
          <IconCopy size={18} /> Share the file
        </Button>

        <a
          href={`/api/projects/${projectId}/render`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center gap-2 rounded-xl border border-line bg-surface px-6 text-base font-semibold active:scale-[0.98]"
        >
          <IconExternal size={18} /> Open the website
        </a>
      </div>
      {toastNode}
    </>
  );
}
