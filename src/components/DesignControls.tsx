"use client";

import { useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, BottomSheet, Button, useToast } from "./ui";
import { ARCHITECTURES } from "@/lib/architectures";
import { FONT_CHOICES, key, t, type LayoutDensity, type Site } from "@/lib/site";
import { PALETTES } from "@/lib/styles";

/**
 * Mobile design controls (requirement 11).
 *
 * Colours, typography and layout are grouped into three short rows. Tapping a
 * row opens a bottom sheet of large, pre-vetted choices — never a desktop
 * colour wheel or an eyedropper, both of which need pixel precision.
 *
 * The swatches are curated palettes rather than free hex entry: it keeps
 * contrast accessible by construction, and free hex entry on a phone keyboard
 * is miserable. A native colour input is still offered inside the sheet for
 * anyone who wants exact control.
 */

const COLOR_ROLES = [
  { key: "primary", label: "Primary", hint: "Buttons and links" },
  { key: "secondary", label: "Secondary", hint: "Deeper accents" },
  { key: "accent", label: "Accent", hint: "Highlights" },
  { key: "bg", label: "Background", hint: "Page background" },
  { key: "text", label: "Text", hint: "Body copy" },
] as const;

const LAYOUTS: { id: LayoutDensity; label: string; hint: string }[] = [
  { id: "minimal", label: "Minimal", hint: "Lots of breathing room" },
  { id: "balanced", label: "Balanced", hint: "The usual choice" },
  { id: "dense", label: "Dense", hint: "More on screen, less scrolling" },
];

type Sheet =
  | null
  | { kind: "palette" }
  | { kind: "architecture" }
  | { kind: "color"; role: string }
  | { kind: "font"; role: "heading" | "body" };

export function DesignControls({
  projectId,
  businessName,
  initialSite,
}: {
  projectId: string;
  businessName: string;
  initialSite: Site;
}) {
  const [site, setSite] = useState<Site>(initialSite);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast, toastNode } = useToast();

  const currentArchitecture =
    ARCHITECTURES.find((a) => a.id === site.theme.architecture) ?? ARCHITECTURES[0];

  async function save(next: Site, message = "Design saved") {
    setSite(next);
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
        setError(data.error ?? "Could not save the design.");
        return;
      }
      setSite(data.site);
      toast(message);
    } catch {
      setError("You appear to be offline. Try saving again.");
    } finally {
      setSaving(false);
    }
  }

  const setColor = (role: string, value: string) =>
    save({ ...site, theme: { ...site.theme, colors: { ...site.theme.colors, [role]: value } } });

  return (
    <AppShell>
      <AppBar
        title="Design"
        subtitle={businessName}
        back={`/projects/${projectId}`}
        action={saving ? <span className="text-xs text-muted">Saving…</span> : undefined}
      />

      {error && <Banner tone="error">{error}</Banner>}

      {/* The architecture is the biggest lever on how the site looks, so it
          comes first — changing it re-composes the page, not just its palette. */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Design architecture
        </h2>
        <button
          type="button"
          onClick={() => setSheet({ kind: "architecture" })}
          className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{currentArchitecture.label}</span>
            <span className="block text-sm text-muted">{currentArchitecture.rationale}</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-muted">›</span>
        </button>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Colours
        </h2>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            onClick={() => setSheet({ kind: "palette" })}
            className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 border-b border-line px-4 text-left hover:bg-elevated active:bg-elevated"
          >
            <span className="flex-1 font-semibold">Use a palette</span>
            <span aria-hidden="true" className="flex gap-1">
              {[site.theme.colors.primary, site.theme.colors.accent, site.theme.colors.secondary].map((c, i) => (
                <span key={i} className="size-5 rounded-full border border-black/10" style={{ background: c }} />
              ))}
            </span>
          </button>

          {COLOR_ROLES.map((role, i) => (
            <button
              key={role.key}
              type="button"
              onClick={() => setSheet({ kind: "color", role: role.key })}
              className={`flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 px-4 text-left hover:bg-elevated active:bg-elevated ${
                i < COLOR_ROLES.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{role.label}</span>
                <span className="block text-xs text-muted">{role.hint}</span>
              </span>
              <span
                aria-hidden="true"
                className="size-7 shrink-0 rounded-full border border-black/15"
                style={{ background: site.theme.colors[role.key] }}
              />
              <span className="sr-only">Current colour {site.theme.colors[role.key]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Typography
        </h2>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {(["heading", "body"] as const).map((role, i) => (
            <button
              key={role}
              type="button"
              onClick={() => setSheet({ kind: "font", role })}
              className={`flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 px-4 text-left hover:bg-elevated active:bg-elevated ${
                i === 0 ? "border-b border-line" : ""
              }`}
            >
              <span className="flex-1 font-medium">
                {role === "heading" ? "Heading font" : "Body font"}
              </span>
              <span className="text-sm text-muted">
                {FONT_CHOICES.find((f) => f.id === site.theme.fonts[role])?.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Layout
        </h2>
        <div role="radiogroup" aria-label="Layout density" className="grid gap-2">
          {LAYOUTS.map((l) => {
            const active = site.theme.layout === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => save({ ...site, theme: { ...site.theme, layout: l.id } })}
                className={`flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border p-4 text-left active:scale-[0.99] ${
                  active
                    ? "border-brand bg-brand-soft"
                    : "border-line bg-surface"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{l.label}</span>
                  <span className="block text-sm text-muted">{l.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Corners
        </h2>
        <label htmlFor="radius" className="mb-2 block text-sm">
          Roundness: <strong>{site.theme.radius}px</strong>
        </label>
        <input
          id="radius"
          type="range"
          min={0}
          max={28}
          step={2}
          value={site.theme.radius}
          onChange={(e) => setSite({ ...site, theme: { ...site.theme, radius: Number(e.target.value) } })}
          onPointerUp={() => save(site, "Corners updated")}
          onKeyUp={() => save(site, "Corners updated")}
          className="h-11 w-full accent-brand"
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Mobile action bar
        </h2>
        {/* A switch rather than a checkbox: the whole row is one 44px+ target,
            which is the only reliable way to toggle this with a thumb. */}
        <button
          type="button"
          role="switch"
          aria-checked={site.meta.stickyCta.enabled}
          onClick={() =>
            save({
              ...site,
              meta: {
                ...site.meta,
                stickyCta: { ...site.meta.stickyCta, enabled: !site.meta.stickyCta.enabled },
              },
            })
          }
          className="flex min-h-[var(--spacing-touch-lg)] w-full items-center gap-3 rounded-card border border-line bg-surface p-4 text-left active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Sticky button on phones</span>
            <span className="block text-sm text-muted">
              Keeps “{t(site, site.meta.defaultLocale, key.meta("stickyCtaLabel")) || "Contact"}” pinned to the bottom of the screen.
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
              site.meta.stickyCta.enabled ? "bg-brand" : "bg-elevated"
            }`}
          >
            <span
              className={`size-6 rounded-full bg-white shadow transition-transform ${
                site.meta.stickyCta.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
        </button>
      </section>

      {/* Live preview of the theme, rendered from the same tokens the site uses. */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Preview
        </h2>
        <div
          className="rounded-card border border-line p-5"
          style={{ background: site.theme.colors.bg, color: site.theme.colors.text }}
        >
          <p style={{ color: site.theme.colors.primary, fontWeight: 700, fontSize: ".8125rem", letterSpacing: ".06em", textTransform: "uppercase", margin: 0 }}>
            {t(site, site.meta.defaultLocale, key.meta("tagline")) || "Your business"}
          </p>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, margin: ".4rem 0 .3rem", fontFamily: FONT_CHOICES.find((f) => f.id === site.theme.fonts.heading)?.stack }}>
            {site.meta.businessName}
          </p>
          <p style={{ margin: "0 0 1rem", opacity: 0.75, fontFamily: FONT_CHOICES.find((f) => f.id === site.theme.fonts.body)?.stack }}>
            This is how your body text will look.
          </p>
          <span
            style={{
              display: "inline-flex", alignItems: "center", minHeight: "3rem",
              padding: "0 1.5rem", borderRadius: site.theme.radius,
              background: site.theme.colors.primary, color: site.theme.colors.bg, fontWeight: 650,
            }}
          >
            {t(site, site.meta.defaultLocale, key.meta("stickyCtaLabel")) || "Contact"}
          </span>
        </div>
      </section>

      <div className="mt-6">
        <Button
          block
          size="lg"
          variant="secondary"
          onClick={() => (window.location.href = `/projects/${projectId}/preview`)}
        >
          See it on the real site
        </Button>
      </div>

      {/* ------------------------------ sheets ------------------------------ */}

      <BottomSheet
        open={sheet?.kind === "architecture"}
        onClose={() => setSheet(null)}
        title="Design architecture"
      >
        <p className="mb-3 text-sm text-muted">
          This changes the composition — layout, type scale, image treatment,
          navigation and motion — not just the colours.
        </p>
        <div className="grid gap-2 pb-4">
          {ARCHITECTURES.map((a) => {
            const active = a.id === site.theme.architecture;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  save(
                    {
                      ...site,
                      theme: {
                        ...site.theme,
                        architecture: a.id,
                        fonts: { ...a.fonts },
                        radius: a.radius,
                      },
                    },
                    `${a.label} applied`,
                  );
                  setSheet(null);
                }}
                className={`min-h-[var(--spacing-touch-lg)] rounded-card border p-4 text-left ${
                  active ? "border-brand bg-brand-soft" : "border-line"
                }`}
              >
                <span className="block font-semibold">{a.label}</span>
                <span className="block text-sm text-muted">{a.rationale}</span>
              </button>
            );
          })}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "palette"}
        onClose={() => setSheet(null)}
        title="Choose a palette"
      >
        <div className="grid grid-cols-2 gap-2.5 pb-4">
          {Object.entries(PALETTES).map(([name, colors]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                save({ ...site, theme: { ...site.theme, colors: { ...colors } } }, "Palette applied");
                setSheet(null);
              }}
              className="rounded-card border border-line p-3 text-left active:scale-[0.98]"
            >
              <span aria-hidden="true" className="mb-2 flex gap-1">
                {[colors.primary, colors.accent, colors.secondary].map((c) => (
                  <span key={c} className="size-6 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </span>
              <span className="block text-sm font-semibold capitalize">{name}</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "color"}
        onClose={() => setSheet(null)}
        title={
          sheet?.kind === "color"
            ? `${COLOR_ROLES.find((r) => r.key === sheet.role)?.label} colour`
            : ""
        }
      >
        {sheet?.kind === "color" && (
          <div className="pb-4">
            <div className="mb-4 grid grid-cols-5 gap-2.5">
              {Array.from(
                new Set(Object.values(PALETTES).flatMap((p) => [p.primary, p.secondary, p.accent])),
              ).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  onClick={() => {
                    setColor(sheet.role, c);
                    setSheet(null);
                  }}
                  className="aspect-square rounded-full border border-black/15 active:scale-95"
                  style={{ background: c }}
                />
              ))}
            </div>

            {/* The native picker is the accessible escape hatch for exact values —
                on a phone it opens the OS colour UI, not a tiny custom wheel. */}
            <label className="flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border border-line px-4">
              <span className="flex-1 font-medium">Pick an exact colour</span>
              <input
                type="color"
                value={site.theme.colors[sheet.role as keyof Site["theme"]["colors"]]}
                onChange={(e) => setColor(sheet.role, e.target.value)}
                className="size-11 rounded border-0 bg-transparent p-0"
                aria-label="Exact colour"
              />
            </label>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        open={sheet?.kind === "font"}
        onClose={() => setSheet(null)}
        title={sheet?.kind === "font" ? (sheet.role === "heading" ? "Heading font" : "Body font") : ""}
      >
        {sheet?.kind === "font" && (
          <div className="grid gap-2 pb-4">
            {FONT_CHOICES.map((f) => {
              const active = site.theme.fonts[sheet.role] === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    save({
                      ...site,
                      theme: { ...site.theme, fonts: { ...site.theme.fonts, [sheet.role]: f.id } },
                    }, "Font updated");
                    setSheet(null);
                  }}
                  className={`min-h-[var(--spacing-touch-lg)] rounded-card border p-4 text-left ${
                    active ? "border-brand bg-brand-soft" : "border-line"
                  }`}
                >
                  <span className="block text-xs text-muted">{f.label}</span>
                  <span className="block text-xl" style={{ fontFamily: f.stack }}>
                    {site.meta.businessName}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </BottomSheet>

      {toastNode}
    </AppShell>
  );
}
