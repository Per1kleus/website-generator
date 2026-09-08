"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, LinkButton } from "./ui";
import { IconDesktop, IconExternal, IconPhone, IconTablet } from "./icons";

/**
 * The mobile website preview (requirement 6).
 *
 * On a phone the preview defaults to Mobile and renders the site at *native*
 * width — the iframe is the phone's own viewport, so the site's own mobile
 * breakpoints fire for real. That is the opposite of shrinking a desktop page
 * into a small box, which is what the requirement forbids.
 *
 * Tablet and Desktop are rendered at their true CSS widths (834 / 1440) and
 * then visually scaled down to fit. The site still *believes* it is that wide,
 * so its real desktop layout is what you see, just smaller.
 */

type Device = "mobile" | "tablet" | "desktop";

const DEVICES: { id: Device; label: string; width: number; height: number; Icon: typeof IconPhone }[] = [
  { id: "mobile", label: "Mobile", width: 390, height: 844, Icon: IconPhone },
  { id: "tablet", label: "Tablet", width: 834, height: 1112, Icon: IconTablet },
  { id: "desktop", label: "Desktop", width: 1440, height: 900, Icon: IconDesktop },
];

export function DevicePreview({
  projectId,
  businessName,
}: {
  projectId: string;
  businessName: string;
}) {
  const [device, setDevice] = useState<Device>("mobile");
  const [scale, setScale] = useState(1);
  const [nonce, setNonce] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const spec = DEVICES.find((d) => d.id === device)!;

  // On a phone, "mobile" means the site fills the available width at 1:1 — no
  // scaling, no device chrome, no letterboxing. Anything wider gets scaled to
  // fit the stage so the whole layout is visible without side-scrolling.
  useEffect(() => {
    const measure = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const available = stage.clientWidth;
      setScale(available >= spec.width ? 1 : available / spec.width);
    };
    measure();
    window.addEventListener("resize", measure);
    // Rotating the phone changes the stage size; recompute on orientation too.
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [spec.width, device]);

  const frameHeight = device === "mobile" ? undefined : spec.height;

  return (
    <AppShell>
      <AppBar
        title="Preview"
        subtitle={businessName}
        back={`/projects/${projectId}`}
        action={
          <a
            href={`/api/projects/${projectId}/render`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the website in a new tab"
            className="flex size-11 items-center justify-center rounded-full text-muted active:bg-elevated"
          >
            <IconExternal size={20} />
          </a>
        }
      />

      {/* Compact segmented selector — three targets, each comfortably 44px. */}
      <div
        role="radiogroup"
        aria-label="Preview size"
        className="my-3 flex gap-1 rounded-xl bg-elevated p-1"
      >
        {DEVICES.map((d) => {
          const active = device === d.id;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDevice(d.id)}
              className={`flex min-h-[var(--spacing-touch)] flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? "bg-surface text-brand shadow-sm"
                  : "text-muted"
              }`}
            >
              <d.Icon size={18} />
              {d.label}
            </button>
          );
        })}
      </div>

      <p className="mb-3 text-center text-xs text-muted">
        {spec.width}px viewport
        {scale < 0.999 && ` · shown at ${Math.round(scale * 100)}%`}
      </p>

      <div ref={stageRef} className="w-full">
        <div
          // The wrapper reserves the *scaled* height so the page below the
          // preview does not overlap it after transform.
          style={{
            height: frameHeight ? frameHeight * scale : undefined,
            overflow: "hidden",
          }}
          className="mx-auto rounded-card border border-line bg-white"
        >
          <iframe
            key={`${device}-${nonce}`}
            title={`${businessName} preview at ${spec.width} pixels wide`}
            src={`/api/projects/${projectId}/render`}
            // Allow the generated page's own scripts/forms but keep it firmly
            // out of this app's origin and away from top-level navigation.
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            loading="lazy"
            style={{
              width: spec.width,
              height: frameHeight ?? "70svh",
              border: 0,
              display: "block",
              transform: scale < 0.999 ? `scale(${scale})` : undefined,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <LinkButton
          href={`/projects/${projectId}/edit`}
          size="lg"
          block
          className="sm:flex-1"
        >
          Edit this website
        </LinkButton>
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center rounded-xl border border-line bg-surface px-6 text-base font-semibold active:scale-[0.98] sm:flex-1"
        >
          Refresh
        </button>
      </div>
    </AppShell>
  );
}
