"use client";

import { useState } from "react";
import { BottomSheet, Button, Field, Select, TextArea, TextInput } from "./ui";
import { IconPlus, IconSparkles, IconTrash } from "./icons";
import type { AssetRef } from "./SectionEditor";
import { localeInfo, type Locale } from "@/lib/locales";
import { key, newId, SECTION_LABELS, type Section, type Site } from "@/lib/site";

/**
 * Per-section editing (requirements 7 and 25).
 *
 * Two kinds of field live side by side here and are deliberately kept apart:
 *
 *   text        edited for the language currently selected, written to the
 *               i18n catalog for that locale only
 *   structural  prices, links, phone numbers, image ids — shared by every
 *               language and marked as such in the UI
 *
 * That distinction is what stops a creator "translating" a price, and what
 * lets them fix the English copy without disturbing the Greek.
 */
export function SectionSheet({
  site,
  section,
  locale,
  assets,
  onClose,
  onSave,
  onAskAi,
}: {
  site: Site;
  section: Section;
  locale: Locale;
  assets: AssetRef[];
  onClose: () => void;
  onSave: (next: { section: Section; strings: Record<string, string> }) => void;
  onAskAi: () => void;
}) {
  const [draft, setDraft] = useState<Section>(() => structuredClone(section));
  // Edits accumulate against the selected locale's catalog only.
  const [strings, setStrings] = useState<Record<string, string>>(() => {
    const catalog = site.i18n[locale]?.strings ?? {};
    const fallback = site.i18n[site.meta.defaultLocale]?.strings ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(catalog)) if (k.startsWith(`${section.id}.`)) out[k] = v;
    // Show the default-language text as a starting point where a translation
    // is missing, rather than an empty box.
    for (const [k, v] of Object.entries(fallback)) {
      if (k.startsWith(`${section.id}.`) && out[k] === undefined) out[k] = v;
    }
    return out;
  });

  const get = (k: string) => strings[k] ?? "";
  const set = (k: string, v: string) => setStrings((s) => ({ ...s, [k]: v }));

  const sk = (field: string) => key.section(section.id, field);
  const rk = (rowId: string, field: string) => key.row(section.id, rowId, field);

  const info = localeInfo(locale);
  const isTranslation = locale !== site.meta.defaultLocale;

  /** Structural fields are shared across languages; say so, once. */
  const SharedNote = () => (
    <p className="mb-4 rounded-xl bg-elevated px-3 py-2 text-xs text-muted">
      Prices, links and images below are shared by every language.
    </p>
  );

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`Edit ${SECTION_LABELS[section.type].toLowerCase()}`}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" onClick={onAskAi} className="shrink-0">
            <IconSparkles size={18} />
            <span className="sr-only">Ask AI instead</span>
          </Button>
          <Button size="lg" block onClick={() => onSave({ section: draft, strings })}>
            Save
          </Button>
        </div>
      }
    >
      {site.meta.locales.length > 1 && (
        <p className="mb-4 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-brand">
          Editing the {info.english} text. Other languages are untouched.
        </p>
      )}

      <Field label="Section name" hint="Shown in the website's navigation.">
        {({ id }) => (
          <TextInput id={id} value={get(sk("title"))} onChange={(e) => set(sk("title"), e.target.value)} autoCapitalize="words" />
        )}
      </Field>

      {draft.type === "hero" && (
        <>
          <Field label="Eyebrow" hint="Small line above the headline. Optional.">
            {({ id }) => <TextInput id={id} value={get(sk("eyebrow"))} onChange={(e) => set(sk("eyebrow"), e.target.value)} />}
          </Field>
          <Field label="Headline" hint="Keep it under 8 words so it fits a phone.">
            {({ id }) => <TextArea id={id} rows={2} value={get(sk("headline"))} onChange={(e) => set(sk("headline"), e.target.value)} />}
          </Field>
          <Field label="Subheadline">
            {({ id }) => <TextArea id={id} rows={3} value={get(sk("subheadline"))} onChange={(e) => set(sk("subheadline"), e.target.value)} />}
          </Field>
          <Field label="Button label">
            {({ id }) => <TextInput id={id} value={get(sk("ctaLabel"))} onChange={(e) => set(sk("ctaLabel"), e.target.value)} />}
          </Field>
          <SharedNote />
          <Field label="Button link" hint="A web address, tel: number, or mailto: address.">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.ctaHref}
                onChange={(e) => setDraft({ ...draft, ctaHref: e.target.value })} />
            )}
          </Field>
          <ImagePicker label="Hero image" assets={assets} value={draft.imageId}
            onChange={(v) => setDraft({ ...draft, imageId: v })} />
        </>
      )}

      {draft.type === "about" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <Field label="Text" hint="Leave a blank line between paragraphs.">
            {({ id }) => <TextArea id={id} rows={7} value={get(sk("body"))} onChange={(e) => set(sk("body"), e.target.value)} autoCapitalize="sentences" />}
          </Field>
          <RowEditor
            label="Highlights"
            rows={draft.highlights}
            onAdd={() => setDraft({ ...draft, highlights: [...draft.highlights, { id: newId("hl") }] })}
            onRemove={(rowId) => setDraft({ ...draft, highlights: draft.highlights.filter((h) => h.id !== rowId) })}
            render={(row) => (
              <TextInput value={get(rk(row.id, "text"))} onChange={(e) => set(rk(row.id, "text"), e.target.value)}
                aria-label="Highlight" placeholder="Independent and local" />
            )}
          />
          <SharedNote />
          <ImagePicker label="Image" assets={assets} value={draft.imageId}
            onChange={(v) => setDraft({ ...draft, imageId: v })} />
        </>
      )}

      {draft.type === "services" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <Field label="Intro">
            {({ id }) => <TextArea id={id} rows={2} value={get(sk("intro"))} onChange={(e) => set(sk("intro"), e.target.value)} />}
          </Field>
          <RowEditor
            label="Services"
            rows={draft.items}
            onAdd={() => setDraft({ ...draft, items: [...draft.items, { id: newId("svc"), price: "" }] })}
            onRemove={(rowId) => setDraft({ ...draft, items: draft.items.filter((i) => i.id !== rowId) })}
            render={(row) => (
              <div className="space-y-2">
                <TextInput value={get(rk(row.id, "name"))} onChange={(e) => set(rk(row.id, "name"), e.target.value)}
                  aria-label="Service name" placeholder="Service name" />
                <TextArea rows={2} value={get(rk(row.id, "description"))} onChange={(e) => set(rk(row.id, "description"), e.target.value)}
                  aria-label="Description" placeholder="Short description" />
                <TextInput value={row.price} aria-label="Price (shared by all languages)" placeholder="Price — shared by all languages"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((i) => (i.id === row.id ? { ...i, price: e.target.value } : i)),
                    })
                  } />
              </div>
            )}
          />
        </>
      )}

      {draft.type === "menu" && (
        <MenuEditor
          section={draft}
          get={get}
          set={set}
          sk={sk}
          onChange={(next) => setDraft(next)}
        />
      )}

      {draft.type === "gallery" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <GalleryPicker
            assets={assets}
            selected={draft.imageIds}
            onChange={(v) => setDraft({ ...draft, imageIds: v })}
          />
          {draft.imageIds.length > 0 && (
            <fieldset className="mb-4">
              <legend className="mb-1.5 text-sm font-semibold">
                Alt text{isTranslation ? ` (${info.english})` : ""}
              </legend>
              <p className="mb-2 text-xs text-muted">
                Describes each photo for screen readers. Translated per language.
              </p>
              <div className="space-y-2">
                {draft.imageIds.map((imgId) => (
                  <TextInput key={imgId} value={get(rk(imgId, "alt"))}
                    onChange={(e) => set(rk(imgId, "alt"), e.target.value)}
                    aria-label={`Alt text for ${assets.find((a) => a.id === imgId)?.filename ?? "image"}`}
                    placeholder="The terrace at sunset" />
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      {draft.type === "hours" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <RowEditor
            label="Days"
            rows={draft.rows}
            onAdd={() => setDraft({ ...draft, rows: [...draft.rows, { id: newId("day"), hours: "" }] })}
            onRemove={(rowId) => setDraft({ ...draft, rows: draft.rows.filter((r) => r.id !== rowId) })}
            render={(row) => (
              <div className="flex gap-2">
                <TextInput value={get(rk(row.id, "day"))} onChange={(e) => set(rk(row.id, "day"), e.target.value)}
                  aria-label="Day" placeholder="Monday" />
                <TextInput value={row.hours} aria-label="Hours (shared by all languages)" placeholder="9:00 – 18:00"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      rows: draft.rows.map((r) => (r.id === row.id ? { ...r, hours: e.target.value } : r)),
                    })
                  } />
              </div>
            )}
          />
          <Field label="Note">
            {({ id }) => <TextInput id={id} value={get(sk("note"))} onChange={(e) => set(sk("note"), e.target.value)} />}
          </Field>
        </>
      )}

      {draft.type === "testimonials" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <RowEditor
            label="Quotes"
            rows={draft.items}
            onAdd={() => setDraft({ ...draft, items: [...draft.items, { id: newId("tst") }] })}
            onRemove={(rowId) => setDraft({ ...draft, items: draft.items.filter((i) => i.id !== rowId) })}
            render={(row) => (
              <div className="space-y-2">
                <TextArea rows={3} value={get(rk(row.id, "quote"))} onChange={(e) => set(rk(row.id, "quote"), e.target.value)}
                  aria-label="Quote" placeholder="What they said" />
                <TextInput value={get(rk(row.id, "author"))} onChange={(e) => set(rk(row.id, "author"), e.target.value)}
                  aria-label="Who said it" placeholder="A regular" />
              </div>
            )}
          />
        </>
      )}

      {draft.type === "cta" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <Field label="Text">
            {({ id }) => <TextArea id={id} rows={2} value={get(sk("body"))} onChange={(e) => set(sk("body"), e.target.value)} />}
          </Field>
          <Field label="Button label">
            {({ id }) => <TextInput id={id} value={get(sk("ctaLabel"))} onChange={(e) => set(sk("ctaLabel"), e.target.value)} />}
          </Field>
          <SharedNote />
          <Field label="Button link">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.ctaHref} onChange={(e) => setDraft({ ...draft, ctaHref: e.target.value })} />
            )}
          </Field>
        </>
      )}

      {draft.type === "contact" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
          </Field>
          <Field label="Address">
            {({ id }) => <TextArea id={id} rows={2} value={get(sk("address"))} onChange={(e) => set(sk("address"), e.target.value)} />}
          </Field>
          <Field label="Booking button label">
            {({ id }) => <TextInput id={id} value={get(sk("bookingLabel"))} onChange={(e) => set(sk("bookingLabel"), e.target.value)} />}
          </Field>
          <SharedNote />
          <Field label="Phone" hint="Becomes a tap-to-call button.">
            {({ id }) => (
              <TextInput id={id} type="tel" inputMode="tel" value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            )}
          </Field>
          <Field label="Email">
            {({ id }) => (
              <TextInput id={id} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            )}
          </Field>
          <Field label="Google Maps link">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.mapsUrl} onChange={(e) => setDraft({ ...draft, mapsUrl: e.target.value })} />
            )}
          </Field>
          <Field label="Booking link" hint="Optional.">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.bookingUrl} onChange={(e) => setDraft({ ...draft, bookingUrl: e.target.value })} />
            )}
          </Field>
        </>
      )}

      {draft.type === "footer" && (
        <>
          <Field label="Tagline">
            {({ id }) => <TextInput id={id} value={get(sk("tagline"))} onChange={(e) => set(sk("tagline"), e.target.value)} />}
          </Field>
          <RowEditor
            label="Links"
            rows={draft.links}
            onAdd={() => setDraft({ ...draft, links: [...draft.links, { id: newId("lnk"), href: "" }] })}
            onRemove={(rowId) => setDraft({ ...draft, links: draft.links.filter((l) => l.id !== rowId) })}
            render={(row) => (
              <div className="flex gap-2">
                <TextInput value={get(rk(row.id, "label"))} onChange={(e) => set(rk(row.id, "label"), e.target.value)}
                  aria-label="Link label" placeholder="Instagram" />
                <TextInput value={row.href} aria-label="Link address (shared)" placeholder="https://…"
                  inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      links: draft.links.map((l) => (l.id === row.id ? { ...l, href: e.target.value } : l)),
                    })
                  } />
              </div>
            )}
          />
        </>
      )}
    </BottomSheet>
  );
}

/* --------------------------- repeatable rows ----------------------------- */

function RowEditor<T extends { id: string }>({
  label, rows, render, onAdd, onRemove,
}: {
  label: string;
  rows: T[];
  render: (row: T) => React.ReactNode;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="space-y-2.5">
        {rows.map((row, i) => (
          <div key={row.id} className="rounded-xl border border-line p-2.5">
            {render(row)}
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              aria-label={`Remove item ${i + 1}`}
              className="mt-2 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-danger active:bg-elevated"
            >
              <IconTrash size={16} /> Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-semibold text-brand active:bg-elevated"
      >
        <IconPlus size={18} /> Add
      </button>
    </fieldset>
  );
}

/* ------------------------------ menu editor ------------------------------ */

function MenuEditor({
  section, get, set, sk, onChange,
}: {
  section: Extract<Section, { type: "menu" }>;
  get: (k: string) => string;
  set: (k: string, v: string) => void;
  sk: (field: string) => string;
  onChange: (next: Extract<Section, { type: "menu" }>) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const rk = (rowId: string, field: string) => key.row(section.id, rowId, field);
  const ik = (catId: string, itemId: string, field: string) =>
    key.menuItem(section.id, catId, itemId, field);

  return (
    <>
      <Field label="Heading">
        {({ id }) => <TextInput id={id} value={get(sk("heading"))} onChange={(e) => set(sk("heading"), e.target.value)} />}
      </Field>
      <Field label="Note" hint="Allergens, service charge, anything guests should know.">
        {({ id }) => <TextInput id={id} value={get(sk("note"))} onChange={(e) => set(sk("note"), e.target.value)} />}
      </Field>

      <fieldset className="mb-4">
        <legend className="mb-1.5 text-sm font-semibold">Categories</legend>
        <p className="mb-2 text-xs text-muted">
          Item names and descriptions are translated. Prices are shared by every language.
        </p>
        {/* Accordion: a long menu is unusable as one flat form on a phone. */}
        <div className="space-y-2">
          {section.categories.map((cat, ci) => {
            const isOpen = open === ci;
            return (
              <div key={cat.id} className="rounded-xl border border-line">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : ci)}
                  className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-2 px-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {get(rk(cat.id, "name")) || "Untitled category"}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{cat.items.length} items</span>
                  <span aria-hidden="true" className="text-muted">{isOpen ? "−" : "+"}</span>
                </button>

                {isOpen && (
                  <div className="border-t border-line p-2.5">
                    <TextInput
                      value={get(rk(cat.id, "name"))}
                      onChange={(e) => set(rk(cat.id, "name"), e.target.value)}
                      placeholder="Category name"
                      aria-label="Category name"
                    />
                    <div className="mt-2.5 space-y-2.5">
                      {cat.items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-line p-2.5">
                          <TextInput value={get(ik(cat.id, item.id, "name"))} aria-label="Item name" placeholder="Item name"
                            onChange={(e) => set(ik(cat.id, item.id, "name"), e.target.value)} />
                          <TextArea rows={2} className="mt-2" value={get(ik(cat.id, item.id, "description"))}
                            aria-label="Item description" placeholder="Description"
                            onChange={(e) => set(ik(cat.id, item.id, "description"), e.target.value)} />
                          <TextInput className="mt-2" value={item.price}
                            aria-label="Price (shared by all languages)" placeholder="Price — shared by all languages"
                            onChange={(e) =>
                              onChange({
                                ...section,
                                categories: section.categories.map((c) =>
                                  c.id !== cat.id ? c : {
                                    ...c,
                                    items: c.items.map((it) => (it.id === item.id ? { ...it, price: e.target.value } : it)),
                                  },
                                ),
                              })
                            } />
                          <button
                            type="button"
                            aria-label={`Remove ${get(ik(cat.id, item.id, "name")) || "item"}`}
                            onClick={() =>
                              onChange({
                                ...section,
                                categories: section.categories.map((c) =>
                                  c.id !== cat.id ? c : { ...c, items: c.items.filter((it) => it.id !== item.id) },
                                ),
                              })
                            }
                            className="mt-2 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-danger active:bg-elevated"
                          >
                            <IconTrash size={16} /> Remove item
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...section,
                          categories: section.categories.map((c) =>
                            c.id !== cat.id ? c : { ...c, items: [...c.items, { id: newId("itm"), price: "", tags: [] }] },
                          ),
                        })
                      }
                      className="mt-2.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line text-sm font-semibold text-brand"
                    >
                      <IconPlus size={18} /> Add item
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ ...section, categories: section.categories.filter((c) => c.id !== cat.id) });
                        setOpen(null);
                      }}
                      className="mt-1.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center rounded-lg text-xs font-semibold text-danger"
                    >
                      Remove category
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            onChange({ ...section, categories: [...section.categories, { id: newId("cat"), items: [] }] });
            setOpen(section.categories.length);
          }}
          className="mt-2.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-semibold text-brand"
        >
          <IconPlus size={18} /> Add category
        </button>
      </fieldset>
    </>
  );
}

/* ----------------------------- image pickers ----------------------------- */

function ImagePicker({
  label, assets, value, onChange,
}: {
  label: string;
  assets: AssetRef[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (!assets.length) {
    return (
      <Field label={label} hint="Upload photos from the Images screen first.">
        {() => (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
            No images yet
          </p>
        )}
      </Field>
    );
  }
  return (
    <Field label={label}>
      {({ id }) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">No image</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>{a.alt || a.filename}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function GalleryPicker({
  assets, selected, onChange,
}: {
  assets: AssetRef[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  if (!assets.length) {
    return (
      <p className="mb-4 rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
        Upload photos from the Images screen, then choose them here.
      </p>
    );
  }
  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 text-sm font-semibold">Photos in this gallery</legend>
      <div className="grid grid-cols-3 gap-2">
        {assets.map((a) => {
          const on = selected.includes(a.id);
          return (
            <button
              key={a.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={a.alt || a.filename}
              onClick={() => onChange(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
              className={`relative aspect-square overflow-hidden rounded-lg border-2 ${on ? "border-brand" : "border-transparent"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${a.id}?w=200`} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
              {on && (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-brand text-xs text-on-brand">✓</span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
