"use client";

import { useState } from "react";
import { Card, Field, TextArea, TextInput } from "./ui";
import { localeInfo, type Locale } from "@/lib/locales";
import type { Site } from "@/lib/site";

/**
 * The two lines a search result and a shared link actually show.
 *
 * They are generated from verified research and are usually right, but they
 * are also the only part of a website a business owner tends to have a firm
 * opinion about — and until now they were the one field the editor could not
 * reach. Editing them is per-language, because they live in the same per-locale
 * catalog as the rest of the copy.
 *
 * The character counts are advisory, not enforced. A title of 64 characters is
 * a search result that gets clipped, not an error, and the readiness checklist
 * is where that judgement belongs.
 */

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 155;

function Counter({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={`text-xs tabular-nums ${over ? "font-semibold text-warning" : "text-muted"}`}>
      {value.length}/{limit}
      {over ? " — will be cut in a search result" : ""}
    </span>
  );
}

export function SeoFields({
  site,
  locale,
  onChange,
  onCommit,
}: {
  site: Site;
  locale: Locale;
  /** Every keystroke, so the draft stays in the caller's document. */
  onChange: (next: Site) => void;
  /** On blur, when a field is finished — saving per keystroke would be absurd. */
  onCommit: () => void;
}) {
  const catalog = site.i18n[locale];
  const seo = catalog?.seo;
  const [open, setOpen] = useState(false);
  if (!catalog || !seo) return null;

  const set = (field: "title" | "description", value: string) => {
    onChange({
      ...site,
      i18n: {
        ...site.i18n,
        [locale]: {
          ...catalog,
          seo: {
            ...seo,
            [field]: value,
            // The social preview follows the page unless someone has set it to
            // something else on purpose.
            ...(field === "title" && seo.ogTitle === seo.title ? { ogTitle: value } : {}),
            ...(field === "description" && seo.ogDescription === seo.description
              ? { ogDescription: value }
              : {}),
          },
        },
      },
    });
  };

  return (
    <Card className="my-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        data-seo-toggle
        className="flex min-h-[var(--spacing-touch)] w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">
            How this page looks in Google
          </span>
          <span className="block truncate text-xs text-muted">
            {seo.title || "No title set"}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="mt-3 border-t border-line pt-3">
          {site.meta.locales.length > 1 && (
            <p className="mb-2 text-xs text-muted">
              Editing the {localeInfo(locale).english} version.
            </p>
          )}

          <Field label="Page title" hint="What a search result shows as the headline.">
            {({ id }) => (
              <TextInput
                id={id}
                value={seo.title}
                data-seo-title
                onChange={(e) => set("title", e.target.value)}
                onBlur={onCommit}
              />
            )}
          </Field>
          <Counter value={seo.title} limit={TITLE_LIMIT} />

          <div className="mt-3">
            <Field label="Description" hint="The sentence underneath it.">
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={3}
                  value={seo.description}
                  data-seo-description
                  onChange={(e) => set("description", e.target.value)}
                  onBlur={onCommit}
                />
              )}
            </Field>
            <Counter value={seo.description} limit={DESCRIPTION_LIMIT} />
          </div>

          {/* What they are editing, drawn the way it will be seen. */}
          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="text-[0.6875rem] uppercase tracking-wide text-muted">Preview</p>
            <p className="mt-1 truncate text-sm font-semibold text-brand">
              {seo.title || site.meta.businessName}
            </p>
            <p className="line-clamp-2 text-xs text-muted">
              {seo.description || "No description yet."}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
