/**
 * Colour contrast maths, shared by the renderer, the design catalogue bridge
 * and the identity analysis.
 *
 * This lives in `lib` rather than on the server because the renderer needs it:
 * a palette can arrive from a hosted model, from the ui-ux-pro-max catalogue,
 * or from a creator's colour picker, and none of those can be trusted to
 * produce a readable pairing on their own. Contrast is guaranteed at the point
 * of use rather than assumed at the point of choice.
 */

const HEX = /^#[0-9a-f]{6}$/i;

function channel(hex: string, index: number): number {
  return parseInt(hex.replace("#", "").slice(index * 2, index * 2 + 2), 16);
}

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  if (!HEX.test(hex)) return 0;
  return (
    0.2126 * srgbToLinear(channel(hex, 0)) +
    0.7152 * srgbToLinear(channel(hex, 1)) +
    0.0722 * srgbToLinear(channel(hex, 2))
  );
}

export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 0;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Slightly-off neutrals: pure black on pure white is harsh to read. */
export const INK = "#14141a";
export const PAPER = "#f7f7f8";

/**
 * The readable foreground for a given background.
 *
 * Used for button labels: a solid button's fill can be any colour, and the
 * label has to be legible on it whatever the palette source decided. Picking
 * the better of light and dark is both simple and always correct.
 */
export function readableOn(background: string): string {
  if (!HEX.test(background)) return INK;
  return contrastRatio(PAPER, background) >= contrastRatio(INK, background) ? PAPER : INK;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Nudges `colour` toward or away from `against` until the pair reaches `ratio`,
 * keeping the hue. Returns the closest it got if the target is unreachable.
 */
export function ensureContrast(colour: string, against: string, ratio: number): string {
  if (!HEX.test(colour) || !HEX.test(against)) return colour;
  if (contrastRatio(colour, against) >= ratio) return colour;

  let r = channel(colour, 0);
  let g = channel(colour, 1);
  let b = channel(colour, 2);
  // A light background needs the colour darkened, and vice versa.
  const darken = relativeLuminance(against) > 0.4;

  for (let i = 0; i < 32; i++) {
    const hex = toHex(r, g, b);
    if (contrastRatio(hex, against) >= ratio) return hex;
    if (darken) {
      r *= 0.9;
      g *= 0.9;
      b *= 0.9;
    } else {
      r += (255 - r) * 0.1;
      g += (255 - g) * 0.1;
      b += (255 - b) * 0.1;
    }
  }
  return darken ? INK : PAPER;
}

export type Palette = {
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  text: string;
};

/**
 * Makes a palette readable without discarding the designer's intent.
 *
 * Thresholds follow WCAG: 7:1 for body text (AAA — these sites are read on
 * phones outdoors), 4.5:1 for the primary colour, which is used both as a
 * button fill and as small coloured text like the hero eyebrow, and 3:1 for
 * the accent, which only ever carries large or non-text elements.
 */
export function repairPalette(colors: Palette): Palette {
  const out = { ...colors };
  if (contrastRatio(out.text, out.bg) < 7) {
    out.text = readableOn(out.bg);
  }
  out.primary = ensureContrast(out.primary, out.bg, 4.5);
  out.accent = ensureContrast(out.accent, out.bg, 3);
  return out;
}
