"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, Select, useToast } from "./ui";
import { IconCheck, IconExternal } from "./icons";
import { isPackaged, openExternal } from "@/lib/shell";

/**
 * Analytics and Search Console for one website.
 *
 * Not a copy of Google's own interface — nobody needs a second one, and the
 * real thing is a click away. This answers the handful of questions a person
 * who built a website for a business actually has: is anyone visiting, what
 * are they looking at, what are people searching for to find it.
 *
 * Every figure here came back from Google in this session. Nothing is cached
 * and presented as current, nothing is estimated, and a failed request says so
 * rather than showing a zero that looks like a fact.
 */

type Property = {
  property_id: string;
  property_name: string;
  measurement_id: string;
} | null;

type Google = { connected: boolean; analytics: boolean; searchConsole: boolean };

const RANGES = [
  { id: "7d", label: "7 days" },
  { id: "28d", label: "28 days" },
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
];

const num = (n: number) => n.toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function InsightsPanel({
  projectId,
  businessName,
  initial,
  consentAcknowledged,
}: {
  projectId: string;
  businessName: string;
  initial: { google: Google; analytics: Property; searchConsole: Property };
  consentAcknowledged: boolean;
}) {
  const [google, setGoogle] = useState(initial.google);
  const [analytics, setAnalytics] = useState<Property>(initial.analytics);
  const [searchConsole, setSearchConsole] = useState<Property>(initial.searchConsole);
  const [consent, setConsent] = useState(consentAcknowledged);
  const [range, setRange] = useState("28d");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [advice, setAdvice] = useState("");
  const [gaReport, setGaReport] = useState<Record<string, unknown> | null>(null);
  const [scReport, setScReport] = useState<Record<string, unknown> | null>(null);
  const [picker, setPicker] = useState<{ service: string; items: Record<string, string>[] } | null>(null);
  const { toast, toastNode } = useToast();

  const problem = (data: { error?: string; advice?: string }) => {
    setError(data.error ?? "That did not work.");
    setAdvice(data.advice ?? "");
  };

  const load = useCallback(
    async (service: "analytics" | "searchConsole", r: string) => {
      setBusy(service);
      setError("");
      setAdvice("");
      try {
        const res = await fetch(
          `/api/projects/${projectId}/insights?report=${service}&range=${r}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (!res.ok) {
          problem(data);
          return;
        }
        if (service === "analytics") setGaReport(data.report);
        else setScReport(data.report);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy("");
      }
    },
    [projectId],
  );

  // Reports are fetched when a property is connected and when the range
  // changes — not on a timer. Nothing polls Google in the background.
  useEffect(() => {
    if (analytics) void load("analytics", range);
  }, [analytics, range, load]);
  useEffect(() => {
    if (searchConsole) void load("searchConsole", range);
  }, [searchConsole, range, load]);

  async function grant(service: "analytics" | "searchConsole") {
    const returnTo = `/projects/${projectId}/insights`;
    const href = `/api/google/connect?returnTo=${encodeURIComponent(returnTo)}&services=${service}`;
    if (!isPackaged()) {
      window.location.href = href;
      return;
    }
    const res = await fetch(`${href}&mode=url`);
    const data = await res.json();
    if (data.url) {
      await openExternal(data.url as string);
      toast("Finish in your browser, then come back");
    }
  }

  async function openPicker(service: "analytics" | "searchConsole") {
    setBusy(service);
    setError("");
    setAdvice("");
    try {
      const what = service === "analytics" ? "analyticsProperties" : "searchConsoleSites";
      const res = await fetch(`/api/projects/${projectId}/insights?report=${what}`);
      const data = await res.json();
      if (!res.ok) {
        problem(data);
        return;
      }
      const items = service === "analytics"
        ? (data.properties as { id: string; name: string; account: string }[]).map((p) => ({
            id: p.id, name: p.name, note: p.account,
          }))
        : (data.sites as { url: string; verified: boolean }[]).map((s) => ({
            id: s.url,
            name: s.url,
            note: s.verified ? "" : "not verified",
          }));
      setPicker({ service, items });
    } finally {
      setBusy("");
    }
  }

  async function choose(service: string, item: Record<string, string>) {
    if (item.note === "not verified") {
      setError("Google has not confirmed you own that property yet.");
      setAdvice("Verify ownership in Search Console, then choose it here.");
      return;
    }
    setBusy("choose");
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, propertyId: item.id, propertyName: item.name }),
      });
      const data = await res.json();
      if (!res.ok) {
        problem(data);
        return;
      }
      if (service === "analytics") {
        setAnalytics(data.analytics);
        setConsent(false);
      } else setSearchConsole(data.searchConsole);
      setPicker(null);
    } finally {
      setBusy("");
    }
  }

  async function disconnect(service: "analytics" | "searchConsole") {
    setBusy(service);
    try {
      await fetch(`/api/projects/${projectId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", service }),
      });
      if (service === "analytics") {
        setAnalytics(null);
        setGaReport(null);
      } else {
        setSearchConsole(null);
        setScReport(null);
      }
      toast("Disconnected");
    } finally {
      setBusy("");
    }
  }

  async function setConsentFlag(value: boolean) {
    setConsent(value);
    await fetch(`/api/projects/${projectId}/insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "consent", service: "analytics", consentAcknowledged: value }),
    });
  }

  const ga = gaReport as null | {
    visitors: number; sessions: number; pageViews: number;
    topPages: { path: string; views: number }[];
    devices: { device: string; share: number }[];
    range: { startDate: string; endDate: string };
  };
  const sc = scReport as null | {
    clicks: number; impressions: number; ctr: number; position: number;
    queries: { query: string; clicks: number; impressions: number }[];
    pages: { page: string; clicks: number }[];
    range: { startDate: string; endDate: string };
  };

  return (
    <AppShell>
      <AppBar title="Analytics" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && (
        <Banner tone="error">
          <span className="block font-semibold">{error}</span>
          {advice && <span className="mt-0.5 block text-sm">{advice}</span>}
        </Banner>
      )}

      {!google.connected && (
        <Card className="my-4">
          <p className="font-bold">Connect Google first</p>
          <p className="mt-1.5 text-sm text-muted">
            Analytics and Search Console use the same Google account as the rest
            of the app.
          </p>
          <Button className="mt-3" onClick={() => (window.location.href = "/account/google")}>
            Go to Google connections
          </Button>
        </Card>
      )}

      <div className="my-4 flex items-center gap-2">
        <label htmlFor="range" className="text-sm font-semibold">Period</label>
        <Select id="range" value={range} onChange={(e) => setRange(e.target.value)} data-insights-range>
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </Select>
      </div>

      {/* ----------------------------------------------------- analytics */}
      <section data-analytics-card data-connected={String(Boolean(analytics))}>
        <Card className="my-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-bold">Google Analytics</h2>
            {analytics ? (
              <span className="flex items-center gap-1 text-sm font-semibold text-success">
                <IconCheck size={16} /> Connected
              </span>
            ) : (
              <span className="text-sm text-muted">Not connected</span>
            )}
          </div>

          {analytics ? (
            <>
              <p className="mt-1.5 text-sm text-muted">
                Property: <span className="font-medium text-fg">{analytics.property_name}</span>
              </p>

              {ga ? (
                <>
                  <dl className="mt-3 grid grid-cols-3 gap-2.5 text-center">
                    {[
                      ["Visitors", ga.visitors],
                      ["Sessions", ga.sessions],
                      ["Page views", ga.pageViews],
                    ].map(([label, value]) => (
                      <div key={label as string} className="rounded-xl bg-elevated p-3">
                        <dd className="text-xl font-bold tabular-nums">{num(value as number)}</dd>
                        <dt className="text-xs text-muted">{label as string}</dt>
                      </div>
                    ))}
                  </dl>

                  {ga.topPages.length > 0 && (
                    <>
                      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">Top pages</h3>
                      <ul className="mt-1.5 space-y-1 text-sm">
                        {ga.topPages.map((p) => (
                          <li key={p.path} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{p.path}</span>
                            <span className="tabular-nums text-muted">{num(p.views)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {ga.devices.length > 0 && (
                    <>
                      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">Devices</h3>
                      <ul className="mt-1.5 space-y-1 text-sm">
                        {ga.devices.map((d) => (
                          <li key={d.device} className="flex justify-between gap-3">
                            <span className="capitalize">{d.device}</span>
                            <span className="tabular-nums text-muted">{d.share}%</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="mt-3 text-[0.6875rem] text-muted">
                    {ga.range.startDate} to {ga.range.endDate}, from Google Analytics.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {busy === "analytics" ? "Loading…" : "No figures for this period."}
                </p>
              )}

              {/* Configured is not the same as lawful, and the application
                  never conflates them. */}
              <div className="mt-4 rounded-xl border border-line p-3">
                <p className="text-sm font-semibold">Visitor consent</p>
                <p className="mt-1 text-xs text-muted">
                  Analytics sets cookies. Where your visitors are, that may need
                  their consent before it runs. This application does not ask
                  for consent on your behalf and makes no claim that your use of
                  it is lawful.
                </p>
                <label className="mt-2 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => void setConsentFlag(e.target.checked)}
                    data-consent-ack
                    className="mt-0.5"
                  />
                  <span>
                    I have taken responsibility for consent on this website.
                    <span className="mt-0.5 block text-muted" data-consent-state={String(consent)}>
                      {consent ? "Acknowledged" : "Not acknowledged"} — this is a note to
                      yourself, not a legal setting.
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href="https://analytics.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[var(--spacing-touch)] items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-elevated"
                >
                  <IconExternal size={16} /> View in Analytics
                </a>
                <Button variant="secondary" loading={busy === "analytics"} onClick={() => disconnect("analytics")}>
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">
                Connect a property you already own to see how many people visit
                this website. Optional — the website works identically without it.
              </p>
              <Button
                className="mt-3"
                loading={busy === "analytics"}
                onClick={() => (google.analytics ? openPicker("analytics") : grant("analytics"))}
                data-connect-analytics
              >
                {google.analytics ? "Choose a property" : "Connect Analytics"}
              </Button>
            </>
          )}
        </Card>
      </section>

      {/* ------------------------------------------------ search console */}
      <section data-search-console-card data-connected={String(Boolean(searchConsole))}>
        <Card className="my-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-bold">Google Search Console</h2>
            {searchConsole ? (
              <span className="flex items-center gap-1 text-sm font-semibold text-success">
                <IconCheck size={16} /> Connected
              </span>
            ) : (
              <span className="text-sm text-muted">Not connected</span>
            )}
          </div>

          {searchConsole ? (
            <>
              <p className="mt-1.5 text-sm text-muted">
                Property: <span className="font-medium text-fg">{searchConsole.property_name}</span>
              </p>

              {sc ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-2.5 text-center sm:grid-cols-4">
                    {[
                      ["Clicks", num(sc.clicks)],
                      ["Impressions", num(sc.impressions)],
                      ["Average CTR", pct(sc.ctr)],
                      ["Average position", sc.position.toFixed(1)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-elevated p-3">
                        <dd className="text-lg font-bold tabular-nums">{value}</dd>
                        <dt className="text-xs text-muted">{label}</dt>
                      </div>
                    ))}
                  </dl>

                  {sc.queries.length > 0 && (
                    <>
                      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">
                        Top searches
                      </h3>
                      <ul className="mt-1.5 space-y-1 text-sm">
                        {sc.queries.slice(0, 8).map((q) => (
                          <li key={q.query} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{q.query}</span>
                            <span className="tabular-nums text-muted">
                              {num(q.clicks)} / {num(q.impressions)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {sc.pages.length > 0 && (
                    <>
                      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-muted">Top pages</h3>
                      <ul className="mt-1.5 space-y-1 text-sm">
                        {sc.pages.slice(0, 5).map((p) => (
                          <li key={p.page} className="flex justify-between gap-3">
                            <span className="min-w-0 truncate">{p.page}</span>
                            <span className="tabular-nums text-muted">{num(p.clicks)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="mt-3 text-[0.6875rem] text-muted">
                    {sc.range.startDate} to {sc.range.endDate}, from Search Console. Its
                    most recent days are still being counted and are left out.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {busy === "searchConsole" ? "Loading…" : "No search data for this period yet."}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href="https://search.google.com/search-console"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[var(--spacing-touch)] items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-elevated"
                >
                  <IconExternal size={16} /> View in Search Console
                </a>
                <Button
                  variant="secondary"
                  loading={busy === "searchConsole"}
                  onClick={() => disconnect("searchConsole")}
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">
                See what people search for before they arrive. The website has to
                be added to Search Console and its ownership verified with Google
                first — this application cannot verify it for you.
              </p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-muted">
                <li>Add this website as a property in Search Console</li>
                <li>Verify ownership with Google</li>
                <li>Come back and choose it here</li>
              </ol>
              <Button
                className="mt-3"
                loading={busy === "searchConsole"}
                onClick={() =>
                  google.searchConsole ? openPicker("searchConsole") : grant("searchConsole")
                }
                data-connect-search-console
              >
                {google.searchConsole ? "Check verification" : "Connect Search Console"}
              </Button>
            </>
          )}
        </Card>
      </section>

      {picker && (
        <Card className="my-4" data-property-picker>
          <h2 className="font-bold">Choose a property</h2>
          {picker.items.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              The connected Google account owns none that this application can
              see. Add one in Google first, then come back.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {picker.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => choose(picker.service, item)}
                    data-property-option={item.id}
                    className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 rounded-card border border-line p-3 text-left hover:bg-elevated"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{item.name}</span>
                      {item.note && <span className="block text-xs text-muted">{item.note}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" className="mt-3" onClick={() => setPicker(null)}>
            Cancel
          </Button>
        </Card>
      )}

      {toastNode}
    </AppShell>
  );
}
