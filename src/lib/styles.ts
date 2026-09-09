import { architecture } from "./architectures";
import type { LayoutDensity, SiteKind, Theme } from "./site";

/**
 * Colour palettes and creator-facing style presets.
 *
 * A preset is a *starting point* the creator can pick in the wizard; the
 * generator's identity analysis may override it entirely once it has looked at
 * the real business. Every pair below clears WCAG AA for body text on its own
 * background.
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
  olive:    { primary: "#4d7c0f", secondary: "#1a2e05", accent: "#b45309", bg: "#fcfdf7", text: "#1a1f12" },
  slate:    { primary: "#334155", secondary: "#0f172a", accent: "#0891b2", bg: "#f8fafc", text: "#0f172a" },
  terracotta: { primary: "#9a3412", secondary: "#431407", accent: "#0f766e", bg: "#fffaf6", text: "#231510" },
  midnight: { primary: "#1e3a8a", secondary: "#0c1633", accent: "#eab308", bg: "#f7f9ff", text: "#111827" },
};

/**
 * Creator presets. Each names a palette *and* a design architecture, so
 * picking "Elegant" really does produce a different composition, not just
 * different colours.
 */
export const STYLE_PRESETS = {
  minimal:  { palette: "charcoal",   architecture: "minimal",          layout: "minimal"  as LayoutDensity },
  warm:     { palette: "sand",       architecture: "mediterranean",    layout: "balanced" as LayoutDensity },
  bold:     { palette: "ember",      architecture: "brutalist",        layout: "balanced" as LayoutDensity },
  elegant:  { palette: "plum",       architecture: "luxury",           layout: "minimal"  as LayoutDensity },
  fresh:    { palette: "olive",      architecture: "organic",          layout: "balanced" as LayoutDensity },
  coastal:  { palette: "ocean",      architecture: "image-first",      layout: "balanced" as LayoutDensity },
  classic:  { palette: "indigo",     architecture: "classic",          layout: "balanced" as LayoutDensity },
  vibrant:  { palette: "rose",       architecture: "experimental",     layout: "dense"    as LayoutDensity },
  editorial:{ palette: "slate",      architecture: "editorial",        layout: "balanced" as LayoutDensity },
  crafted:  { palette: "terracotta", architecture: "typography-first", layout: "minimal"  as LayoutDensity },
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
    ["bold", "Bold", "Raw, high contrast"],
    ["elegant", "Elegant", "Refined, premium"],
    ["fresh", "Fresh", "Natural, soft"],
    ["coastal", "Coastal", "Photography-led"],
    ["classic", "Classic", "Trusted, clear"],
    ["vibrant", "Vibrant", "Playful, energetic"],
    ["editorial", "Editorial", "Magazine-like"],
    ["crafted", "Crafted", "Typographic"],
  ] as const
).map(([id, label, hint]) => {
  const p = PALETTES[STYLE_PRESETS[id].palette];
  return { id, label, hint, swatches: [p.primary, p.accent, p.secondary] };
});

export function themeFor(style: string, kind: SiteKind): Theme {
  const preset = STYLE_PRESETS[style as StylePreset] ?? STYLE_PRESETS.classic;
  // A digital menu overrides the architecture: the guest wants prices, and
  // menu-first is the only composition that puts them first.
  const archId = kind === "menu" ? "menu-first" : preset.architecture;
  const arch = architecture(archId);

  return {
    colors: { ...PALETTES[preset.palette] },
    fonts: { ...arch.fonts },
    layout: kind === "menu" ? "dense" : preset.layout,
    radius: arch.radius,
    architecture: archId,
  };
}
