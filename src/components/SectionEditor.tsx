"use client";

import { useCallback, useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Card, LinkButton, useToast } from "./ui";
import { SectionSheet } from "./SectionSheet";
import { AiSheet } from "./AiSheet";
import {
  IconDown, IconDrag, IconEye, IconEyeOff, IconPencil, IconSparkles, IconUp,
} from "./icons";
import {
  SECTION_EMOJI, moveSection, reorderSections, sectionSummary,
  type Section, type Site,
} from "@/lib/site";

export type AssetRef = { id: string; filename: string; alt: string };

/**
 * The mobile website editor (requirements 7 and 8).
 *
 * A vertical list of sections, each a full-width row with a large Edit target.
 * Tapping a row opens that section's form in a bottom sheet. There is no
 * canvas, no hover state, no side-by-side panel, and no interaction that needs
 * a mouse — every one of those is explicitly ruled out for phones.
 *
 * Reordering has two independent paths: press-and-hold drag via Pointer
 * Events (which work for touch, pen and mouse alike), and plain Move up /
 * Move down buttons. The buttons are not a fallback — they are a first-class
 * route, because drag is imprecise on a phone and impossible with a switch
 * device or a screen reader.
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

  const dragState = useRef<{ id: string; fromIndex: number } | null>(null);

  function onPointerDown(e: React.PointerEvent, id: string, index: number) {
    // Only start a drag from the handle, and only after the browser has
    // decided this is not a scroll gesture.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id, fromIndex: index };
    setDragId(id);
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = dragState.current;
    if (!state || !listRef.current) return;
    e.preventDefault();

    // Find which row the pointer is currently over and reorder live.
    const rows = Array.from(
      listRef.current.querySelectorAll<HTMLElement>("[data-section-row]"),
    );
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

  return (
    <AppShell>
      <AppBar
        title="Edit website"
        subtitle={businessName}
        back={`/projects/${projectId}`}
        action={
          <LinkButton
            href={`/projects/${projectId}/preview`}
            variant="ghost"
            aria-label="Preview website"
            className="shrink-0"
          >
            <IconEye size={20} />
          </LinkButton>
        }
      />

      {error && <Banner tone="error">{error}</Banner>}
      {warnings.length > 0 && (
        <Banner tone="warning">
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}

      <p className="my-3 text-sm text-muted">
        Tap a section to edit it. Drag the handle, or use the arrows, to reorder.
      </p>

      <ul ref={listRef} className="space-y-2.5" aria-label="Website sections">
        {site.sections.map((section, index) => {
          const dragging = dragId === section.id;
          return (
            <li
              key={section.id}
              data-section-row
              className={`rounded-card border bg-surface transition-shadow ${
                dragging
                  ? "border-brand shadow-lg"
                  : "border-line"
              } ${section.visible ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-1 p-2.5">
                {/* Drag handle. touch-action:none is what stops the browser
                    stealing the gesture for page scrolling. */}
                <button
                  type="button"
                  aria-label={`Reorder ${section.title}. Press and hold, then drag.`}
                  onPointerDown={(e) => onPointerDown(e, section.id, index)}
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
                  <span aria-hidden="true" className="text-xl">
                    {SECTION_EMOJI[section.type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{section.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {section.visible ? sectionSummary(section) : "Hidden"}
                    </span>
                  </span>
                  <span className="shrink-0 text-brand">
                    <IconPencil size={18} />
                  </span>
                </button>
              </div>

              {/* Accessible reorder alternatives — never drag-only. */}
              <div className="flex gap-1 border-t border-line px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => onMove(section.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${section.title} up`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted active:bg-elevated disabled:opacity-35"
                >
                  <IconUp size={16} /> Move up
                </button>
                <button
                  type="button"
                  onClick={() => onMove(section.id, 1)}
                  disabled={index === site.sections.length - 1}
                  aria-label={`Move ${section.title} down`}
                  className="flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted active:bg-elevated disabled:opacity-35"
                >
                  <IconDown size={16} /> Move down
                </button>
                <button
                  type="button"
                  onClick={() => onToggleVisible(section.id)}
                  aria-label={`${section.visible ? "Hide" : "Show"} ${section.title}`}
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
          <p className="mb-3 text-sm text-muted">
            You have unsaved changes.
          </p>
          <Button block size="lg" loading={saving} onClick={() => persist(site)}>
            Save changes
          </Button>
        </Card>
      )}

      {/* AI entry point as a sticky bar rather than a floating button: a FAB
          would sit on top of the section rows' own controls while scrolling,
          and covering a control is not acceptable on a touch screen. The bar
          reserves its own space, so nothing is ever obscured. */}
      <div
        className="fixed inset-x-0 z-40 border-t border-line bg-canvas/95 px-4 pt-2.5 backdrop-blur-lg md:pl-60"
        style={{
          bottom: "calc(var(--bottomnav-h) + var(--safe-bottom))",
          paddingBottom: "0.625rem",
        }}
      >
        <div className="mx-auto max-w-3xl lg:max-w-5xl">
          <Button block size="lg" onClick={() => setAiOpen(true)}>
            <IconSparkles size={20} />
            Ask AI to edit
          </Button>
        </div>
      </div>
      {/* Spacer matching the sticky bar so the last row always scrolls clear. */}
      <div aria-hidden="true" className="h-24" />

      {editing && (
        <SectionSheet
          section={editing}
          assets={assets}
          onClose={() => setEditing(null)}
          onSave={(updated) => {
            const next = {
              ...site,
              sections: site.sections.map((s) => (s.id === updated.id ? updated : s)),
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
        focusSectionId={editing?.id}
        onClose={() => setAiOpen(false)}
        onApplied={(next, summary) => {
          setSite(next);
          setDirty(false);
          toast(summary);
        }}
      />

      {toastNode}
    </AppShell>
  );
}
