"use client";

import { useCallback, useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, LinkButton, useToast } from "./ui";
import { SectionSheet } from "./SectionSheet";
import { AiSheet } from "./AiSheet";
import { LocaleTabs } from "./LocaleTabs";
import { IconDown, IconDrag, IconEye, IconEyeOff, IconPencil, IconSparkles, IconUp } from "./icons";
import { localeInfo, type Locale } from "@/lib/locales";
import {
  SECTION_EMOJI, missingKeys, moveSection, reorderSections,
  sectionSummary, sectionTitle,
  type Section, type Site,
} from "@/lib/site";

export type AssetRef = { id: string; filename: string; alt: string };

/**
 * The mobile website editor (requirements 7, 8, 25).
 *
 * A vertical list of sections, each a full-width row with a large Edit target.
 * Tapping a row opens that section's form in a bottom sheet. No canvas, no
 * hover state, no side-by-side panel, and no interaction needing a mouse.
 *
 * Reordering has two independent paths: press-and-hold drag via Pointer Events
 * (touch, pen and mouse alike), and Move up / Move down buttons. The buttons
 * are not a fallback — drag is imprecise on a phone and impossible with a
 * switch device or a screen reader.
 *
 * When more than one language is enabled a locale tab bar appears. It changes
 * which language's *text* is being edited; it never changes structure, so the
 * list of sections is identical in every language by construction.
 */
export function SectionEditor({
  projectId,
  businessName,
  initialSite,
  assets,
}: {
  projectId: string;
  businessName: string;
  initialSite: Site;
  assets: AssetRef[];
}) {
  const [site, setSite] = useState<Site>(initialSite);
  const [locale, setLocale] = useState<Locale>(initialSite.meta.defaultLocale);
  const [editing, setEditing] = useState<Section | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const { toast, toastNode } = useToast();
  const listRef = useRef<HTMLUListElement>(null);

  const persist = useCallback(
    async (next: Site, message = "Saved") => {
      setSaving(true);
      setError("");
      try {
        const res = await fetch(`/api/projects/${projectId}/site`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: next }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not save your changes.");
          return false;
        }
        setSite(data.site);
        setWarnings(data.warnings ?? []);
        setDirty(false);
        toast(message);
        return true;
      } catch {
        // Keep the edit on screen so nothing is lost when signal drops.
        setError("You appear to be offline. Your changes are kept here — try saving again.");
        setDirty(true);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [projectId, toast],
  );

  function applyLocal(next: Site) {
    setSite(next);
    setDirty(true);
  }

  function onMove(id: string, dir: -1 | 1) {
    const sections = moveSection(site.sections, id, dir);
    if (sections === site.sections) return;
    const next = { ...site, sections };
    applyLocal(next);
    void persist(next, dir === -1 ? "Moved up" : "Moved down");
  }

  function onToggleVisible(id: string) {
    const sections = site.sections.map((s) =>
      s.id === id ? ({ ...s, visible: !s.visible } as Section) : s,
    );
    const next = { ...site, sections };
    applyLocal(next);
    void persist(next, "Updated");
  }

  /* ------------------------- touch drag & drop -------------------------- */

  const dragState = useRef<{ id: string } | null>(null);

  function onPointerDown(e: React.PointerEvent, id: string) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id };
    setDragId(id);
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = dragState.current;
    if (!state || !listRef.current) return;
    e.preventDefault();

    const rows = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-section-row]"));
    const overIndex = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return e.clientY >= rect.top && e.clientY <= rect.bottom;
    });
    if (overIndex < 0) return;

    const currentIndex = site.sections.findIndex((s) => s.id === state.id);
    if (overIndex === currentIndex) return;

    setSite((prev) => ({
      ...prev,
      sections: reorderSections(prev.sections, currentIndex, overIndex),
    }));
    setDirty(true);
  }

  function onPointerUp() {
    if (!dragState.current) return;
    dragState.current = null;
    setDragId(null);
    if (dirty) void persist(site, "Order saved");
  }

  const missing = locale === site.meta.defaultLocale ? [] : missingKeys(site, locale);

  return (
    <AppShell>
      <AppBar
        title="Edit website"
        subtitle={businessName}
        back={`/projects/${projectId}`}
        action={
          <LinkButton href={`/projects/${projectId}/preview`} variant="ghost" aria-label="Preview website" className="shrink-0">
            <IconEye size={20} />
          </LinkButton>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {warnings.length > 0 && (
        <Banner tone="warning">
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.slice(0, 4).map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Banner>
      )}

      {site.meta.locales.length > 1 && (
        <LocaleTabs
          locales={site.meta.locales}
          defaultLocale={site.meta.defaultLocale}
          value={locale}
          onChange={setLocale}
          missingCount={(l) => (l === site.meta.defaultLocale ? 0 : missingKeys(site, l).length)}
        />
      )}

      {missing.length > 0 && (
        <Banner tone="info">
          {missing.length} item{missing.length === 1 ? "" : "s"} not yet translated into{" "}
          {localeInfo(locale).english}. Those fall back to{" "}
          {localeInfo(site.meta.defaultLocale).english} on the live site.
        </Banner>
      )}

      <p className="my-3 text-sm text-muted">
        Tap a section to edit it. Drag the handle, or use the arrows, to reorder.
      </p>

      <ul ref={listRef} className="space-y-2.5" aria-label="Website sections">
        {site.sections.map((section, index) => {
          const dragging = dragId === section.id;
          const title = sectionTitle(site, locale, section);
          return (
            <li
              key={section.id}
              data-section-row
              className={`rounded-card border bg-surface transition-shadow ${
                dragging ? "border-brand shadow-lg" : "border-line"
              } ${section.visible ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-1 p-2.5">
                {/* touch-action:none stops the browser stealing the gesture. */}
                <button
                  type="button"
                  aria-label={`Reorder ${title}. Press and hold, then drag.`}
                  onPointerDown={(e) => onPointerDown(e, section.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{ touchAction: "none" }}
                  className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted active:bg-elevated"
                >
                  <IconDrag size={20} />
                </button>

                <button
                  type="button"
                  onClick={() => setEditing(section)}
                  className="flex min-h-[var(--spacing-touch)] min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 text-left active:bg-elevated"
                >
                  <span aria-hidden="true" className="text-xl">{SECTION_EMOJI[section.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{title}</span>
                    <span className="block truncate text-xs text-muted">
                      {section.visible ? sectionSummary(site, locale, section) : "Hidden"}
                    </span>
                  </span>
                  <span className="shrink-0 text-brand"><IconPencil size={18} /></span>
                </button>
              </div>

              {/* Accessible reorder alternatives — never drag-only. */}
              <div className="flex gap-1 border-t border-line px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => onMove(section.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${title} up`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted active:bg-elevated disabled:opacity-35"
                >
                  <IconUp size={16} /> Move up
                </button>
                <button
                  type="button"
                  onClick={() => onMove(section.id, 1)}
                  disabled={index === site.sections.length - 1}
                  aria-label={`Move ${title} down`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted active:bg-elevated disabled:opacity-35"
                >
                  <IconDown size={16} /> Move down
                </button>
                <button
                  type="button"
                  onClick={() => onToggleVisible(section.id)}
                  aria-label={`${section.visible ? "Hide" : "Show"} ${title}`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted active:bg-elevated"
                >
                  {section.visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  {section.visible ? "Hide" : "Show"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {dirty && (
        <Card className="mt-4">
          <p className="mb-3 text-sm text-muted">You have unsaved changes.</p>
          <Button block size="lg" loading={saving} onClick={() => persist(site)}>Save changes</Button>
        </Card>
      )}

      {/* Sticky bar rather than a floating button: a FAB would cover the
          section rows' own controls while scrolling. */}
      <div
        className="fixed inset-x-0 z-40 border-t border-line bg-canvas/95 px-4 pt-2.5 backdrop-blur-lg md:pl-60"
        style={{ bottom: "calc(var(--bottomnav-h) + var(--safe-bottom))", paddingBottom: "0.625rem" }}
      >
        <div className="mx-auto max-w-3xl lg:max-w-5xl">
          <Button block size="lg" onClick={() => setAiOpen(true)}>
            <IconSparkles size={20} /> Ask AI to edit
          </Button>
        </div>
      </div>
      <div aria-hidden="true" className="h-24" />

      {editing && (
        <SectionSheet
          site={site}
          section={editing}
          locale={locale}
          assets={assets}
          onClose={() => setEditing(null)}
          onSave={({ section, strings }) => {
            const catalog = site.i18n[locale] ?? { strings: {}, seo: site.i18n[site.meta.defaultLocale].seo };
            const next: Site = {
              ...site,
              sections: site.sections.map((s) => (s.id === section.id ? section : s)),
              i18n: {
                ...site.i18n,
                // Only the selected locale's catalog is touched.
                [locale]: { ...catalog, strings: { ...catalog.strings, ...strings } },
              },
            };
            setEditing(null);
            applyLocal(next);
            void persist(next, "Section saved");
          }}
          onAskAi={() => {
            setEditing(null);
            setAiOpen(true);
          }}
        />
      )}

      <AiSheet
        open={aiOpen}
        projectId={projectId}
        locale={locale}
        locales={site.meta.locales}
        focusSectionId={editing?.id}
        onClose={() => setAiOpen(false)}
        onApplied={(next, summary) => {
          setSite(next);
          setDirty(false);
          if (!next.meta.locales.includes(locale)) setLocale(next.meta.defaultLocale);
          toast(summary);
        }}
      />

      {toastNode}
    </AppShell>
  );
}
