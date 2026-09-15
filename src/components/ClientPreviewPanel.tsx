"use client";

import { useState } from "react";
import { LocalTime } from "./LocalTime";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, useToast } from "./ui";
import { IconCheck, IconCopy, IconExternal } from "./icons";

/**
 * The creator's side of client preview.
 *
 * The thing this screen exists to make obvious is which version a client
 * actually saw. An approval that silently carried forward onto later edits
 * would be worse than no approval at all — so every link says the version it
 * shows, every response says the version it answered, and a link made after
 * more editing is plainly a different link.
 */

export type PreviewRow = {
  id: string;
  version_id: string;
  versionNumber: number;
  label: string;
  revoked: number;
  created_at: number;
  responses: {
    id: string;
    kind: string;
    message: string;
    resolved: number;
    created_at: number;
  }[];
};

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const when = (ts: number) => <LocalTime ts={ts} options={WHEN} />;

export function ClientPreviewPanel({
  projectId,
  businessName,
  initialPreviews,
  currentVersion,
}: {
  projectId: string;
  businessName: string;
  initialPreviews: PreviewRow[];
  /** The version the project is on now, to show when a link has gone stale. */
  currentVersion: number;
}) {
  const [previews, setPreviews] = useState<PreviewRow[]>(initialPreviews);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { toast, toastNode } = useToast();

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const linkFor = (id: string) => `${origin}/p/${id}`;

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/client-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return null;
      }
      if (data.previews) setPreviews(data.previews as PreviewRow[]);
      return data;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(linkFor(id));
      toast("Link copied");
    } catch {
      toast("Could not copy — long-press the link instead");
    }
  }

  const live = previews.filter((p) => !p.revoked);

  return (
    <AppShell>
      <AppBar title="Client preview" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      <Card className="my-4">
        <h2 className="font-bold">Send the website to your client</h2>
        <p className="mt-1.5 text-sm text-muted">
          They get a link to the website as it is now, with nothing else on the
          page — no editor, no scores, no sign-in. They can approve it or tell
          you what to change.
        </p>
        <p className="mt-2 text-sm text-muted">
          The link is fixed to today&rsquo;s version. If you keep working
          afterwards, their approval still refers to what they saw, and you can
          send a fresh link when you want it looked at again.
        </p>
        <Button
          size="lg"
          block
          className="mt-3"
          loading={busy === "create"}
          onClick={() => post({ action: "create" }, "create")}
          data-create-preview
        >
          Create a client link
        </Button>
      </Card>

      {live.length === 0 && previews.length === 0 && (
        <p className="my-6 text-center text-sm text-muted">No client links yet.</p>
      )}

      {previews.map((preview) => {
        const approved = preview.responses.find((r) => r.kind === "approved");
        const notes = preview.responses.filter((r) => r.kind === "changes");
        const stale = preview.versionNumber > 0 && preview.versionNumber < currentVersion;

        return (
          <Card key={preview.id} className="my-3" >
            <div
              className="flex items-baseline justify-between gap-3"
              data-preview-row
              data-preview-version={preview.versionNumber}
            >
              <p className="font-bold">
                Version {preview.versionNumber || "?"}
                {preview.revoked ? (
                  <span className="ml-2 text-xs font-normal text-muted">withdrawn</span>
                ) : stale ? (
                  <span className="ml-2 text-xs font-normal text-warning">
                    older than your current work
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted">{when(preview.created_at)}</p>
            </div>

            {!preview.revoked && (
              <>
                <p className="mt-2 break-all rounded-lg bg-elevated p-2.5 text-xs" data-preview-link>
                  {linkFor(preview.id)}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => copy(preview.id)} data-copy-preview>
                    <IconCopy size={16} /> Copy link
                  </Button>
                  <a
                    href={linkFor(preview.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[var(--spacing-touch)] items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-elevated"
                  >
                    <IconExternal size={16} /> Open
                  </a>
                  <Button
                    variant="secondary"
                    loading={busy === `revoke-${preview.id}`}
                    onClick={() => post({ action: "revoke", previewId: preview.id }, `revoke-${preview.id}`)}
                  >
                    Withdraw
                  </Button>
                </div>
              </>
            )}

            {approved && (
              <p
                className="mt-3 flex items-center gap-2 text-sm font-semibold text-success"
                data-preview-approved={preview.versionNumber}
              >
                <IconCheck size={16} />
                Approved by client · version {preview.versionNumber} · {when(approved.created_at)}
              </p>
            )}

            {notes.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-line pt-3">
                {notes.map((note) => (
                  <li key={note.id} data-preview-note data-resolved={String(Boolean(note.resolved))}>
                    <p className={`text-sm ${note.resolved ? "text-muted line-through" : ""}`}>
                      “{note.message}”
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      <span className="text-xs text-muted">
                        {note.resolved ? "Resolved" : "Open"} · {when(note.created_at)}
                      </span>
                      {!note.resolved && (
                        <button
                          type="button"
                          onClick={() => post({ action: "resolve", responseId: note.id }, `resolve-${note.id}`)}
                          className="text-xs font-semibold text-brand underline-offset-2 hover:underline"
                          data-resolve-note
                        >
                          Mark resolved
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      {toastNode}
    </AppShell>
  );
}
