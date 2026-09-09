"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Card } from "./ui";
import { IconCheck, IconSparkles } from "./icons";

type Setup = {
  skill: { available: boolean; name: string };
  ollama: {
    available: boolean;
    modelReady: boolean;
    model: string;
    host: string;
    pull: { status: string; percent: number; error: string | null } | null;
    autopull: boolean;
  };
};

/**
 * Shows which tier of design intelligence is actually running.
 *
 * Three independent layers, and the app is explicit about which are on rather
 * than implying more than it has:
 *
 *   ui-ux-pro-max   the design catalogue — vendored, always available
 *   local model     writes the catalogue query — optional, via Ollama
 *   hosted model    research, copy, translation — optional, via API key
 */
export function DesignEngineCard() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/setup", { cache: "no-store" });
      if (res.ok) setSetup((await res.json()) as Setup);
    } catch {
      /* the card is informational; a failed probe just leaves it blank */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a model is downloading, poll so the creator sees it progress.
  const downloading = setup?.ollama.pull?.status
    ? !["ready", "failed"].includes(setup.ollama.pull.status)
    : false;

  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [downloading, load]);

  if (!setup) return null;

  async function install() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start the download.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const { skill, ollama } = setup;
  const pull = ollama.pull;

  return (
    <Card className="mt-4">
      <h2 className="flex items-center gap-2 font-bold">
        <IconSparkles size={18} /> Design engine
      </h2>

      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <ul className="mt-3 space-y-2.5">
        <li className="flex items-start gap-2.5">
          <Dot on={skill.available} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Design catalogue</span>
            <span className="block text-xs text-muted">
              {skill.available
                ? "ui-ux-pro-max — 79 UI styles, colour systems, font pairings and landing patterns."
                : "ui-ux-pro-max needs Python 3 on the server. Designs fall back to built-in presets."}
            </span>
          </span>
        </li>

        <li className="flex items-start gap-2.5">
          <Dot on={ollama.available && ollama.modelReady} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Local design model</span>
            <span className="block text-xs text-muted">
              {!ollama.available ? (
                <>
                  Ollama is not running. It is optional — without it the
                  catalogue is queried with a built-in rule set instead. Install
                  it from ollama.com to let a small local model write the query.
                </>
              ) : ollama.modelReady ? (
                <>
                  {ollama.model} is installed and writing the catalogue queries.
                </>
              ) : downloading ? (
                <>
                  Downloading {ollama.model} — {pull?.status}
                  {pull?.percent ? ` ${pull.percent}%` : ""}
                </>
              ) : pull?.status === "failed" ? (
                <>Download failed: {pull.error}</>
              ) : (
                <>Ollama is running but {ollama.model} is not installed yet.</>
              )}
            </span>
          </span>
        </li>
      </ul>

      {downloading && (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pull?.percent ?? 0}
          aria-label={`Downloading ${ollama.model}`}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${pull?.percent ?? 0}%` }}
          />
        </div>
      )}

      {ollama.available && !ollama.modelReady && !downloading && (
        <Button block className="mt-3" loading={busy} onClick={install}>
          Install {ollama.model}
        </Button>
      )}

      <p className="mt-3 text-xs text-muted">
        Websites are generated with whatever is available — none of this is
        required.
      </p>
    </Card>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] ${
        on ? "bg-success text-white" : "border border-line text-muted"
      }`}
    >
      {on ? <IconCheck size={12} /> : "○"}
    </span>
  );
}
