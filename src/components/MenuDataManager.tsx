"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "./AppShell";
import { AppBar, Banner, BottomSheet, Button, Card, TextInput, useToast } from "./ui";
import { IconCheck, IconAlert, IconExternal, IconSettings } from "./icons";
import type { MenuSource } from "@/server/menu/source";
import { isPackaged, openExternal } from "@/lib/shell";

/**
 * 🍽️ Digital Menu Data — the builder-side configuration screen.
 *
 * This is creator-only. Nothing here appears in, or is reachable from, the
 * generated public menu: customers get static HTML with no controls, and never
 * need to know a spreadsheet is involved.
 */

type Google = { connected: boolean; email: string; configured: boolean };
type Sheet = { id: string; name: string; modifiedTime: string };
type Tab = { title: string; sheetId: number; rowCount: number };
type Finding = {
  level: "error" | "warning";
  row: number | null;
  column: string | null;
  message: string;
};

const REQUIRED = ["name", "price", "description", "chefs choice", "category", "imageurl"];

function relativeTime(ts: number): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleString();
}

export function MenuDataManager({
  projectId,
  businessName,
  initialSource,
  initialGoogle,
}: {
  projectId: string;
  businessName: string;
  initialSource: MenuSource | null;
  initialGoogle: Google;
}) {
  const params = useSearchParams();
  const [google, setGoogle] = useState<Google>(initialGoogle);
  const [source, setSource] = useState<MenuSource | null>(initialSource);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [awaitingConsent, setAwaitingConsent] = useState(false);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Sheet | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const { toast, toastNode } = useToast();

  // The OAuth callback returns here with a result in the query string.
  useEffect(() => {
    const result = params.get("google");
    if (!result) return;
    if (result === "connected") setNotice("Google account connected.");
    else if (result === "denied") setError("You declined the Google permission request.");
    else if (result === "state") setError("That sign-in did not complete safely. Try again.");
    else if (result) setError("Could not connect your Google account. Try again.");
  }, [params]);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/menu-source`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setGoogle(data.google as Google);
      setSource(data.source as MenuSource | null);
    } catch {
      /* the screen keeps its last known state */
    }
  }, [projectId]);

  useEffect(() => {
    if (params.get("google")) void reload();
  }, [params, reload]);

  // Consent happens in a separate browser window, so nothing navigates this
  // one when it completes. Poll while waiting, and stop as soon as it lands
  // or the user gives up — no permanent background polling.
  useEffect(() => {
    if (!awaitingConsent) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      await reload();
      if (Date.now() - started > 5 * 60_000) setAwaitingConsent(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [awaitingConsent, reload]);

  useEffect(() => {
    if (google.connected) setAwaitingConsent(false);
  }, [google.connected]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${projectId}/menu-source`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.source !== undefined) setSource(data.source as MenuSource | null);
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "That did not work.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return null;
    } finally {
      setBusy("");
    }
  }

  /**
   * Starts the Google sign-in.
   *
   * In a browser this is an ordinary redirect. In a packaged app the consent
   * screen must open in the user's own browser — Google refuses OAuth inside
   * an embedded webview — so the app asks the server for the URL, opens it
   * externally, and then watches for the connection to appear.
   */
  async function connectGoogle() {
    const returnTo = `/projects/${projectId}/menu-data`;
    const href = `/api/google/connect?returnTo=${encodeURIComponent(returnTo)}`;

    if (!isPackaged()) {
      window.location.href = href;
      return;
    }

    setBusy("connect");
    setError("");
    try {
      const res = await fetch(`${href}&mode=url`);
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start Google sign-in.");
        return;
      }
      await openExternal(data.url as string);
      setAwaitingConsent(true);
    } catch {
      setError("Could not start Google sign-in.");
    } finally {
      setBusy("");
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    setChosen(null);
    setTabs([]);
    await loadSheets("");
  }

  async function loadSheets(q: string) {
    setBusy("sheets");
    setError("");
    try {
      const res = await fetch(`/api/google/spreadsheets?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not list your spreadsheets.");
        return;
      }
      setSheets(data.spreadsheets as Sheet[]);
    } catch {
      setError("Could not reach Google.");
    } finally {
      setBusy("");
    }
  }

  async function chooseSheet(sheet: Sheet) {
    setChosen(sheet);
    setBusy("tabs");
    try {
      const res = await fetch(`/api/google/tabs?spreadsheetId=${encodeURIComponent(sheet.id)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not read that spreadsheet.");
        return;
      }
      setTabs(data.tabs as Tab[]);
    } finally {
      setBusy("");
    }
  }

  async function useTab(tab: Tab) {
    if (!chosen) return;
    const configured = await post(
      {
        action: "configure",
        spreadsheetId: chosen.id,
        spreadsheetName: chosen.name,
        sheetTitle: tab.title,
      },
      "configure",
    );
    if (!configured) return;
    setPickerOpen(false);
    // Configuring without syncing would leave the creator staring at a
    // connected-but-empty state, so pull the data immediately.
    await sync(false);
  }

  async function sync(refreshImages: boolean) {
    const data = await post({ action: "sync", refreshImages }, "sync");
    if (data?.ok) {
      const s = data.stats as MenuSource["stats"];
      toast(`${s.items} items · ${s.categories} categories`);
      setNotice(
        data.republished
          ? "Menu synchronised and the live site updated."
          : "Menu synchronised.",
      );
    }
  }

  const findings = source?.findings ?? [];
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const stats = source?.stats;
  const connected = Boolean(source?.spreadsheet_id);

  return (
    <AppShell>
      <AppBar title="Digital Menu Data" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}

      {/* ------------------------------ status ------------------------------ */}
      <Card className="my-4">
        <h2 className="flex items-center gap-2 font-bold">
          <span aria-hidden="true">🍽️</span> Menu data source
        </h2>

        {!google.configured ? (
          <p className="mt-2 text-sm text-muted">
            Google is not configured on this server. Whoever runs the app needs
            to set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>.
          </p>
        ) : !google.connected ? (
          <>
            <p className="mt-2 text-sm text-muted">
              Connect the Google account that owns your menu spreadsheet. The
              app only ever reads — it never edits your Sheets or Drive.
            </p>
            <Button
              size="lg"
              block
              className="mt-3"
              loading={busy === "connect"}
              onClick={connectGoogle}
            >
              Connect Google Sheets
            </Button>
            {awaitingConsent && (
              <p className="mt-2 text-xs text-muted">
                Finish signing in with Google in your browser, then come back —
                this will pick it up automatically.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
              />
              <span className="font-semibold">{connected ? "Connected" : "Not connected"}</span>
              {google.email && <span className="truncate text-muted">· {google.email}</span>}
            </p>

            {connected && (
              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-muted">Spreadsheet</dt>
                  <dd className="min-w-0 flex-1 truncate font-medium">
                    {source?.spreadsheet_name || source?.spreadsheet_id}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted">Sheet</dt>
                  <dd className="min-w-0 flex-1 truncate font-medium">{source?.sheet_title}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted">Last synced</dt>
                  <dd className="min-w-0 flex-1 font-medium">
                    {relativeTime(source?.last_sync_at ?? 0)}
                  </dd>
                </div>
              </dl>
            )}

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <Button
                size="lg"
                block
                loading={busy === "sync"}
                disabled={!connected}
                onClick={() => sync(false)}
              >
                🔄 Sync now
              </Button>
              <Button variant="secondary" size="lg" block onClick={openPicker}>
                <IconSettings size={18} /> {connected ? "Configure" : "Choose spreadsheet"}
              </Button>
            </div>

            {connected && (
              <button
                type="button"
                onClick={() => sync(true)}
                disabled={Boolean(busy)}
                className="mt-2 flex min-h-[var(--spacing-touch)] w-full items-center justify-center rounded-lg text-xs font-semibold text-muted active:bg-elevated disabled:opacity-50"
              >
                Sync and re-download all images
              </button>
            )}
          </>
        )}
      </Card>

      {/* ------------------------------ results ----------------------------- */}
      {stats && source?.last_sync_at ? (
        <Card className="my-4">
          <h2 className="flex items-center gap-2 font-bold text-success">
            <IconCheck size={18} /> Last synchronisation
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <Stat label="Menu items" value={stats.items} />
            <Stat label="Categories" value={stats.categories} />
            <Stat label="Images resolved" value={stats.imagesResolved} />
            <Stat
              label="Rows skipped"
              value={stats.rowsRejected}
              tone={stats.rowsRejected ? "warn" : undefined}
            />
          </ul>
          <p className="mt-3 text-xs text-muted">
            {new Date(source.last_sync_at).toLocaleString()}
          </p>
        </Card>
      ) : null}

      {source?.last_error && (
        <Card className="my-4 border-danger/40">
          <h2 className="flex items-center gap-2 font-bold text-danger">
            <IconAlert size={18} /> Unable to synchronise menu
          </h2>
          <p className="mt-2 text-sm">{source.last_error}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
            <li>Google account connection</li>
            <li>Spreadsheet permissions</li>
            <li>Spreadsheet selection</li>
            <li>Required columns</li>
          </ul>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <Button size="lg" block loading={busy === "sync"} onClick={() => sync(false)}>
              Retry
            </Button>
            <Button variant="secondary" size="lg" block onClick={openPicker}>
              Connection settings
            </Button>
          </div>
        </Card>
      )}

      {errors.length > 0 && (
        <Card className="my-4 border-danger/40">
          <h2 className="font-bold text-danger">
            {errors.length} problem{errors.length === 1 ? "" : "s"} in the spreadsheet
          </h2>
          <ul className="mt-2 space-y-2">
            {errors.slice(0, 25).map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
          </ul>
        </Card>
      )}

      {warnings.length > 0 && (
        <Card className="my-4">
          <h2 className="font-bold text-warning">
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} to check
          </h2>
          <ul className="mt-2 space-y-2">
            {warnings.slice(0, 25).map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
          </ul>
        </Card>
      )}

      {/* --------------------------- the contract --------------------------- */}
      <Card className="my-4">
        <h2 className="font-bold">Required columns</h2>
        <p className="mt-1.5 text-sm text-muted">
          Row 1 of your sheet must contain exactly these headers. Every row below
          it is one menu item.
        </p>
        <div className="snap-rail no-scrollbar -mx-4 mt-3 px-4 pb-1">
          {REQUIRED.map((c) => (
            <code
              key={c}
              className="flex min-h-[var(--spacing-touch)] items-center whitespace-nowrap rounded-lg border border-line bg-elevated px-3 text-sm"
            >
              {c}
            </code>
          ))}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <code>chefs choice</code> is a checkbox. Ticked items get a
            Chef&apos;s Choice badge; customers never see TRUE or FALSE.
          </li>
          <li>
            <code>category</code> groups the menu. Use a dropdown for
            consistency — only categories with items are shown.
          </li>
          <li>
            <code>imageurl</code> takes a Google Drive link. Images are fetched
            once and served from your site, not hot-linked from Drive.
          </li>
        </ul>
      </Card>

      {google.connected && (
        <Card className="my-4">
          <h2 className="font-bold">Google account</h2>
          <p className="mt-1.5 text-sm text-muted">
            Connected as {google.email || "your Google account"}. Read-only
            access to Sheets and Drive.
          </p>
          <Button
            variant="secondary"
            block
            className="mt-3"
            loading={busy === "disconnect"}
            onClick={async () => {
              setBusy("disconnect");
              await fetch("/api/google/disconnect", { method: "POST" });
              setBusy("");
              await reload();
              toast("Google disconnected");
            }}
          >
            Disconnect Google
          </Button>
        </Card>
      )}

      {/* ---------------------------- the picker ---------------------------- */}
      <BottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={chosen ? "Choose a sheet" : "Choose a spreadsheet"}
      >
        {!chosen ? (
          <div className="pb-4">
            <div className="mb-3 flex gap-2">
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your spreadsheets"
                aria-label="Search your spreadsheets"
                enterKeyHint="search"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadSheets(search);
                }}
              />
              <Button variant="secondary" onClick={() => loadSheets(search)} loading={busy === "sheets"}>
                Search
              </Button>
            </div>
            {sheets.length === 0 && busy !== "sheets" && (
              <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
                No spreadsheets found in the connected account.
              </p>
            )}
            <div className="grid gap-2">
              {sheets.map((sheet) => (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => chooseSheet(sheet)}
                  className="flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border border-line px-4 text-left active:bg-elevated"
                >
                  <span aria-hidden="true">📊</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{sheet.name}</span>
                    <span className="block text-xs text-muted">
                      {sheet.modifiedTime ? new Date(sheet.modifiedTime).toLocaleDateString() : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pb-4">
            <p className="mb-3 truncate text-sm text-muted">{chosen.name}</p>
            <div className="grid gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.sheetId}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => useTab(tab)}
                  className="flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border border-line px-4 text-left active:bg-elevated disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{tab.title}</span>
                  <span className="shrink-0 text-xs text-muted">{tab.rowCount} rows</span>
                </button>
              ))}
            </div>
            <Button variant="secondary" block className="mt-3" onClick={() => setChosen(null)}>
              Back to spreadsheets
            </Button>
          </div>
        )}
      </BottomSheet>

      {toastNode}
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <li className="rounded-xl bg-elevated p-3">
      <span className={`block text-xl font-bold tabular-nums ${tone === "warn" && value ? "text-warning" : ""}`}>
        {value}
      </span>
      <span className="block text-xs text-muted">{label}</span>
    </li>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="rounded-xl border border-line p-3 text-sm">
      <p className="font-semibold">
        {finding.row ? `Row ${finding.row}` : "Spreadsheet"}
        {finding.column ? ` · ${finding.column}` : ""}
      </p>
      <p className="mt-0.5 text-muted">{finding.message}</p>
    </li>
  );
}
