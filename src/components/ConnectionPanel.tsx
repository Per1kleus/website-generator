"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { LocalTime } from "./LocalTime";
import { AppBar, Banner, Button, Card, useToast } from "./ui";
import { IconCheck, IconCopy, IconExternal } from "./icons";

/**
 * The creator's side of a client Google connection.
 *
 * What this screen exists to make obvious is the difference between "the client
 * pressed Allow" and "this actually works". Those get confused constantly, and
 * the consequence of confusing them is a menu that is empty on opening night.
 * So every service says what was chosen, whether it has been read successfully,
 * and when — and a service that has not been proved says "checking", never
 * "connected".
 *
 * The credentials themselves are never here. The panel is fed by an endpoint
 * that cannot return one.
 */

type ServiceState = {
  service: string;
  status: string;
  resource: string;
  chosen: boolean;
  verifiedAt: number;
  error: string;
};

type LinkRow = {
  id: string;
  label: string;
  services: string[];
  state: string;
  expires_at: number;
  used_at: number;
  created_at: number;
};

type EventRow = {
  id: string;
  event: string;
  service: string;
  detail: string;
  created_at: number;
};

type State = {
  configured: boolean;
  access: { source: string; connected: boolean; email: string };
  connection: { status: string; email: string; connectedBy: string; services: ServiceState[] };
  links: LinkRow[];
  events: EventRow[];
};

const SERVICE_LABELS: Record<string, string> = {
  analytics: "Google Analytics",
  sheets: "Menu spreadsheet",
  drive: "Menu photographs",
};

const STATUS_LABELS: Record<string, { text: string; tone: "good" | "warn" | "bad" | "mute" }> = {
  not_connected: { text: "Not connected", tone: "mute" },
  connecting: { text: "Not checked yet", tone: "warn" },
  connected: { text: "Working", tone: "good" },
  partially_connected: { text: "Partly working", tone: "warn" },
  expired: { text: "Expired", tone: "bad" },
  revoked: { text: "Withdrawn", tone: "mute" },
  error: { text: "Not working", tone: "bad" },
};

const TONE_CLASS: Record<string, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  mute: "text-muted",
};

const WHEN: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

export function ConnectionPanel({
  projectId,
  businessName,
  isMenuProject,
  initial,
}: {
  projectId: string;
  businessName: string;
  isMenuProject: boolean;
  initial: State;
}) {
  const [state, setState] = useState<State>(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const { toast, toastNode } = useToast();

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const linkFor = (id: string) => `${origin}/connect/${id}`;

  const post = useCallback(
    async (body: Record<string, unknown>, tag: string) => {
      setBusy(tag);
      setError("");
      try {
        const res = await fetch(`/api/projects/${projectId}/connection`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as Partial<State> & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "That did not work.");
          return;
        }
        if (data.connection) setState(data as State);
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusy("");
      }
    },
    [projectId],
  );

  // A fresh reading on arrival, so a connection the client completed while this
  // screen was closed is not reported from a stale row.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/connection`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as State;
        if (!cancelled) setState(data);
      } catch {
        // The server-rendered state stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(linkFor(id));
      toast("Link copied");
    } catch {
      toast("Could not copy — long-press the link instead");
    }
  }

  const usable = state.links.filter((l) => l.state === "usable");
  const connected = state.connection.status !== "not_connected";
  const verdict = STATUS_LABELS[state.connection.status] ?? STATUS_LABELS.not_connected;

  return (
    <AppShell>
      <AppBar title="Client Google connection" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}
      {!state.configured && (
        <Banner tone="warning">
          This server has no Google credentials configured, so a client link
          cannot be used yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
        </Banner>
      )}

      <Card className="my-4">
        <h2 className="font-bold">Ask your client to connect their own Google account</h2>
        <p className="mt-1.5 text-sm text-muted">
          They open one link, sign in to Google themselves, and approve{" "}
          {isMenuProject
            ? "read-only access to their analytics, their menu spreadsheet and their photograph folder"
            : "read-only access to their analytics"}
          . You never see their password, and this application never asks for one.
        </p>
        <p className="mt-2 text-sm text-muted">
          The link works for one project only — this one — and you can withdraw
          it at any time.
        </p>
        <label className="mt-3 block text-sm font-semibold" htmlFor="connect-label">
          A note to remember it by (optional)
        </label>
        <input
          id="connect-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Sent to Maria, 12 March"
          className="mt-1.5 min-h-[var(--spacing-touch)] w-full rounded-xl border border-line bg-surface px-3 text-base"
        />
        <Button
          size="lg"
          block
          className="mt-3"
          loading={busy === "create"}
          disabled={!state.configured}
          onClick={() => void post({ action: "create-link", label }, "create")}
          data-create-connect-link
        >
          Create a connection link
        </Button>
      </Card>

      <Card className="my-3" >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold">What is connected</h2>
          <span
            className={`text-sm font-semibold ${TONE_CLASS[verdict.tone]}`}
            data-connection-status={state.connection.status}
          >
            {verdict.text}
          </span>
        </div>

        <p className="mt-1.5 text-sm text-muted" data-connection-source={state.access.source}>
          {state.access.source === "project"
            ? `Using your client's Google account${state.connection.email ? ` (${state.connection.email})` : ""}.`
            : state.access.source === "owner"
              ? `Using your own Google account${state.access.email ? ` (${state.access.email})` : ""}. Your client has not connected theirs.`
              : "No Google account is connected for this project."}
        </p>

        <ul className="mt-3 space-y-3">
          {state.connection.services.map((service) => {
            const word = STATUS_LABELS[service.status] ?? STATUS_LABELS.not_connected;
            return (
              <li
                key={service.service}
                className="border-t border-line pt-3 first:border-0 first:pt-0"
                data-connection-service={service.service}
                data-service-status={service.status}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {SERVICE_LABELS[service.service] ?? service.service}
                  </p>
                  <span className={`text-xs font-semibold ${TONE_CLASS[word.tone]}`}>
                    {word.text}
                  </span>
                </div>
                {service.resource && (
                  <p className="mt-1 text-sm text-muted" data-service-resource>
                    {service.resource}
                  </p>
                )}
                {service.verifiedAt > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Last read successfully <LocalTime ts={service.verifiedAt} mode="relative" />
                  </p>
                )}
                {service.error && <p className="mt-1 text-sm text-danger">{service.error}</p>}
              </li>
            );
          })}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            loading={busy === "verify"}
            onClick={() => void post({ action: "verify" }, "verify")}
            data-verify-connection
          >
            Check it works
          </Button>
          {connected && state.access.source === "project" && (
            <Button
              variant="secondary"
              loading={busy === "disconnect"}
              onClick={() => void post({ action: "disconnect" }, "disconnect")}
              data-disconnect-connection
            >
              Disconnect
            </Button>
          )}
        </div>
        {connected && state.access.source === "project" && (
          <p className="mt-2 text-xs text-muted">
            Disconnecting withdraws the permission only. The website, the menu
            data already synced, every saved version and everything in your
            client&rsquo;s Google account stay exactly as they are.
          </p>
        )}
      </Card>

      {state.links.length === 0 && (
        <p className="my-6 text-center text-sm text-muted">No connection links yet.</p>
      )}

      {state.links.map((link) => (
        <Card key={link.id} className="my-3">
          <div className="flex items-baseline justify-between gap-3" data-connect-link-row data-link-state={link.state}>
            <p className="font-bold">
              {link.label || "Connection link"}
              {link.state !== "usable" && (
                <span className="ml-2 text-xs font-normal text-muted">
                  {link.state === "revoked" ? "withdrawn" : "expired"}
                </span>
              )}
            </p>
            <p className="text-xs text-muted">
              <LocalTime ts={link.created_at} options={WHEN} />
            </p>
          </div>

          <p className="mt-1.5 text-xs text-muted">
            Asks for: {link.services.map((s) => SERVICE_LABELS[s] ?? s).join(" · ")}
          </p>

          {link.state === "usable" && (
            <>
              <p className="mt-2 break-all rounded-lg bg-elevated p-2.5 text-xs" data-connect-link-url>
                {linkFor(link.id)}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void copy(link.id)} data-copy-connect-link>
                  <IconCopy size={16} /> Copy link
                </Button>
                <a
                  href={linkFor(link.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[var(--spacing-touch)] items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-elevated"
                >
                  <IconExternal size={16} /> Open
                </a>
                <Button
                  variant="secondary"
                  loading={busy === `revoke-${link.id}`}
                  onClick={() => void post({ action: "revoke-link", linkId: link.id }, `revoke-${link.id}`)}
                  data-revoke-connect-link
                >
                  Withdraw
                </Button>
              </div>
              {link.expires_at > 0 && (
                <p className="mt-2 text-xs text-muted">
                  Stops working <LocalTime ts={link.expires_at} options={WHEN} />
                </p>
              )}
            </>
          )}

          {link.used_at > 0 && (
            <p className="mt-2 flex items-center gap-2 text-sm text-success" data-link-used>
              <IconCheck size={16} /> Opened and signed in{" "}
              <LocalTime ts={link.used_at} mode="relative" />
            </p>
          )}
        </Card>
      ))}

      {state.events.length > 0 && (
        <Card className="my-3">
          <h2 className="font-bold">History</h2>
          <p className="mt-1.5 text-xs text-muted">
            What happened, and when. No tokens or credentials are recorded here.
          </p>
          <ul className="mt-3 space-y-2">
            {state.events.map((event) => (
              <li key={event.id} className="text-sm" data-connect-event={event.event}>
                <span className="font-semibold">{event.event.replace(/-/g, " ")}</span>
                {event.service && <span className="text-muted"> · {SERVICE_LABELS[event.service] ?? event.service}</span>}
                {event.detail && <span className="text-muted"> · {event.detail}</span>}
                <span className="block text-xs text-muted">
                  <LocalTime ts={event.created_at} mode="relative" />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {toastNode}
    </AppShell>
  );
}
