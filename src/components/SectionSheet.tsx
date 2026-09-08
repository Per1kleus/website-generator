"use client";

import { useState } from "react";
import { BottomSheet, Button, Field, Select, TextArea, TextInput } from "./ui";
import { IconPlus, IconSparkles, IconTrash } from "./icons";
import type { AssetRef } from "./SectionEditor";
import type { MenuCategory, Section } from "@/lib/site";

/**
 * Per-section editing (requirement 7). Every section type gets a purpose-built
 * form of plain, large, labelled controls in a bottom sheet — no inline
 * canvas editing, which is unusable with a fingertip.
 */
export function SectionSheet({
  section,
  assets,
  onClose,
  onSave,
  onAskAi,
}: {
  section: Section;
  assets: AssetRef[];
  onClose: () => void;
  onSave: (s: Section) => void;
  onAskAi: () => void;
}) {
  const [draft, setDraft] = useState<Section>(() => structuredClone(section));

  // `props` is a discriminated union; the cast is contained to this one helper
  // and every call site below is already narrowed by draft.type.
  const setProp = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, props: { ...d.props, [key]: value } }) as Section);

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={`Edit ${section.title.toLowerCase()}`}
      footer={
        <div className="flex gap-2.5">
          <Button variant="secondary" size="lg" onClick={onAskAi} className="shrink-0">
            <IconSparkles size={18} />
            <span className="sr-only">Ask AI instead</span>
          </Button>
          <Button size="lg" block onClick={() => onSave(draft)}>
            Save
          </Button>
        </div>
      }
    >
      <Field label="Section name" hint="Shown in the website's navigation.">
        {({ id }) => (
          <TextInput
            id={id}
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            autoCapitalize="words"
          />
        )}
      </Field>

      {draft.type === "hero" && (
        <>
          <Field label="Eyebrow" hint="Small line above the headline. Optional.">
            {({ id }) => (
              <TextInput id={id} value={draft.props.eyebrow} onChange={(e) => setProp("eyebrow", e.target.value)} />
            )}
          </Field>
          <Field label="Headline" hint="Keep it under 8 words so it fits a phone.">
            {({ id }) => (
              <TextArea id={id} rows={2} value={draft.props.headline} onChange={(e) => setProp("headline", e.target.value)} />
            )}
          </Field>
          <Field label="Subheadline">
            {({ id }) => (
              <TextArea id={id} rows={3} value={draft.props.subheadline} onChange={(e) => setProp("subheadline", e.target.value)} />
            )}
          </Field>
          <Field label="Button label">
            {({ id }) => (
              <TextInput id={id} value={draft.props.ctaLabel} onChange={(e) => setProp("ctaLabel", e.target.value)} />
            )}
          </Field>
          <Field label="Button link" hint="A web address, tel: number, or mailto: address.">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.props.ctaHref} onChange={(e) => setProp("ctaHref", e.target.value)} />
            )}
          </Field>
          <ImagePicker
            label="Hero image"
            assets={assets}
            value={draft.props.imageId}
            onChange={(v) => setProp("imageId", v)}
          />
        </>
      )}

      {draft.type === "about" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <Field label="Text" hint="Leave a blank line between paragraphs.">
            {({ id }) => (
              <TextArea id={id} rows={7} value={draft.props.body} onChange={(e) => setProp("body", e.target.value)} autoCapitalize="sentences" />
            )}
          </Field>
          <ListEditor
            label="Highlights"
            items={draft.props.highlights}
            onChange={(v) => setProp("highlights", v)}
            render={(value, set) => (
              <TextInput value={value} onChange={(e) => set(e.target.value)} placeholder="Independent and local" />
            )}
            empty=""
          />
          <ImagePicker label="Image" assets={assets} value={draft.props.imageId} onChange={(v) => setProp("imageId", v)} />
        </>
      )}

      {draft.type === "services" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <Field label="Intro">
            {({ id }) => <TextArea id={id} rows={2} value={draft.props.intro} onChange={(e) => setProp("intro", e.target.value)} />}
          </Field>
          <ListEditor
            label="Services"
            items={draft.props.items}
            onChange={(v) => setProp("items", v)}
            empty={{ name: "", description: "", price: "" }}
            render={(item, set) => (
              <div className="space-y-2">
                <TextInput value={item.name} onChange={(e) => set({ ...item, name: e.target.value })} placeholder="Service name" />
                <TextArea rows={2} value={item.description} onChange={(e) => set({ ...item, description: e.target.value })} placeholder="Short description" />
                <TextInput value={item.price} onChange={(e) => set({ ...item, price: e.target.value })} placeholder="Price (optional)" inputMode="text" />
              </div>
            )}
          />
        </>
      )}

      {draft.type === "menu" && (
        <MenuEditor
          categories={draft.props.categories}
          heading={draft.props.heading}
          note={draft.props.note}
          onHeading={(v) => setProp("heading", v)}
          onNote={(v) => setProp("note", v)}
          onChange={(v) => setProp("categories", v)}
        />
      )}

      {draft.type === "gallery" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <GalleryPicker
            assets={assets}
            selected={draft.props.imageIds}
            onChange={(v) => setProp("imageIds", v)}
          />
        </>
      )}

      {draft.type === "hours" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <ListEditor
            label="Days"
            items={draft.props.rows}
            onChange={(v) => setProp("rows", v)}
            empty={{ day: "", hours: "" }}
            render={(row, set) => (
              <div className="flex gap-2">
                <TextInput value={row.day} onChange={(e) => set({ ...row, day: e.target.value })} placeholder="Monday" />
                <TextInput value={row.hours} onChange={(e) => set({ ...row, hours: e.target.value })} placeholder="9:00 – 18:00" />
              </div>
            )}
          />
          <Field label="Note">
            {({ id }) => <TextInput id={id} value={draft.props.note} onChange={(e) => setProp("note", e.target.value)} />}
          </Field>
        </>
      )}

      {draft.type === "testimonials" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <ListEditor
            label="Quotes"
            items={draft.props.items}
            onChange={(v) => setProp("items", v)}
            empty={{ quote: "", author: "" }}
            render={(item, set) => (
              <div className="space-y-2">
                <TextArea rows={3} value={item.quote} onChange={(e) => set({ ...item, quote: e.target.value })} placeholder="What they said" />
                <TextInput value={item.author} onChange={(e) => set({ ...item, author: e.target.value })} placeholder="Who said it" />
              </div>
            )}
          />
        </>
      )}

      {draft.type === "cta" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <Field label="Text">
            {({ id }) => <TextArea id={id} rows={2} value={draft.props.body} onChange={(e) => setProp("body", e.target.value)} />}
          </Field>
          <Field label="Button label">
            {({ id }) => <TextInput id={id} value={draft.props.ctaLabel} onChange={(e) => setProp("ctaLabel", e.target.value)} />}
          </Field>
          <Field label="Button link">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.props.ctaHref} onChange={(e) => setProp("ctaHref", e.target.value)} />
            )}
          </Field>
        </>
      )}

      {draft.type === "contact" && (
        <>
          <Field label="Heading">
            {({ id }) => <TextInput id={id} value={draft.props.heading} onChange={(e) => setProp("heading", e.target.value)} />}
          </Field>
          <Field label="Address">
            {({ id }) => <TextArea id={id} rows={2} value={draft.props.address} onChange={(e) => setProp("address", e.target.value)} />}
          </Field>
          <Field label="Phone" hint="Becomes a tap-to-call button.">
            {({ id }) => (
              <TextInput id={id} type="tel" inputMode="tel" value={draft.props.phone} onChange={(e) => setProp("phone", e.target.value)} />
            )}
          </Field>
          <Field label="Email">
            {({ id }) => (
              <TextInput id={id} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.props.email} onChange={(e) => setProp("email", e.target.value)} />
            )}
          </Field>
          <Field label="Google Maps link">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.props.mapsUrl} onChange={(e) => setProp("mapsUrl", e.target.value)} />
            )}
          </Field>
          <Field label="Booking link" hint="Optional. Shows a 'Book now' button.">
            {({ id }) => (
              <TextInput id={id} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={draft.props.bookingUrl} onChange={(e) => setProp("bookingUrl", e.target.value)} />
            )}
          </Field>
        </>
      )}

      {draft.type === "footer" && (
        <>
          <Field label="Business name">
            {({ id }) => <TextInput id={id} value={draft.props.businessName} onChange={(e) => setProp("businessName", e.target.value)} />}
          </Field>
          <Field label="Tagline">
            {({ id }) => <TextInput id={id} value={draft.props.tagline} onChange={(e) => setProp("tagline", e.target.value)} />}
          </Field>
          <ListEditor
            label="Links"
            items={draft.props.links}
            onChange={(v) => setProp("links", v)}
            empty={{ label: "", href: "" }}
            render={(link, set) => (
              <div className="flex gap-2">
                <TextInput value={link.label} onChange={(e) => set({ ...link, label: e.target.value })} placeholder="Instagram" />
                <TextInput value={link.href} onChange={(e) => set({ ...link, href: e.target.value })} placeholder="https://…"
                  inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </div>
            )}
          />
        </>
      )}
    </BottomSheet>
  );
}

/* --------------------------- repeatable lists ---------------------------- */

/**
 * Add/remove rows with generous targets. Reordering here is deliberately
 * arrow-based only — nested drag inside a scrolling sheet is a bad idea on a
 * touch screen because the two gestures fight each other.
 */
function ListEditor<T>({
  label,
  items,
  onChange,
  render,
  empty,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, set: (v: T) => void) => React.ReactNode;
  empty: T;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="rounded-xl border border-line p-2.5">
            {render(item, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label={`Remove item ${i + 1}`}
                className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-danger active:bg-elevated"
              >
                <IconTrash size={16} /> Remove
              </button>
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = items.slice();
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}
                  aria-label={`Move item ${i + 1} up`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center rounded-lg text-xs font-semibold text-muted active:bg-elevated"
                >
                  Move up
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...items, structuredClone(empty)])}
        className="mt-2.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-sm font-semibold text-brand active:bg-elevated"
      >
        <IconPlus size={18} /> Add
      </button>
    </fieldset>
  );
}

/* ------------------------------ menu editor ------------------------------ */

function MenuEditor({
  categories, heading, note, onChange, onHeading, onNote,
}: {
  categories: MenuCategory[];
  heading: string;
  note: string;
  onChange: (c: MenuCategory[]) => void;
  onHeading: (v: string) => void;
  onNote: (v: string) => void;
}) {
  const [openCat, setOpenCat] = useState<number | null>(0);

  return (
    <>
      <Field label="Heading">
        {({ id }) => <TextInput id={id} value={heading} onChange={(e) => onHeading(e.target.value)} />}
      </Field>
      <Field label="Note" hint="Allergens, service charge, anything guests should know.">
        {({ id }) => <TextInput id={id} value={note} onChange={(e) => onNote(e.target.value)} />}
      </Field>

      <fieldset className="mb-4">
        <legend className="mb-1.5 text-sm font-semibold">Categories</legend>
        {/* Accordion: a long menu is unusable as one flat form on a phone. */}
        <div className="space-y-2">
          {categories.map((cat, ci) => {
            const open = openCat === ci;
            return (
              <div key={ci} className="rounded-xl border border-line">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenCat(open ? null : ci)}
                  className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-2 px-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {cat.name || "Untitled category"}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {cat.items.length} items
                  </span>
                  <span aria-hidden="true" className="text-muted">
                    {open ? "−" : "+"}
                  </span>
                </button>

                {open && (
                  <div className="border-t border-line p-2.5">
                    <TextInput
                      value={cat.name}
                      onChange={(e) =>
                        onChange(categories.map((c, j) => (j === ci ? { ...c, name: e.target.value } : c)))
                      }
                      placeholder="Category name"
                      aria-label="Category name"
                    />
                    <div className="mt-2.5 space-y-2.5">
                      {cat.items.map((item, ii) => (
                        <div key={ii} className="rounded-lg border border-line p-2.5">
                          <TextInput
                            value={item.name}
                            aria-label="Item name"
                            placeholder="Item name"
                            onChange={(e) =>
                              onChange(categories.map((c, j) => j !== ci ? c : {
                                ...c, items: c.items.map((it, k) => k === ii ? { ...it, name: e.target.value } : it),
                              }))
                            }
                          />
                          <TextArea
                            rows={2}
                            className="mt-2"
                            value={item.description}
                            aria-label="Item description"
                            placeholder="Description"
                            onChange={(e) =>
                              onChange(categories.map((c, j) => j !== ci ? c : {
                                ...c, items: c.items.map((it, k) => k === ii ? { ...it, description: e.target.value } : it),
                              }))
                            }
                          />
                          <TextInput
                            className="mt-2"
                            value={item.price}
                            aria-label="Price"
                            placeholder="Price"
                            onChange={(e) =>
                              onChange(categories.map((c, j) => j !== ci ? c : {
                                ...c, items: c.items.map((it, k) => k === ii ? { ...it, price: e.target.value } : it),
                              }))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Remove ${item.name || "item"}`}
                            onClick={() =>
                              onChange(categories.map((c, j) => j !== ci ? c : {
                                ...c, items: c.items.filter((_, k) => k !== ii),
                              }))
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
                        onChange(categories.map((c, j) => j !== ci ? c : {
                          ...c, items: [...c.items, { name: "", description: "", price: "", tags: [] }],
                        }))
                      }
                      className="mt-2.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line text-sm font-semibold text-brand"
                    >
                      <IconPlus size={18} /> Add item
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(categories.filter((_, j) => j !== ci));
                        setOpenCat(null);
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
            onChange([...categories, { name: "", items: [] }]);
            setOpenCat(categories.length);
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
            <option key={a.id} value={a.id}>
              {a.alt || a.filename}
            </option>
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
              onClick={() =>
                onChange(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])
              }
              className={`relative aspect-square overflow-hidden rounded-lg border-2 ${
                on ? "border-brand" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/assets/${a.id}?w=200`}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
              {on && (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-brand text-xs text-on-brand">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
