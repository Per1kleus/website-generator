"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  IconDesktop, IconExternal, IconMobileNarrow, IconPhone, IconRefresh, IconTablet,
} from "./icons";
import { localeInfo, type Locale } from "@/lib/locales";
import { MAX_WIDTH, MIN_WIDTH, VIEWPORT_HEIGHT, VIEWPORTS, type ViewportId } from "@/lib/viewports";

/**
 * The generated website, live, inside the application.
 *
 * One component, used by every screen that shows the site: the project hub,
 * the editor's right-hand panel, the full-screen preview, and the moment
 * generation finishes. There is exactly one of these because there is exactly
 * one website — the frame loads `/api/projects/<id>/render`, which is the same
 * `renderSite()` that produces the exported ZIP and the published site from the
 * same document. Nothing here re-implements a section, a style or a layout.
 *
 * Two things about how it shows a width are worth stating, because the
 * difference between them is the whole point of the feature:
 *
 *   The frame is really that wide. Choosing Mobile sets the iframe to 390
 *   CSS pixels, so the website's own media queries fire exactly as they will
 *   on a phone — its hamburger appears because *its* breakpoint said so.
 *
 *   Scaling, when it happens, is only a way to fit a wide frame on a narrow
 *   screen. A 1440px desktop frame on a 1100px panel is drawn at 76%, but it
 *   still believes it is 1440 wide, so what is on screen is the real desktop
 *   layout, smaller. The page is never re-laid-out to fit; it is never a
 *   shrunken desktop pretending to be a phone.
 *
 * The device buttons, the language buttons and the scale are builder
 * furniture. They live in this component, outside the frame, and cannot reach
 * the document inside it — which has no origin of its own and is sandboxed
 * away from this application entirely.
 */

export type PreviewHandle = {
  /** Reload the frame with whatever is now saved. */
  refresh: () => void;
};

type Mode = ViewportId | "custom";

const ICONS: Record<ViewportId, typeof IconPhone> = {
  desktop: IconDesktop,
  tablet: IconTablet,
  mobile: IconPhone,
  narrow: IconMobileNarrow,
};

/** Shorter labels for the editor's narrow panel. */
const SHORT: Record<ViewportId, string> = {
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
  narrow: "320px",
};

type Status = "loading" | "ready" | "error";

export function SitePreview({
  projectId,
  businessName,
  locales,
  defaultLocale,
  version,
  locale: controlledLocale,
  initialDevice = "desktop",
  fill = false,
  compact = false,
  allowCustomWidth = true,
  showOpenInTab = true,
  staleNote = "",
  handleRef,
}: {
  projectId: string;
  businessName: string;
  locales: Locale[];
  defaultLocale: Locale;
  /** Preview a saved version instead of the current document. */
  version?: string;
  /**
   * Show this language and hide the language buttons. For the editor, where
   * the locale tabs already say which language is being worked on and two
   * controls for one choice would be one too many.
   */
  locale?: Locale;
  initialDevice?: ViewportId;
  /** Let the frame take the height it is given rather than the device's. */
  fill?: boolean;
  /** Tighter chrome, for the editor's side panel. */
  compact?: boolean;
  allowCustomWidth?: boolean;
  showOpenInTab?: boolean;
  /** Shown when the caller knows the saved site is behind what is on screen. */
  staleNote?: string;
  handleRef?: React.Ref<PreviewHandle>;
}) {
  const [mode, setMode] = useState<Mode>(initialDevice);
  const [customWidth, setCustomWidth] = useState(1024);
  const [ownLocale, setOwnLocale] = useState<Locale>(defaultLocale);
  const locale = controlledLocale ?? ownLocale;
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Set while a load is in flight, so a late message maps to the right load. */
  const pending = useRef(true);

  const preset = VIEWPORTS.find((v) => v.id === mode);
  const width = preset ? preset.width : customWidth;
  const height = preset ? VIEWPORT_HEIGHT[preset.id] : 900;

  // `nonce` is in the URL rather than on the element's key so a refresh
  // replaces the document in the existing frame instead of tearing the frame
  // down and building a new one.
  const src =
    `/api/projects/${projectId}/render?locale=${encodeURIComponent(locale)}` +
    (version ? `&version=${encodeURIComponent(version)}` : "") +
    (nonce ? `&r=${nonce}` : "");

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
    setStatus("loading");
    pending.current = true;
  }, []);

  useImperativeHandle(handleRef, () => ({ refresh }), [refresh]);

  // Changing language or version is a different document, not a failure of the
  // one showing; reset the status so the spinner is honest.
  useEffect(() => {
    setStatus("loading");
    pending.current = true;
  }, [locale, version]);

  /**
   * The frame cannot be inspected from here — it is sandboxed without an
   * origin, which is exactly what keeps the generated site away from this
   * application. So the render endpoint's failure page announces itself, and
   * silence on a completed load means it rendered.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { source?: string; message?: string } | null;
      if (!data || data.source !== "wg-preview") return;
      pending.current = false;
      setError(typeof data.message === "string" ? data.message : "The website could not be rendered.");
      setStatus("error");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const onFrameLoad = () => {
    // The failure page posts its message during parse, so by the time load
    // fires the status is already "error" if it went wrong.
    if (!pending.current) return;
    pending.current = false;
    setError("");
    setStatus("ready");
  };

  // Fit a frame wider than the space it has. Narrower frames are left at 1:1 —
  // a 390px phone on a desktop panel should be phone-sized, not blown up.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setScale(Math.min(1, stage.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [width]);

  // A scaled frame keeps its unscaled layout box, so filling a stage that is
  // being drawn at 40% means asking for 250% of its height.
  const frameHeight = fill ? `${100 / Math.max(scale, 0.05)}%` : height;
  const stageHeight = fill ? "100%" : height * scale;

  return (
    <div className={`flex min-w-0 flex-col ${fill ? "h-full" : ""}`}>
      {/* ------------------------------- controls ------------------------ */}
      <div className={`flex flex-wrap items-center gap-2 ${compact ? "mb-2" : "mb-3"}`}>
        <div
          role="radiogroup"
          aria-label="Preview width"
          className="flex min-w-0 flex-1 gap-1 rounded-xl bg-elevated p-1"
        >
          {VIEWPORTS.map((v) => {
            const Icon = ICONS[v.id];
            const active = mode === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                // Below 40rem the icon is all there is, so the button carries
                // its own name; the pixel width stays in the tooltip, where it
                // is detail rather than identity.
                aria-label={v.label}
                title={`${v.label} — ${v.width}px`}
                onClick={() => setMode(v.id)}
                className={`flex min-h-[var(--spacing-touch)] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm font-semibold transition-colors ${
                  active ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-fg"
                }`}
              >
                <Icon size={17} />
                {/* Four labelled buttons do not fit across a phone, and the
                    row must never be what pushes a screen sideways. */}
                <span className="hidden truncate sm:inline">
                  {compact ? SHORT[v.id] : v.label}
                </span>
              </button>
            );
          })}
        </div>

        {allowCustomWidth && (
          // Hidden on a phone, where the four presets already fill the row and
          // a number field would be the thing that overflows.
          <label className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
            <span className="sr-only">Custom width</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              step={10}
              value={width}
              aria-label="Custom preview width in pixels"
              onChange={(e) => {
                const next = Number(e.target.value);
                if (!Number.isFinite(next)) return;
                setCustomWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next))));
                setMode("custom");
              }}
              className="min-h-[var(--spacing-touch)] w-20 rounded-lg border border-line bg-surface px-2 text-sm tabular-nums"
            />
            <span aria-hidden="true">px</span>
          </label>
        )}

        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh the preview"
          title="Refresh the preview"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated active:bg-elevated"
        >
          <IconRefresh size={18} />
        </button>

        {showOpenInTab && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the website in a new tab"
            title="Open in a new tab"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated active:bg-elevated"
          >
            <IconExternal size={18} />
          </a>
        )}
      </div>

      {/* Language is the *website's* audience choice, so it is kept visually
          apart from the width buttons above, which are the builder's. */}
      {locales.length > 1 && !controlledLocale && (
        <div
          role="radiogroup"
          aria-label="Preview language"
          className="snap-rail no-scrollbar mb-3 flex gap-2"
        >
          {locales.map((l) => {
            const info = localeInfo(l);
            const active = l === locale;
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setOwnLocale(l)}
                className={`flex min-h-[var(--spacing-touch)] items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
                  active ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted"
                }`}
              >
                <span aria-hidden="true">{info.flag}</span> {info.english}
              </button>
            );
          })}
        </div>
      )}

      <p className="mb-2 text-center text-xs text-muted" data-preview-caption>
        {width}px viewport
        {scale < 0.999 && ` · shown at ${Math.round(scale * 100)}%`}
        {locales.length > 1 && ` · ${localeInfo(locale).english}`}
      </p>

      {/* The preview can only ever show what is saved. When the caller knows
          the creator has moved past that, it says so rather than letting a
          correct-looking page imply the newest edit is in it. */}
      {staleNote && (
        <p
          role="status"
          className="mb-2 rounded-xl bg-warning/12 px-3 py-2 text-center text-xs font-semibold text-warning"
          data-preview-stale
        >
          {staleNote}
        </p>
      )}

      {/* --------------------------------- stage ------------------------- */}
      <div ref={stageRef} className={`relative w-full ${fill ? "min-h-0 flex-1" : ""}`}>
        <div
          style={{ height: stageHeight, overflow: "hidden" }}
          className="mx-auto rounded-card border border-line bg-white"
        >
          <iframe
            ref={frameRef}
            title={`${businessName} preview in ${localeInfo(locale).english} at ${width} pixels wide`}
            src={src}
            onLoad={onFrameLoad}
            data-preview-frame
            /**
             * No `allow-same-origin`. The generated website runs in an origin
             * of its own, so it cannot read this application's cookies or
             * storage, cannot reach into this document, and cannot call a
             * builder endpoint even though the server is the same one. Its own
             * scripts still run and its links still work; a target="_blank"
             * link may open, but the window it opens stays inside the sandbox.
             * Top-level navigation is not granted, so the page cannot take
             * over the builder window.
             */
            sandbox="allow-scripts allow-popups"
            style={{
              width,
              height: frameHeight,
              border: 0,
              display: "block",
              transform: scale < 0.999 ? `scale(${scale})` : undefined,
              transformOrigin: "top left",
            }}
          />
        </div>

        {status === "loading" && (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-card bg-surface/70"
            data-preview-loading
          >
            <span className="text-sm font-semibold text-muted">Loading preview…</span>
          </div>
        )}

        {status === "error" && (
          <div
            className="absolute inset-0 grid place-items-center rounded-card border border-line bg-surface p-6 text-center"
            data-preview-error
          >
            <div>
              <p className="text-base font-bold">Preview unavailable</p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
                {error || "The website could not be rendered."}
              </p>
              <button
                type="button"
                onClick={refresh}
                className="mt-4 inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center rounded-xl bg-brand px-6 text-base font-semibold text-on-brand active:scale-[0.98]"
              >
                Retry preview
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
