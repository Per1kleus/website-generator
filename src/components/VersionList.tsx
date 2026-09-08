"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, BottomSheet, Button, Card, Field, TextInput, useToast } from "./ui";
import { IconLayers, IconTrash } from "./icons";
import type { Version } from "@/server/projects";

/**
 * Project versions (requirement 12 / "manage project versions").
 * Save a snapshot, restore one, or remove it — all from a phone, with
 * confirmation for the two destructive actions.
 */
export function VersionList({
  projectId,
  businessName,
  initialVersions,
}: {
  projectId: string;
  businessName: string;
  initialVersions: Version[];
}) {
  const router = useRouter();
  const [versions, setVersions] = useState(initialVersions);
  const [saveOpen, setSaveOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<{ action: "restore" | "delete"; version: Version } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, toastNode } = useToast();

  async function refresh() {
    const res = await fetch(`/api/projects/${projectId}/versions`);
    if (res.ok) setVersions((await res.json()).versions as Version[]);
  }

  async function post(body: Record<string, string>, message: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      await refresh();
      toast(message);
      return true;
    } catch {
      setError("Could not reach the server. Check your connection.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <AppBar title="Versions" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      <Button size="lg" block className="my-4" onClick={() => setSaveOpen(true)}>
        <IconLayers size={20} /> Save current version
      </Button>

      {versions.length === 0 ? (
        <Card className="border-dashed text-center">
          <p className="text-sm text-muted">No saved versions yet.</p>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {versions.map((v) => (
            <li key={v.id}>
              <Card>
                <p className="font-semibold">{v.label}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(v.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => setConfirm({ action: "restore", version: v })}
                  >
                    Restore
                  </Button>
                  <a
                    href={`/api/projects/${projectId}/render?version=${v.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold active:bg-elevated"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    onClick={() => setConfirm({ action: "delete", version: v })}
                    aria-label={`Delete version ${v.label}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elevated"
                  >
                    <IconTrash size={18} />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this version"
        footer={
          <Button
            size="lg"
            block
            loading={busy}
            onClick={async () => {
              if (await post({ label }, "Version saved")) {
                setLabel("");
                setSaveOpen(false);
              }
            }}
          >
            Save version
          </Button>
        }
      >
        <Field label="Name it" hint="Something you will recognise later.">
          {({ id }) => (
            <TextInput
              id={id}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Before the summer menu"
              autoCapitalize="sentences"
              enterKeyHint="done"
            />
          )}
        </Field>
      </BottomSheet>

      <BottomSheet
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.action === "restore" ? "Restore this version?" : "Delete this version?"}
        footer={
          <div className="flex gap-2.5">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm?.action === "delete" ? "danger" : "primary"}
              size="lg"
              className="flex-1"
              loading={busy}
              onClick={async () => {
                if (!confirm) return;
                const ok = await post(
                  { action: confirm.action, versionId: confirm.version.id },
                  confirm.action === "restore" ? "Version restored" : "Version deleted",
                );
                setConfirm(null);
                if (ok && confirm.action === "restore") router.refresh();
              }}
            >
              {confirm?.action === "restore" ? "Restore" : "Delete"}
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-sm text-muted">
          {confirm?.action === "restore"
            ? `Your current website will be saved first, so you can undo this.`
            : `“${confirm?.version.label}” will be removed permanently.`}
        </p>
      </BottomSheet>

      {toastNode}
    </AppShell>
  );
}
