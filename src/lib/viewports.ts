/**
 * The widths the application inspects a generated website at.
 *
 * One definition, two consumers: the automated visual QA audits every one of
 * these, and the live preview offers the same set as buttons. That is
 * deliberate — a creator who wants to see for themselves what the 320px
 * warning is about should be looking at exactly the width the warning came
 * from, not an approximation of it.
 *
 * Kept in its own module rather than in visual-qa.ts so the preview, which is
 * a client component, does not pull the whole audit into the browser bundle.
 */

export const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: 1440 },
  { id: "tablet", label: "Tablet", width: 834 },
  { id: "mobile", label: "Mobile", width: 390 },
  { id: "narrow", label: "Narrow mobile", width: 320 },
] as const;

export type ViewportId = (typeof VIEWPORTS)[number]["id"];

/** Tallest sensible frame per width, so the preview reserves a real page. */
export const VIEWPORT_HEIGHT: Record<ViewportId, number> = {
  desktop: 900,
  tablet: 1112,
  mobile: 844,
  narrow: 720,
};

/** The bounds a hand-typed custom width is held to. */
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 2560;
