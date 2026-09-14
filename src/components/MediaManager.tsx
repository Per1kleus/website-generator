"use client";

import { useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Card, useToast } from "./ui";
import { IconCamera, IconFile, IconImage, IconTrash } from "./icons";
import type { Asset } from "@/server/projects";

/**
 * Mobile image uploads (requirement 10).
 *
 * Three distinct entry points, because on a phone they are three different
 * things and the OS treats them differently:
 *   - Take photo   -> capture="environment" opens the camera directly
 *   - Photo library-> accept="image/*" opens the photo picker
 *   - Choose file  -> no accept filter, opens Files/Drive/Dropbox
 *
 * Uploads run one at a time with visible per-file progress, because a café's
 * 4G uplink is the slowest part of this whole product.
 */
export function MediaManager({
  projectId,
  businessName,
  initialAssets,
  initialLogoId = "",
}: {
  projectId: string;
  businessName: string;
  initialAssets: Asset[];
  /** The logo currently on the website, if it has one. */
  initialLogoId?: string;
}) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [logoId, setLogoId] = useState(initialLogoId);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<{ name: string; done: number; total: number } | null>(null);
  const { toast, toastNode } = useToast();

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const list = Array.from(files);

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setUploading({ name: file.name, done: i, total: list.length });

      const body = new FormData();
      body.append("file", file);
      body.append("alt", file.name.replace(/\.[^.]+$/, ""));

      try {
        const res = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "That image could not be uploaded.");
          break;
        }
        setAssets((prev) => [data.asset as Asset, ...prev]);
      } catch {
        setError("Upload failed. Check your connection and try again.");
        break;
      }
    }

    setUploading(null);
    toast(list.length > 1 ? `${list.length} photos uploaded` : "Photo uploaded");
  }

  async function remove(asset: Asset) {
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    try {
      await fetch(`/api/assets/${asset.id}/delete`, { method: "POST" });
      toast("Photo removed");
    } catch {
      // Put it back — the delete did not happen.
      setAssets((prev) => [asset, ...prev]);
      setError("Could not remove that photo. Try again.");
    }
  }

  /**
   * Replace the logo.
   *
   * The same upload endpoint as any other image, with `role=logo`, which is
   * what routes it through the logo path: a larger size cap, alpha preserved,
   * SVG accepted and sanitised. The server also points the live document at
   * the new asset, so the change reaches the website and not just this screen.
   */
  async function replaceLogo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setLogoBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("role", "logo");
      body.append("alt", `${businessName} logo`);
      const res = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That logo could not be uploaded.");
        return;
      }
      setLogoId(data.asset.id as string);
      toast("Logo replaced");
    } catch {
      setError("Could not upload that logo. Check your connection and try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  const sources = [
    { label: "Take photo", hint: "Use the camera", Icon: IconCamera, ref: cameraRef },
    { label: "Choose from gallery", hint: "Your photo library", Icon: IconImage, ref: libraryRef },
    { label: "Choose file", hint: "Files, Drive, Dropbox", Icon: IconFile, ref: fileRef },
  ];

  return (
    <AppShell>
      <AppBar title="Images" subtitle={businessName} back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      {/* Hidden inputs: the visible buttons are the real, large targets. */}
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment"
        className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={libraryRef} type="file" accept="image/*" multiple
        className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={fileRef} type="file" multiple
        className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }}
      />

      {/* The logo is not one of the photographs: it is the brand mark, it has
          its own upload rules, and it is the thing people most often want to
          change after seeing the finished site. */}
      <input
        ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="hidden" onChange={(e) => { void replaceLogo(e.target.files); e.target.value = ""; }}
      />
      <section className="my-4" data-logo-card data-logo-id={logoId}>
        <Card>
          <h2 className="font-bold">Logo</h2>
          <div className="mt-3 flex items-center gap-3">
            {logoId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/assets/${logoId}?w=240`}
                alt={`${businessName} logo`}
                className="h-14 w-14 shrink-0 object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-elevated text-muted"
              >
                <IconImage size={22} />
              </span>
            )}
            <p className="min-w-0 flex-1 text-sm text-muted">
              {logoId
                ? "Shown in the header and used as the favicon. A replacement keeps its own proportions."
                : "Optional. Adding one puts it in the header and uses it as the favicon."}
            </p>
          </div>
          <button
            type="button"
            disabled={logoBusy}
            onClick={() => logoRef.current?.click()}
            data-logo-replace
            className="mt-3 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm font-semibold text-brand hover:bg-elevated active:bg-elevated disabled:opacity-50"
          >
            <IconImage size={18} /> {logoBusy ? "Uploading…" : logoId ? "Replace logo" : "Add a logo"}
          </button>
        </Card>
      </section>

      <div className="my-4 grid gap-2.5">
        {sources.map(({ label, hint, Icon, ref }) => (
          <button
            key={label}
            type="button"
            disabled={Boolean(uploading)}
            onClick={() => ref.current?.click()}
            className="flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border border-line bg-surface p-4 text-left active:scale-[0.99] disabled:opacity-50"
          >
            <span className="text-brand">
              <Icon size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-muted">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {uploading && (
        <Card className="mb-4">
          <p className="text-sm font-semibold">
            Uploading {uploading.done + 1} of {uploading.total}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{uploading.name}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${((uploading.done + 0.5) / uploading.total) * 100}%` }}
            />
          </div>
        </Card>
      )}

      <p className="mb-3 text-xs text-muted">
        Photos are resized, compressed to WebP, and stripped of location data
        automatically. Nothing needs to go via a computer.
      </p>

      {assets.length === 0 ? (
        <Card className="border-dashed text-center">
          <p className="text-sm text-muted">No photos yet.</p>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {assets.map((a) => (
            <li
              key={a.id}
              className="overflow-hidden rounded-card border border-line bg-surface"
            >
              <div className="aspect-square bg-elevated">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/assets/${a.id}?w=400`}
                  alt={a.alt || a.filename}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                />
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium">{a.alt || a.filename}</p>
                <p className="text-[0.6875rem] text-muted">
                  {a.width}×{a.height} · {Math.round(a.bytes / 1024)}KB
                </p>
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label={`Remove ${a.alt || a.filename}`}
                  className="mt-1.5 flex min-h-[var(--spacing-touch)] w-full items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-danger hover:bg-elevated active:bg-elevated"
                >
                  <IconTrash size={16} /> Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {toastNode}
    </AppShell>
  );
}
