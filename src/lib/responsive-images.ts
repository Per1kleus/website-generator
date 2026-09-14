import type { ImageRole } from "./site";

/**
 * How wide a photograph actually needs to be.
 *
 * A phone at 390 CSS pixels asking for a 3000px hero downloads roughly eight
 * times the data it can display, on the connection least able to afford it.
 * The fix is the browser's own: offer several widths and describe how much of
 * the viewport the image occupies, and it picks — accounting for the device
 * pixel ratio, which is why the ladder goes beyond 390 rather than stopping
 * at the CSS width of a phone.
 *
 * Two rules hold everywhere here:
 *
 *   Never upscale. A variant wider than the file we hold would be a bigger
 *   download of a blurrier picture. Widths above the natural width are
 *   dropped, and an image smaller than the first rung is served as itself.
 *
 *   One fixed ladder. The widths are a closed set, so the cache is bounded
 *   and a request for an arbitrary width cannot fill the disk.
 */
export const VARIANT_WIDTHS = [390, 780, 1200, 1600] as const;

export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/** True for a width this application is willing to generate and cache. */
export function isVariantWidth(width: number): width is VariantWidth {
  return (VARIANT_WIDTHS as readonly number[]).includes(width);
}

/**
 * The widths worth generating for one image.
 *
 * Empty when the image is too small to be worth splitting up, which the
 * caller reads as "just serve the original".
 */
export function variantsFor(naturalWidth: number): VariantWidth[] {
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) return [];
  const usable = VARIANT_WIDTHS.filter((w) => w < naturalWidth);
  // One variant that is nearly the original is not worth a second file.
  return usable.length && naturalWidth - usable[usable.length - 1] < 80
    ? usable.slice(0, -1)
    : usable;
}

/**
 * How much of the viewport this role occupies, in the shape `sizes` wants.
 *
 * These mirror the layout the renderer actually emits — the 52rem breakpoint
 * is the one the stylesheet uses — because a `sizes` that disagrees with the
 * CSS makes the browser choose badly in a way nobody ever notices.
 */
const SIZES: Record<ImageRole, string> = {
  // Full-bleed at every width.
  hero: "100vw",
  // Beside the text on a wide screen, full width on a phone.
  section: "(min-width: 52rem) 50vw, 100vw",
  // Three across on a wide screen, two on a phone.
  gallery: "(min-width: 52rem) 33vw, 50vw",
  showcase: "(min-width: 52rem) 50vw, 100vw",
  supporting: "(min-width: 52rem) 33vw, 50vw",
  // A menu thumbnail is a fixed square beside its dish; it never scales with
  // the viewport, so the smallest variant is always the right one.
  menu: "200px",
};

export function sizesFor(role: ImageRole): string {
  return SIZES[role] ?? "100vw";
}

/**
 * The `srcset` for one image, or "" when there is nothing useful to offer.
 *
 * `url(width)` builds the address for a given variant — an API query in the
 * preview, a file name in a published bundle — so this module never needs to
 * know which of the two it is serving.
 */
export function srcsetFor(
  naturalWidth: number,
  url: (width: VariantWidth) => string,
  originalUrl: string,
): string {
  const widths = variantsFor(naturalWidth);
  if (!widths.length) return "";
  // The original is the last candidate, described by its real width, so a
  // desktop at high density can still reach full quality rather than being
  // capped at the widest variant.
  return [
    ...widths.map((w) => `${url(w)} ${w}w`),
    `${originalUrl} ${Math.round(naturalWidth)}w`,
  ].join(", ");
}
