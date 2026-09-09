"use client";

import { localeInfo, type Locale } from "@/lib/locales";

/**
 * Creator-side language selector (requirement 9).
 *
 * This is not the visitor's switcher — it chooses which language's *text* the
 * creator is editing. The distinction matters enough that the label says so.
 * A locale with untranslated strings carries a count, so it is obvious which
 * language still needs attention.
 */
export function LocaleTabs({
  locales,
  defaultLocale,
  value,
  onChange,
  missingCount,
}: {
  locales: Locale[];
  defaultLocale: Locale;
  value: Locale;
  onChange: (locale: Locale) => void;
  missingCount?: (locale: Locale) => number;
}) {
  if (locales.length < 2) return null;

  return (
    <div className="my-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Editing language
      </p>
      <div role="tablist" aria-label="Editing language" className="snap-rail no-scrollbar -mx-4 px-4 pb-1">
        {locales.map((l) => {
          const info = localeInfo(l);
          const active = l === value;
          const missing = missingCount?.(l) ?? 0;
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(l)}
              className={`flex min-h-[var(--spacing-touch)] items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
                active ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted"
              }`}
            >
              <span aria-hidden="true">{info.flag}</span>
              {info.english}
              {l === defaultLocale && (
                <span className="rounded-full bg-elevated px-1.5 py-0.5 text-[0.625rem] font-bold uppercase text-muted">
                  Default
                </span>
              )}
              {missing > 0 && (
                <span
                  className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[0.625rem] font-bold text-warning"
                  title={`${missing} untranslated`}
                >
                  {missing}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
