"use client";

import { useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, BottomSheet, Button, Card, useToast } from "./ui";
import { IconCheck, IconPlus, IconTrash } from "./icons";
import { LOCALES, localeInfo, type Locale } from "@/lib/locales";
import { missingKeys, type Site } from "@/lib/site";

/**
 * Creator-side language configuration (requirements 9, 17, 18).
 *
 * The screen is explicit about the distinction the requirements draw: what is
 * configured here is which languages exist; the *visitor's* switcher appears
 * on the generated website automatically once there are two or more.
 */
export function LanguageManager({
  projectId,
  businessName,
  initialSite,
}: {
  projectId: string;
  businessName: string;
  initialSite: Site;
}) {
  const [site, setSite] = useState<Site>(initialSite);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Locale | null>(null);
  const { toast, toastNode } = useToast();

  const enabled = site.meta.locales;
  const available = LOCALES.filter((l) => !enabled.includes(l.code));

  async function call(action: string, locale: Locale, message: string) {
    setBusy(`${action}:${locale}`);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/languages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, locale }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return false;
      }
      setSite(data.site as Site);
      toast(message);
      return true;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setBusy("");
    }
  }

  return (
    <AppShell>
      <AppBar title="Languages" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      <Card className="my-4">
        <p className="text-sm text-muted">
          {enabled.length > 1 ? (
            <>
              Your website shows a language switcher to visitors, because more
              than one language is enabled. Switching language changes the real
              content — the design stays exactly the same.
            </>
          ) : (
            <>
              Only one language is enabled, so no language switcher is shown on
              the website. Add a second language and one appears automatically.
            </>
          )}
        </p>
      </Card>

      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
        Enabled languages
      </h2>
      <ul className="space-y-2.5">
        {enabled.map((code) => {
          const info = localeInfo(code);
          const isDefault = code === site.meta.defaultLocale;
          const missing = isDefault ? 0 : missingKeys(site, code).length;
          return (
            <li key={code}>
              <Card>
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="text-2xl">{info.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {info.english}
                      <span className="ml-2 text-sm font-normal text-muted">{info.native}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {isDefault
                        ? "Default language"
                        : missing > 0
                          ? `${missing} item${missing === 1 ? "" : "s"} not translated`
                          : "Fully translated"}
                    </p>
                  </div>
                  {isDefault && (
                    <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
                      Default
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!isDefault && (
                    <>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        loading={busy === `retranslate:${code}`}
                        onClick={() => call("retranslate", code, `${info.english} updated`)}
                      >
                        {missing > 0 ? "Translate missing" : "Re-translate"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        loading={busy === `setDefault:${code}`}
                        onClick={() => call("setDefault", code, `${info.english} is now the default`)}
                      >
                        Make default
                      </Button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(code)}
                        aria-label={`Remove ${info.english}`}
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elevated"
                      >
                        <IconTrash size={18} />
                      </button>
                    </>
                  )}
                  {isDefault && enabled.length > 1 && (
                    <p className="text-xs text-muted">
                      Other languages fall back to this one where a translation
                      is missing.
                    </p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Button size="lg" block className="mt-4" onClick={() => setAddOpen(true)}>
        <IconPlus size={20} /> Add a language
      </Button>

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title="Add a language">
        <p className="mb-3 text-sm text-muted">
          Your existing content is translated. The design, layout and structure
          stay exactly as they are.
        </p>
        <div className="grid gap-2 pb-4">
          {available.map((l) => (
            <button
              key={l.code}
              type="button"
              disabled={Boolean(busy)}
              onClick={async () => {
                const ok = await call("add", l.code, `${l.english} added`);
                if (ok) setAddOpen(false);
              }}
              className="flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border border-line px-4 text-left active:bg-elevated disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-xl">{l.flag}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{l.english}</span>
                <span className="block text-sm text-muted">{l.native}</span>
              </span>
              {busy === `add:${l.code}` && (
                <span
                  aria-hidden="true"
                  className="size-4 rounded-full border-2 border-current border-t-transparent"
                  style={{ animation: "spin .7s linear infinite" }}
                />
              )}
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        title="Remove this language?"
        footer={
          <div className="flex gap-2.5">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirmRemove(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              loading={Boolean(busy)}
              onClick={async () => {
                if (!confirmRemove) return;
                await call("remove", confirmRemove, `${localeInfo(confirmRemove).english} removed`);
                setConfirmRemove(null);
              }}
            >
              Remove
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-sm text-muted">
          The {confirmRemove ? localeInfo(confirmRemove).english : ""} translation is deleted and
          that language disappears from the website's switcher. Every other
          language, and the design, are untouched.
          {enabled.length === 2 && " With one language left, the switcher is hidden entirely."}
        </p>
      </BottomSheet>

      <Card className="mt-6">
        <h2 className="flex items-center gap-2 font-bold">
          <IconCheck size={18} /> What visitors get
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>A language switcher in the header, styled to match the design</li>
          <li>A separate page per language, each with its own URL and metadata</li>
          <li>Correct <code>lang</code>, canonical and <code>hreflang</code> tags for search engines</li>
          <li>Their choice remembered when they come back</li>
        </ul>
      </Card>

      {toastNode}
    </AppShell>
  );
}
