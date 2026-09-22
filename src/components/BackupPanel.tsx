"use client";

import { useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, useToast } from "./ui";
import { IconCheck, IconDownload } from "./icons";
import { LocalTime } from "./LocalTime";

/**
 * Backing a project up, and putting one back.
 *
 * The whole screen is built around one idea: a person doing this is either
 * being careful or is already in trouble, and in both cases what they need is
 * to be told the truth about what is in the file. So the export says exactly
 * what it contains before it is downloaded, and the restore checks the file
 * and shows every check by name before anything is written.
 *
 * Nothing here can overwrite a project. Restoring always produces a new one,
 * which is why the button says so.
 */

type Contents = {
  versions: number;
  assets: number;
  previews: number;
  published: boolean;
  repository: string;
  customDomain: string;
};

type Preview = {
  filename: string;
  size: number;
  backupVersion: number;
  createdAt: number;
  integrity: { fileCount: number; assetBytes: number; assetCount: number; versionCount: number; checksum: string };
  contents: Contents;
};

type RestoreCheck = { label: string; ok: boolean; detail: string };
type RestoreReport = {
  ok: boolean;
  checks: RestoreCheck[];
  summary: {
    businessName: string;
    backupVersion: number;
    createdAt: number;
    versionCount: number;
    assetCount: number;
    previewCount: number;
    publishedUrl: string;
    repository: string;
    customDomain: string;
  } | null;
  reconnect: { service: string; why: string }[];
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupPanel({
  projectId,
  businessName,
}: {
  projectId: string;
  businessName: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  const [restored, setRestored] = useState<{ projectId: string; notes: string[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const { toast, toastNode } = useToast();

  async function describe() {
    setBusy("describe");
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/backup`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "The backup could not be prepared.");
        return;
      }
      setPreview(data as Preview);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function inspect(file: File) {
    setBusy("inspect");
    setError("");
    setReport(null);
    setRestored(null);
    try {
      const body = new FormData();
      body.append("backup", file);
      const res = await fetch("/api/backups/restore?inspect=1", { method: "POST", body });
      const data = await res.json();
      if (data.report) setReport(data.report as RestoreReport);
      else setError(data.error ?? "That file could not be read.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function restore() {
    if (!chosen) return;
    setBusy("restore");
    setError("");
    try {
      const body = new FormData();
      body.append("backup", chosen);
      const res = await fetch("/api/backups/restore", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "The backup could not be restored.");
        return;
      }
      setRestored({ projectId: data.projectId, notes: data.notes ?? [] });
      toast("Restored as a new project");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell>
      <AppBar title="Backup" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      {/* ------------------------------------------------------- export */}
      <Card className="my-4" data-backup-export>
        <p className="font-bold">Export a backup</p>
        <p className="mt-1 text-sm text-muted">
          One file containing this project, its website, its full version
          history and every image. Keep it somewhere other than this computer —
          that is the copy that survives losing this one.
        </p>

        {preview && (
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm" data-backup-preview>
            <div className="flex gap-2">
              <dt className="text-muted">Project</dt>
              <dd className="flex-1 text-right font-medium">{businessName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Backup format</dt>
              <dd className="flex-1 text-right font-medium">version {preview.backupVersion}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Prepared</dt>
              <dd className="flex-1 text-right font-medium">
                <LocalTime ts={preview.createdAt} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Size</dt>
              <dd className="flex-1 text-right font-medium" data-backup-size>{size(preview.size)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Contents</dt>
              <dd className="flex-1 text-right font-medium">
                {preview.contents.versions} version{preview.contents.versions === 1 ? "" : "s"},{" "}
                {preview.contents.assets} image{preview.contents.assets === 1 ? "" : "s"}
              </dd>
            </div>
            {preview.contents.repository && (
              <div className="flex gap-2">
                <dt className="text-muted">Repository recorded</dt>
                <dd className="flex-1 break-all text-right font-medium">
                  {preview.contents.repository}
                </dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-muted">Integrity</dt>
              <dd className="flex-1 text-right font-medium text-success" data-backup-integrity>
                <IconCheck size={14} /> checksummed, {preview.integrity.assetCount} image
                {preview.integrity.assetCount === 1 ? "" : "s"} digested
              </dd>
            </div>
          </dl>
        )}

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Button
            variant="secondary"
            size="lg"
            block
            loading={busy === "describe"}
            onClick={describe}
            data-backup-describe
          >
            What is in it?
          </Button>
          <a
            href={`/api/projects/${projectId}/backup`}
            className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.98]"
            data-backup-download
          >
            <IconDownload size={18} /> Export backup
          </a>
        </div>

        <p className="mt-3 text-xs text-muted">
          A backup never contains passwords, API keys or the tokens that
          connect GitHub and Google. A restored project asks for those to be
          connected again — a file that could re-open somebody&apos;s GitHub
          account is not something to keep on a memory stick.
        </p>
      </Card>

      {/* ------------------------------------------------------ restore */}
      <Card className="my-4" data-backup-restore>
        <p className="font-bold">Restore a backup</p>
        <p className="mt-1 text-sm text-muted">
          Reads a backup file and puts it back as a <strong>new</strong>{" "}
          project. Nothing that is already here is changed or replaced.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          data-backup-file
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setChosen(file);
            if (file) void inspect(file);
          }}
        />

        <Button
          variant="secondary"
          size="lg"
          block
          className="mt-3"
          loading={busy === "inspect"}
          onClick={() => fileInput.current?.click()}
          data-backup-choose
        >
          Choose a backup file
        </Button>

        {report && (
          <div className="mt-3 border-t border-line pt-3" data-restore-report>
            {report.summary && (
              <p className="text-sm font-semibold" data-restore-name>
                {report.summary.businessName} —{" "}
                <LocalTime ts={report.summary.createdAt} options={{ day: "numeric", month: "short", year: "numeric" }} />
              </p>
            )}

            <ul className="mt-2 space-y-1">
              {report.checks.map((check) => (
                <li
                  key={check.label}
                  className="flex gap-2 text-sm"
                  data-restore-check={check.label.toLowerCase().replace(/\s+/g, "-")}
                  data-ok={String(check.ok)}
                >
                  <span className={check.ok ? "text-success" : "text-danger"}>
                    {check.ok ? "✓" : "✕"}
                  </span>
                  <span className={check.ok ? "" : "font-semibold text-danger"}>
                    {check.label}
                    {check.detail ? <span className="text-muted"> — {check.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>

            {report.ok && report.reconnect.length > 0 && (
              <div className="mt-3 rounded-xl border border-warning/40 p-3" data-restore-reconnect>
                <p className="text-sm font-semibold text-warning">Reconnection required</p>
                <ul className="mt-1 space-y-1.5">
                  {report.reconnect.map((r) => (
                    <li key={r.service} className="text-xs text-muted">
                      <span className="font-semibold text-fg">{r.service}</span> — {r.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.ok && !restored && (
              <Button
                size="lg"
                block
                className="mt-3"
                loading={busy === "restore"}
                onClick={restore}
                data-restore-confirm
              >
                Restore as a new project
              </Button>
            )}

            {!report.ok && (
              <p className="mt-3 text-sm text-danger" data-restore-refused>
                This backup was not restored. Nothing has been changed.
              </p>
            )}
          </div>
        )}

        {restored && (
          <div className="mt-3 rounded-xl border border-success/40 p-3" data-restore-done>
            <p className="text-sm font-semibold text-success">
              <IconCheck size={14} /> Restored as a new project
            </p>
            <ul className="mt-2 space-y-1">
              {restored.notes.map((note) => (
                <li key={note} className="text-xs text-muted">
                  {note}
                </li>
              ))}
            </ul>
            <a
              href={`/projects/${restored.projectId}`}
              className="mt-3 inline-flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center rounded-xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.98]"
              data-restore-open
            >
              Open the restored project
            </a>
          </div>
        )}
      </Card>

      {toastNode}
    </AppShell>
  );
}
