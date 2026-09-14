"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Banner, Button, Card } from "./ui";
import { IconCheck, IconAlert } from "./icons";
import { isPackaged, openExternal } from "@/lib/shell";
import { googleFailure } from "@/lib/google-errors";

/**
 * One place to connect Google, and one component that does it.
 *
 * Connecting used to live inside the Digital Menu screen, which meant the
 * question "is my Google account connected?" could only be answered by opening
 * a project and scrolling. The connection is not a property of a project — it
 * belongs to the person — so it has a home of its own, and the menu screen
 * embeds this same component rather than keeping a second copy of the flow.
 *
 * Everything underneath is the existing implementation: the same
 * `/api/google/connect` consent start, the same callback, the same encrypted
 * token storage, the same scopes. This adds no OAuth of its own.
 */

export type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string;
  sheets: boolean;
  drive: boolean;
  missingPermissions: boolean;
};

/** What each permission is for, in terms of what the creator gets. */
const PERMISSIONS = [
  {
    id: "sheets",
    label: "Google Sheets",
    why: "Read the spreadsheet your menu lives in. The app never writes to it.",
  },
  {
    id: "drive",
    label: "Google Drive",
    why: "Find that spreadsheet, and fetch the photographs it points at. Read-only.",
  },
] as const;

export function GoogleConnection({
  /** Where consent should return to. Defaults to the current screen. */
  returnTo,
  /** Told when the connection changes, so an embedding screen can refresh. */
  onChange,
  initial,
  compact = false,
}: {
  returnTo: string;
  onChange?: (status: GoogleStatus) => void;
  initial?: GoogleStatus;
  compact?: boolean;
}) {
  const params = useSearchParams();
  const [status, setStatus] = useState<GoogleStatus | null>(initial ?? null);
  const [error, setError] = useState("");
  const [advice, setAdvice] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [awaitingConsent, setAwaitingConsent] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.google as GoogleStatus);
      onChange?.(data.google as GoogleStatus);
    } catch {
      /* keep the last known state rather than blanking the screen */
    }
  }, [onChange]);

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  // The consent flow returns here with a result in the query string.
  useEffect(() => {
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") {
      setNotice("Google connected.");
      setError("");
      setAdvice("");
    } else {
      const failure = googleFailure(result);
      setError(failure.message);
      setAdvice(failure.advice);
    }
    void load();
  }, [params, load]);

  /**
   * Watch for a connection made in another window.
   *
   * A packaged app sends consent to the system browser, so nothing navigates
   * this window when it finishes. Polling is the only way to notice — but it
   * runs only while someone is actually waiting, stops the moment the
   * connection lands, and gives up after five minutes. There is no background
   * polling of Google at rest.
   */
  useEffect(() => {
    if (!awaitingConsent) return;
    const started = Date.now();
    const timer = setInterval(() => {
      void load();
      if (Date.now() - started > 5 * 60_000) setAwaitingConsent(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [awaitingConsent, load]);

  useEffect(() => {
    if (status?.connected) setAwaitingConsent(false);
  }, [status?.connected]);

  async function connect() {
    setError("");
    setAdvice("");
    setNotice("");
    const href = `/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`;

    // In a browser this is an ordinary redirect. In a packaged app the consent
    // screen must open in the user's own browser — Google refuses OAuth inside
    // an embedded webview — so the app asks for the URL and the shell opens it.
    if (!isPackaged()) {
      window.location.href = href;
      return;
    }

    setBusy("connect");
    try {
      const res = await fetch(`${href}&mode=url`);
      const data = await res.json();
      if (!res.ok || !data.url) {
        const failure = googleFailure(res.status === 400 ? "unconfigured" : "failed");
        setError(data.error ?? failure.message);
        setAdvice(failure.advice);
        return;
      }
      await openExternal(data.url as string);
      setAwaitingConsent(true);
    } catch {
      const failure = googleFailure("failed");
      setError(failure.message);
      setAdvice(failure.advice);
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      await fetch("/api/google/disconnect", { method: "POST" });
      setNotice("Google disconnected.");
      await load();
    } catch {
      setError("Could not disconnect. Try again.");
    } finally {
      setBusy("");
    }
  }

  if (!status) {
    return (
      <section className="my-4" data-google-connection data-google-state="loading">
        <Card>
          <p className="text-sm text-muted">Checking your Google connection…</p>
        </Card>
      </section>
    );
  }

  return (
    /* data-google-state always says where the connection stands, whichever
       branch renders below: a screen that shows nothing when Google is simply
       not set up is indistinguishable from one that failed to load. */
    <section
      className="my-4"
      data-google-connection
      data-google-connected={String(status.connected)}
      data-google-state={
        !status.configured ? "unconfigured" : status.connected ? "connected" : "disconnected"
      }
    >
      <Card>
      <h2 className="font-bold">Google account</h2>

      {error && (
        <Banner tone="error">
          <span className="block font-semibold">{error}</span>
          {advice && <span className="mt-0.5 block text-sm">{advice}</span>}
        </Banner>
      )}
      {notice && !error && <Banner tone="success">{notice}</Banner>}

      {!status.configured ? (
        <p className="mt-1.5 text-sm text-muted">
          This copy of the application has no Google credentials configured, so
          Google features are switched off. Everything else works normally.
        </p>
      ) : !status.connected ? (
        <>
          <p className="mt-1.5 text-sm text-muted">
            Connect a Google account to build a digital menu from one of your
            spreadsheets. Optional — websites generate perfectly well without it.
          </p>

          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-muted">
            <span aria-hidden="true" className="text-lg leading-none">○</span>
            Not connected
          </p>

          {!compact && (
            <dl className="mt-3 grid gap-2.5">
              {PERMISSIONS.map((p) => (
                <div key={p.id} className="rounded-xl bg-elevated px-3 py-2">
                  <dt className="text-sm font-semibold">{p.label}</dt>
                  <dd className="text-xs text-muted">{p.why}</dd>
                </div>
              ))}
            </dl>
          )}

          <Button
            block
            size="lg"
            className="mt-3"
            loading={busy === "connect"}
            onClick={connect}
            data-google-connect
          >
            Connect Google
          </Button>

          {awaitingConsent && (
            <p className="mt-2 text-center text-xs text-muted">
              Waiting for you to finish in your browser. This screen updates on
              its own when you are done.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-success">
            <IconCheck size={16} /> Connected
            {status.email && <span className="font-normal text-muted">· {status.email}</span>}
          </p>

          <ul className="mt-3 grid gap-2">
            {PERMISSIONS.map((p) => {
              const available = p.id === "sheets" ? status.sheets : status.drive;
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-sm"
                  data-google-capability={p.id}
                  data-available={String(available)}
                >
                  <span className={available ? "text-success" : "text-danger"}>
                    {available ? <IconCheck size={16} /> : <IconAlert size={16} />}
                  </span>
                  <span className="flex-1 font-semibold">{p.label}</span>
                  <span className="text-xs text-muted">
                    {available ? "Available" : "Not approved"}
                  </span>
                </li>
              );
            })}
          </ul>

          {status.missingPermissions && (
            <p className="mt-2 text-xs text-danger">
              Connect again and leave both permissions ticked — without them a
              menu cannot be read.
            </p>
          )}

          <div className="mt-3 flex gap-2.5">
            <Button
              variant="secondary"
              className="flex-1"
              loading={busy === "connect"}
              onClick={connect}
            >
              Reconnect
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              loading={busy === "disconnect"}
              onClick={disconnect}
              data-google-disconnect
            >
              Disconnect
            </Button>
          </div>
        </>
      )}
      </Card>
    </section>
  );
}
