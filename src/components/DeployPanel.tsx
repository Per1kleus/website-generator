"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, Field, Select, TextInput, useToast } from "./ui";
import { IconCheck, IconCopy, IconExternal, IconRocket } from "./icons";
import type { Deployment, DeployPlatform } from "@/server/deploy";

/**
 * Deployment from a phone (requirement 13).
 *
 * The status is polled from the backend for the same reason generation is: a
 * deploy started at a table should survive the phone locking. Stages are shown
 * as a plain vertical list, and the finished state gives exactly the two
 * actions the requirement asks for — Open website and Copy URL.
 */

const STAGES: { key: Deployment["status"]; label: string }[] = [
  { key: "preparing", label: "Preparing" },
  { key: "building", label: "Building" },
  { key: "deploying", label: "Deploying" },
  { key: "live", label: "Live" },
];

export function DeployPanel({
  projectId,
  businessName,
  defaultSlug,
  initialDeployment,
  available,
}: {
  projectId: string;
  businessName: string;
  defaultSlug: string;
  initialDeployment: Deployment | null;
  available: Record<DeployPlatform, boolean>;
}) {
  const [platform, setPlatform] = useState<DeployPlatform>("builtin");
  const [slug, setSlug] = useState(initialDeployment?.slug ?? defaultSlug);
  const [deployment, setDeployment] = useState<Deployment | null>(initialDeployment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast, toastNode } = useToast();

  const running =
    deployment != null && !["live", "failed"].includes(deployment.status);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setDeployment(data.deployment as Deployment | null);
    } catch {
      /* transient offline: keep the last known state and retry on next tick */
    }
  }, [projectId]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 1200);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, refresh]);

  async function deploy() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start the deployment.");
        return;
      }
      setDeployment(data.deployment as Deployment);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!deployment?.url) return;
    try {
      await navigator.clipboard.writeText(deployment.url);
      toast("Link copied");
    } catch {
      toast("Could not copy — long-press the link instead");
    }
  }

  const stageIndex = STAGES.findIndex((s) => s.key === deployment?.status);

  return (
    <AppShell>
      <AppBar title="Deploy" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      {deployment?.status === "live" ? (
        <Card className="my-4">
          <p className="flex items-center gap-2 font-bold text-success">
            <IconCheck size={20} /> Your website is live
          </p>
          <p className="mt-2 break-all rounded-lg bg-elevated p-3 text-sm">
            {deployment.url}
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <a
              href={deployment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center gap-2 rounded-xl bg-brand px-6 font-semibold text-on-brand active:scale-[0.98]"
            >
              <IconExternal size={18} /> Open website
            </a>
            <Button variant="secondary" size="lg" block onClick={copyUrl}>
              <IconCopy size={18} /> Copy URL
            </Button>
          </div>
        </Card>
      ) : null}

      {deployment && deployment.status !== "live" && (
        <Card className="my-4">
          <p className="font-bold">
            {deployment.status === "failed" ? "Deployment stopped" : "Deploying…"}
          </p>
          <ol className="mt-3 space-y-1" aria-label="Deployment stages">
            {STAGES.map((stage, i) => {
              const done = stageIndex > i;
              const active = stageIndex === i;
              return (
                <li key={stage.key} className="flex items-center gap-3 py-1.5">
                  <span
                    aria-hidden="true"
                    className={`flex size-5 items-center justify-center rounded-full text-[0.625rem] ${
                      done
                        ? "bg-success text-white"
                        : active
                          ? "bg-brand text-on-brand"
                          : "border border-line text-muted"
                    }`}
                    style={active ? { animation: "pulse-dot 1.4s ease-in-out infinite" } : undefined}
                  >
                    {done ? "✓" : active ? "●" : "○"}
                  </span>
                  <span className={`text-sm ${done || active ? "font-medium" : "text-muted"}`}>
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {deployment.error && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {deployment.error}
            </p>
          )}
          <p aria-live="polite" className="sr-only">
            {deployment.log.at(-1) ?? ""}
          </p>
        </Card>
      )}

      <Card className="my-4">
        <Field label="Platform">
          {({ id }) => (
            <Select
              id={id}
              value={platform}
              onChange={(e) => setPlatform(e.target.value as DeployPlatform)}
            >
              <option value="builtin">Built-in hosting</option>
              <option value="vercel" disabled={!available.vercel}>
                Vercel{available.vercel ? "" : " (not connected)"}
              </option>
              <option value="netlify" disabled={!available.netlify}>
                Netlify{available.netlify ? "" : " (not connected)"}
              </option>
            </Select>
          )}
        </Field>

        <Field
          label="Project name"
          hint="Used in the web address. Letters, numbers and dashes."
        >
          {({ id }) => (
            <TextInput
              id={id}
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              enterKeyHint="go"
            />
          )}
        </Field>

        <Button size="lg" block loading={busy || running} onClick={deploy}>
          <IconRocket size={20} />
          {deployment?.status === "live" ? "Deploy again" : "Deploy"}
        </Button>

        {platform === "builtin" && (
          <p className="mt-3 text-xs text-muted">
            Publishes to this server straight away. Perfect for a QR-code menu —
            print the link and it works immediately.
          </p>
        )}
        {platform !== "builtin" && !available[platform] && (
          <p className="mt-3 text-xs text-warning">
            This platform needs an API token configured on the server. Built-in
            hosting works right now with no setup.
          </p>
        )}
      </Card>

      {toastNode}
    </AppShell>
  );
}
