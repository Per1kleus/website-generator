"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, LinkButton } from "./ui";
import { IconAlert, IconCheck } from "./icons";
import { GENERATION_STEPS } from "@/lib/site";
import type { Job, JobStep } from "@/server/jobs";

/**
 * The mobile generation screen (requirement 5).
 *
 * A vertical checklist and one number. No wide progress bars, no side-by-side
 * panels, no tables — all of which collapse at 320px.
 *
 * Crucially the progress here is *read from the backend*, never simulated. If
 * the user locks their phone, takes a call, or force-quits the app, the work
 * keeps running server-side and this screen resyncs on return.
 */
export function GenerationProgress({
  projectId,
  businessName,
  initialStatus,
  initialJob,
}: {
  projectId: string;
  businessName: string;
  initialStatus: string;
  initialJob: Job | null;
}) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(initialJob);
  const [status, setStatus] = useState(initialStatus);
  const [offline, setOffline] = useState(false);
  const started = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setJob(data.job);
      setStatus(data.status);
      setOffline(false);
    } catch {
      // Losing signal mid-generation is normal on mobile. Say so, keep polling,
      // and never imply the generation itself has failed.
      setOffline(true);
    }
  }, [projectId]);

  // Kick off generation once, only if nothing is already running or finished.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const needsStart =
      initialStatus === "draft" || (!initialJob && initialStatus !== "ready");
    if (!needsStart) return;
    fetch(`/api/projects/${projectId}/generate`, { method: "POST" })
      .then(() => refresh())
      .catch(() => setOffline(true));
  }, [projectId, initialJob, initialStatus, refresh]);

  const running = status === "generating" || job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 1500);

    // When the phone wakes or the tab comes back, resync immediately rather
    // than waiting out the poll interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [running, refresh]);

  const done = job?.status === "done" || status === "ready";
  const failed = job?.status === "failed" || status === "failed";
  const progress = done ? 100 : (job?.progress ?? 0);
  // Before the job record exists (the very first paint after tapping
  // "Generate"), show the real pipeline with everything still pending rather
  // than an empty screen.
  const steps: JobStep[] =
    job?.steps ??
    GENERATION_STEPS.map((s, i) => ({
      ...s,
      status: i === 0 ? ("active" as const) : ("pending" as const),
    }));

  return (
    <AppShell>
      <AppBar title="Generating" subtitle={businessName} back="/" />

      {offline && (
        <Banner tone="warning">
          You are offline. Generation is still running on the server — this will
          catch up as soon as you reconnect.
        </Banner>
      )}

      <div className="py-6 text-center">
        <h2 className="text-xl font-bold">
          {done
            ? "Your website is ready"
            : failed
              ? "Generation stopped"
              : "Generating your website"}
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          {job?.message || "Starting up…"}
        </p>
      </div>

      {/* One number, centred, huge. Reads at arm's length on any phone. */}
      <div
        className="mb-8 text-center"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-label="Generation progress"
      >
        <span className="text-5xl font-bold tabular-nums">{progress}%</span>
        <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Vertical checklist — the mobile-native way to show a pipeline. */}
      <ol className="mx-auto max-w-sm space-y-1" aria-label="Generation steps">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-3 py-2.5">
            <span
              aria-hidden="true"
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                s.status === "done"
                  ? "bg-success text-white"
                  : s.status === "active"
                    ? "bg-brand text-on-brand"
                    : s.status === "failed"
                      ? "bg-danger text-white"
                      : "border border-line text-muted"
              }`}
              style={
                s.status === "active"
                  ? { animation: "pulse-dot 1.4s ease-in-out infinite" }
                  : undefined
              }
            >
              {s.status === "done" ? (
                <IconCheck size={14} />
              ) : s.status === "failed" ? (
                <IconAlert size={14} />
              ) : s.status === "active" ? (
                "●"
              ) : (
                "○"
              )}
            </span>
            <span
              className={`text-sm ${
                s.status === "pending" ? "text-muted" : "font-medium"
              }`}
            >
              {s.label}
            </span>
            <span className="sr-only">
              {s.status === "done"
                ? " — complete"
                : s.status === "active"
                  ? " — in progress"
                  : s.status === "failed"
                    ? " — failed"
                    : " — waiting"}
            </span>
          </li>
        ))}
      </ol>

      <p aria-live="polite" className="sr-only">
        {done ? "Generation complete." : job?.message}
      </p>

      {/* Shown from the very first paint, not just once polling has started. */}
      {!done && !failed && (
        <p className="mx-auto mt-8 max-w-xs text-center text-xs text-muted">
          You can leave this screen or close the window. Generation keeps running
          and you can come back at any time.
        </p>
      )}

      {failed && (
        <div className="mt-8">
          <Banner tone="error">{job?.error ?? "Something went wrong."}</Banner>
          <Button
            size="lg"
            block
            onClick={() => {
              started.current = false;
              fetch(`/api/projects/${projectId}/generate`, { method: "POST" }).then(refresh);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {done && (
        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3">
          <LinkButton href={`/projects/${projectId}/preview`} size="lg" block>
            View your website
          </LinkButton>
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => router.push(`/projects/${projectId}`)}
          >
            Go to project
          </Button>
        </div>
      )}
    </AppShell>
  );
}
