"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Card } from "./ui";
import { IconCheck, IconRefresh } from "./icons";

/**
 * What this installation has, and a way to repair what it does not.
 *
 * The distinction this card exists to keep honest is the one the setup itself
 * rests on: a component is ready when its underlying resource has been checked,
 * not when a screen has claimed it. So every line here comes from a live check —
 * files on disk, the local daemon answering, the design catalogue actually
 * returning a design system — and "Installed" and "Answering" are different
 * words because they are different facts.
 *
 * No paths, no stack traces, no component names from the code. A person reading
 * this should learn what is wrong and what pressing the button will do.
 */

type Component = {
  id: string;
  label: string;
  status: string;
  detail: string;
  blocking: boolean;
};

type Skill = {
  id: string;
  label: string;
  required: number;
  installed: number;
  verified: boolean;
  source: string;
};

type Readiness = {
  recorded: { status: string; completedAt: number | null; degraded: string[] } | null;
  components: Component[];
  skills: Skill[];
  model: { required: string; installed: boolean; verified: boolean };
  ready: boolean;
};

export function RepairCard() {
  const [report, setReport] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ actions: string[]; advice: string[] } | null>(null);

  const load = useCallback(async (verify = false) => {
    try {
      const res = await fetch(`/api/setup?readiness=1${verify ? "&verify=1" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { readiness?: Readiness };
      if (data.readiness) setReport(data.readiness);
    } catch {
      /* informational: a failed probe leaves the card as it was */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!report) return null;

  async function check() {
    setBusy("check");
    setError("");
    setOutcome(null);
    // With verification: this is the button a person presses when they want to
    // know whether it really works, so it loads the model and asks it.
    await load(true);
    setBusy("");
  }

  async function runRepair() {
    setBusy("repair");
    setError("");
    setOutcome(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair" }),
      });
      const data = (await res.json()) as {
        actions?: string[];
        advice?: string[];
        report?: Readiness;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return;
      }
      setOutcome({ actions: data.actions ?? [], advice: data.advice ?? [] });
      if (data.report) setReport(data.report);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  const needsAttention = report.components.filter((c) => c.blocking);

  return (
    <Card className="mt-4">
      <h2 className="flex items-center gap-2 font-bold">
        <IconRefresh size={18} /> Installation
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {report.ready
          ? "Everything this application needs is installed."
          : "Something this application needs is missing. Repairing installs only the missing parts."}
      </p>

      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
      {needsAttention.length > 0 && (
        <div className="mt-3">
          <Banner tone="warning">{needsAttention[0].detail}</Banner>
        </div>
      )}

      <ul className="mt-3 space-y-2.5" data-readiness>
        {report.components.map((component) => (
          <li
            key={component.id}
            className="flex items-start gap-2.5"
            data-component={component.id}
            data-component-status={component.status}
          >
            <Mark ok={component.status === "completed"} warn={component.blocking} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{component.label}</span>
              <span className="block text-xs text-muted">{component.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {report.skills.length > 0 && (
        <ul className="mt-3 border-t border-line pt-3 space-y-1.5">
          {report.skills.map((skill) => (
            <li key={skill.id} className="text-xs text-muted" data-skill={skill.id}>
              <span className="font-semibold text-ink">{skill.label}</span> ·{" "}
              {skill.installed} of {skill.required} files
              {skill.verified ? " · answering" : ""}
            </li>
          ))}
        </ul>
      )}

      {outcome && (
        <div className="mt-3 border-t border-line pt-3">
          {outcome.actions.map((line) => (
            <p key={line} className="text-xs text-muted">
              {line}
            </p>
          ))}
          {outcome.advice.map((line) => (
            <p key={line} className="mt-1 text-xs text-warning">
              {line}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === "check"} onClick={check} data-check-installation>
          Check installation
        </Button>
        <Button
          variant="secondary"
          loading={busy === "repair"}
          onClick={runRepair}
          data-repair-installation
        >
          Repair installation
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Repairing never removes anything that is working, and never downloads
        anything that is already here.
      </p>
    </Card>
  );
}

function Mark({ ok, warn }: { ok: boolean; warn: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] ${
        ok
          ? "bg-success text-white"
          : warn
            ? "bg-warning text-white"
            : "border border-line text-muted"
      }`}
    >
      {ok ? <IconCheck size={12} /> : warn ? "!" : "○"}
    </span>
  );
}
