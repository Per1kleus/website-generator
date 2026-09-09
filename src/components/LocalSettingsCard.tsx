"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Card, Field, TextInput } from "./ui";

type Setting = {
  key: string;
  configured: boolean;
  hint: string;
  fromEnvironment: boolean;
};

/**
 * Where a desktop user puts their own keys.
 *
 * The promise of the downloadable application is that nobody opens a terminal,
 * so the one thing a hosted deployment gets from environment variables has to
 * have a home in the interface. It appears only when the app is running as a
 * desktop application; on a hosted deployment /api/settings answers 404 and
 * this card renders nothing.
 *
 * Values are write-only. What comes back is whether a key is set and its last
 * four characters, which is enough to recognise a key and useless to a thief.
 */
const FIELDS: { key: string; label: string; hint: string; placeholder: string }[] = [
  {
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    hint: "Turns on business research, written copy and translation. The app works without it.",
    placeholder: "sk-ant-…",
  },
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google client ID",
    hint: "Needed only to build a digital menu from a Google Sheet. Create a Desktop app client — it has no secret.",
    placeholder: "…apps.googleusercontent.com",
  },
  {
    key: "OLLAMA_HOST",
    label: "Ollama address",
    hint: "Leave blank unless Ollama runs somewhere other than this computer.",
    placeholder: "http://127.0.0.1:11434",
  },
];

export function LocalSettingsCard() {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return; // 404 on a hosted deployment: the card stays hidden.
      const data = (await res.json()) as { settings: Setting[] };
      setSettings(data.settings);
    } catch {
      /* informational only */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return null;

  const status = (key: string) => settings.find((s) => s.key === key);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSettings(data.settings as Setting[]);
      setDraft({});
      setSaved(true);
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="font-bold">Keys on this computer</h2>
      <p className="mt-1.5 mb-4 text-sm text-muted">
        These stay on this computer, encrypted in your own profile. They are
        never sent anywhere except to the service they belong to, and they are
        not part of the app you downloaded.
      </p>

      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">Saved.</Banner>}

      {FIELDS.map((field) => {
        const current = status(field.key);
        return (
          <Field
            key={field.key}
            label={field.label}
            hint={
              current?.fromEnvironment
                ? `Set when the app was launched (${current.hint}). Change it there, not here.`
                : current?.configured
                  ? `Saved: ${current.hint}. Type a new value to replace it, or clear the box to remove it.`
                  : field.hint
            }
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                type={field.key === "OLLAMA_HOST" ? "url" : "password"}
                autoComplete="off"
                spellCheck={false}
                disabled={current?.fromEnvironment}
                placeholder={field.placeholder}
                value={draft[field.key] ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [field.key]: e.target.value }))
                }
              />
            )}
          </Field>
        );
      })}

      <Button block onClick={save} loading={busy} disabled={Object.keys(draft).length === 0}>
        Save keys
      </Button>
    </Card>
  );
}
