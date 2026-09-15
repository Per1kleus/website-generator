"use client";

import { useCallback, useEffect, useState } from "react";
import { useMounted } from "./LocalTime";
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

export type PublishGate = {
  ok: boolean;
  blockers: { id: string; issue: string; correction: string }[];
  warnings: { id: string; issue: string; correction: string }[];
  score: number | null;
  status: string;
};

/**
 * "Today, 14:32" — a time a person reads, not an ISO string.
 *
 * Rendered only once mounted: the server and the browser can be in different
 * time zones, and a time formatted in each would not agree.
 */
function PublishedTime({ ts }: { ts: number }) {
  const mounted = useMounted();
  return <>{mounted ? whenPublished(ts) : "…"}</>;
}

function whenPublished(ts: number): string {
  if (!ts) return "never";
  const date = new Date(ts);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

export function DeployPanel({
  projectId,
  businessName,
  defaultSlug,
  initialDeployment,
  initialGate,
  initialHasChanges = false,
  available,
}: {
  projectId: string;
  businessName: string;
  defaultSlug: string;
  initialDeployment: Deployment | null;
  /** Whether publishing would be refused, and why. Computed on the server. */
  initialGate?: PublishGate | null;
  initialHasChanges?: boolean;
  available: Record<DeployPlatform, boolean>;
}) {
  const [gate, setGate] = useState<PublishGate | null>(initialGate ?? null);
  const [hasChanges, setHasChanges] = useState(initialHasChanges);
  const [showIssues, setShowIssues] = useState(false);
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
      if (data.gate) setGate(data.gate as PublishGate);
      if (typeof data.hasChanges === "boolean") setHasChanges(data.hasChanges);
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
        // A refusal carries the reasons with it, so they can be shown rather
        // than leaving the creator to guess what "cannot be published" means.
        if (data.gate) {
          setGate(data.gate as PublishGate);
          setShowIssues(true);
        }
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

  async function takeDown() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpublish" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Could not take the website down.");
        return;
      }
      setDeployment(data.deployment as Deployment | null);
      toast("Website taken down");
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

      {/* Refusals come first and say exactly what has to change. Only issues
          the checklist calls critical land here; everything else is shown as
          a warning that does not stand in the way. */}
      {gate && !gate.ok && deployment?.status !== "live" && (
        <section className="my-4" data-publish-blocked>
          <Card className="border-danger/40">
            <p className="font-bold text-danger">Cannot publish yet</p>
            <ul className="mt-2 space-y-1">
              {gate.blockers.map((b) => (
                <li key={b.id} className="text-sm" data-publish-blocker>
                  <span className="text-danger">✕</span> {b.issue}
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => setShowIssues((v) => !v)}
            >
              {showIssues ? "Hide details" : "View issues"}
            </Button>
            {showIssues && (
              <ul className="mt-3 space-y-2 border-t border-line pt-3">
                {gate.blockers.map((b) => (
                  <li key={b.id} className="text-xs text-muted">
                    <span className="block font-semibold text-fg">{b.issue}</span>
                    {b.correction}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      {/* Warnings are shown, not merely counted: "3 things could be better"
          tells a creator nothing they can act on. None of them stand in the
          way of publishing. */}
      {gate && gate.ok && gate.warnings.length > 0 && deployment?.status !== "live" && (
        <section className="my-4" data-publish-warnings>
          <Card className="border-warning/40">
            <p className="font-bold text-warning">
              {gate.warnings.length} thing{gate.warnings.length === 1 ? "" : "s"} could be
              better, but none of them stop you publishing.
            </p>
            <ul className="mt-2 space-y-1">
              {gate.warnings.slice(0, 5).map((w) => (
                <li key={w.id} className="text-sm" data-publish-warning>
                  <span className="text-warning">!</span> {w.issue}
                </li>
              ))}
            </ul>
            {gate.warnings.length > 5 && (
              <p className="mt-2 text-xs text-muted">
                {gate.warnings.length - 5} more on the readiness checklist.
              </p>
            )}
          </Card>
        </section>
      )}

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

          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">Last published</dt>
              <dd className="flex-1 text-right font-medium" data-publish-when>
                <PublishedTime ts={deployment.published_at} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Changes since publication</dt>
              <dd
                className={`flex-1 text-right font-medium ${hasChanges ? "text-warning" : ""}`}
                data-publish-changes={String(hasChanges)}
              >
                {hasChanges ? "Yes" : "No"}
              </dd>
            </div>
          </dl>

          {/* Custom domains, stated rather than pretended.
              Nothing here configures DNS, buys a name or installs a
              certificate, so there is no field that looks as though it does.
              What the creator gets is the one fact they need to act on: the
              address this server actually serves, and who has to point a
              domain at it. */}
          {platform === "builtin" && (
            <details className="mt-3 rounded-xl border border-line p-3" data-custom-domain>
              <summary className="cursor-pointer text-sm font-semibold">
                Using the client&apos;s own domain name
              </summary>
              <p className="mt-2 text-xs text-muted">
                This application does not register domains or issue certificates.
                To put the website on the client&apos;s own address, whoever manages
                that domain points it at the server this application is running
                on, and that server terminates HTTPS for it. Until that is done,
                the address above is the live one and is the link to share.
              </p>
            </details>
          )}

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <Button
              size="lg"
              block
              loading={busy}
              disabled={!hasChanges}
              onClick={deploy}
              data-publish-changes-button
            >
              <IconRocket size={18} /> Publish changes
            </Button>
            <Button
              variant="secondary"
              size="lg"
              block
              loading={busy}
              onClick={takeDown}
              data-unpublish
            >
              Unpublish
            </Button>
          </div>
          {!hasChanges && (
            <p className="mt-2 text-center text-xs text-muted">
              The live website already matches this project.
            </p>
          )}
        </Card>
      ) : null}

      {deployment?.status === "unpublished" && (
        <Card className="my-4">
          <p className="font-bold">This website has been taken down</p>
          <p className="mt-1.5 text-sm text-muted">
            The address is still reserved for this project, so publishing again
            puts it back at the same link.
          </p>
        </Card>
      )}

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
