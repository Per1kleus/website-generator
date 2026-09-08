import type { LayoutDensity, SiteKind, Theme } from "./site";

/**
 * Style presets, shared by the creation wizard (client) and the generator
 * (server). Every palette below was checked for AA contrast between `text`
 * and `bg`, and between `bg` and `primary` used as a button fill.
 */
export const PALETTES: Record<string, Theme["colors"]> = {
  indigo:   { primary: "#4338ca", secondary: "#1e1b4b", accent: "#f59e0b", bg: "#ffffff", text: "#16161d" },
  forest:   { primary: "#166534", secondary: "#052e16", accent: "#ca8a04", bg: "#fbfdf9", text: "#12200f" },
  ember:    { primary: "#b91c1c", secondary: "#450a0a", accent: "#0f766e", bg: "#fffaf7", text: "#1c1414" },
  ocean:    { primary: "#0e7490", secondary: "#083344", accent: "#f97316", bg: "#f8fdff", text: "#0f1e24" },
  plum:     { primary: "#7e22ce", secondary: "#3b0764", accent: "#059669", bg: "#fdfaff", text: "#1c1424" },
  charcoal: { primary: "#111827", secondary: "#374151", accent: "#d97706", bg: "#fafafa", text: "#111827" },
  sand:     { primary: "#92400e", secondary: "#451a03", accent: "#0369a1", bg: "#fffcf5", text: "#1f1710" },
  rose:     { primary: "#be185d", secondary: "#500724", accent: "#0d9488", bg: "#fffafc", text: "#20141a" },
};

export const STYLE_PRESETS = {
  minimal: { palette: "charcoal", heading: "grotesk", body: "system",  layout: "minimal"  as LayoutDensity, radius: 6 },
  warm:    { palette: "sand",     heading: "serif",   body: "system",  layout: "balanced" as LayoutDensity, radius: 14 },
  bold:    { palette: "ember",    heading: "grotesk", body: "grotesk", layout: "balanced" as LayoutDensity, radius: 4 },
  elegant: { palette: "plum",     heading: "serif",   body: "serif",   layout: "minimal"  as LayoutDensity, radius: 2 },
  fresh:   { palette: "forest",   heading: "rounded", body: "system",  layout: "balanced" as LayoutDensity, radius: 18 },
  coastal: { palette: "ocean",    heading: "rounded", body: "system",  layout: "balanced" as LayoutDensity, radius: 16 },
  classic: { palette: "indigo",   heading: "system",  body: "system",  layout: "balanced" as LayoutDensity, radius: 12 },
  vibrant: { palette: "rose",     heading: "grotesk", body: "system",  layout: "dense"    as LayoutDensity, radius: 20 },
} as const;

export type StylePreset = keyof typeof STYLE_PRESETS;

export const STYLE_OPTIONS: {
  id: StylePreset;
  label: string;
  hint: string;
  swatches: string[];
}[] = (
  [
    ["minimal", "Minimal", "Quiet, spacious"],
    ["warm", "Warm", "Friendly, inviting"],
    ["bold", "Bold", "High contrast"],
    ["elegant", "Elegant", "Refined, editorial"],
    ["fresh", "Fresh", "Light and natural"],
    ["coastal", "Coastal", "Airy and open"],
    ["classic", "Classic", "Trusted and clear"],
    ["vibrant", "Vibrant", "Playful, energetic"],
  ] as const
).map(([id, label, hint]) => {
  const p = PALETTES[STYLE_PRESETS[id].palette];
  return { id, label, hint, swatches: [p.primary, p.accent, p.secondary] };
});

export function themeFor(style: string, kind: SiteKind): Theme {
  const preset = STYLE_PRESETS[style as StylePreset] ?? STYLE_PRESETS.classic;
  return {
    colors: { ...PALETTES[preset.palette] },
    fonts: { heading: preset.heading, body: preset.body },
    // A digital menu is always dense: guests want prices on screen, not air.
    layout: kind === "menu" ? "dense" : preset.layout,
    radius: preset.radius,
  };
}
