import "server-only";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_DIR } from "./db";
import type { Asset } from "./projects";
import type { DesignSignals } from "@/lib/tokens";
import { key, type ImageRole, type ImagePlacement, type Site } from "@/lib/site";
import { buildAltText } from "@/lib/seo";
import { ROLE_ASPECT } from "@/lib/render";

/**
 * Image intelligence.
 *
 * The difference between a photograph that was *placed* and one that was
 * *inserted* is mostly three decisions: which picture belongs where, how it is
 * cropped, and what the page reserves for it before it loads. This module
 * makes those three decisions from the pictures a business actually has.
 *
 * It adds no model. Everything here is measurement — dimensions, aspect,
 * resolution, and where the detail actually sits in the frame, which sharp can
 * tell us from the image's own statistics. The one judgement that is not
 * measurable, "is this the right picture for this business", is left where it
 * already lives: with the person who uploaded it.
 *
 * The rule that does not bend: no photographs means no photograph-shaped
 * sections. A gallery of nothing, or a hero with a grey box in it, is worse
 * than a page that was designed for type.
 */

/** What we can measure about one picture. */
export type ImageInsight = {
  id: string;
  width: number;
  height: number;
  bytes: number;
  alt: string;
  aspect: number;
  shape: "portrait" | "square" | "landscape" | "panorama";
  /** Longest edge, which is what decides whether it can lead a page. */
  edge: number;
  /** Where the detail is, 0–1 in each axis. Drives object-position. */
  focal: { x: number; y: number };
  /** Enough resolution to sit full-bleed at the top of a page. */
  heroCapable: boolean;
};

function shapeOf(aspect: number): ImageInsight["shape"] {
  if (aspect < 0.9) return "portrait";
  if (aspect < 1.15) return "square";
  if (aspect < 2.1) return "landscape";
  return "panorama";
}

/**
 * Where the interesting part of a picture is.
 *
 * A nine-cell grid, scored by how much variation each cell contains: detail
 * varies, empty sky and blurred backgrounds do not. The centre of mass of that
 * score is the focal point, and it is what lets a wide photograph be cropped
 * to a tall phone hero without cutting the subject's head off.
 *
 * Deliberately cheap — the image is read once at 90px — and it never fails the
 * pipeline: an unreadable file falls back to the centre, which is what a naive
 * crop would have used anyway.
 */
export async function focalPoint(source: string | Buffer): Promise<{ x: number; y: number }> {
  try {
    const size = 90;
    const raw = await sharp(source, { failOn: "none" })
      .resize(size, size, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();

    const cell = size / 3;
    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;

    for (let gy = 0; gy < 3; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        for (let y = Math.floor(gy * cell); y < Math.floor((gy + 1) * cell); y++) {
          for (let x = Math.floor(gx * cell); x < Math.floor((gx + 1) * cell); x++) {
            const v = raw[y * size + x];
            sum += v;
            sumSq += v * v;
            n++;
          }
        }
        // Standard deviation: high where there is detail, near zero on a
        // plain wall or an empty sky.
        const mean = sum / n;
        const weight = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
        totalWeight += weight;
        sumX += weight * ((gx + 0.5) / 3);
        sumY += weight * ((gy + 0.5) / 3);
      }
    }

    if (totalWeight <= 0) return { x: 0.5, y: 0.5 };
    return {
      x: Number(Math.min(0.85, Math.max(0.15, sumX / totalWeight)).toFixed(3)),
      y: Number(Math.min(0.85, Math.max(0.15, sumY / totalWeight)).toFixed(3)),
    };
  } catch {
    return { x: 0.5, y: 0.5 };
  }
}

/** Measure every photograph a project has. Logos are not photographs. */
export async function inspectAssets(assets: Asset[]): Promise<ImageInsight[]> {
  const photos = assets.filter((a) => a.role !== "logo" && a.width > 0 && a.height > 0);
  return Promise.all(
    photos.map(async (a) => {
      const aspect = a.width / a.height;
      return {
        id: a.id,
        width: a.width,
        height: a.height,
        bytes: a.bytes,
        alt: a.alt,
        aspect: Number(aspect.toFixed(3)),
        shape: shapeOf(aspect),
        edge: Math.max(a.width, a.height),
        // Measured at upload; only fall back to decoding for assets that
        // predate that, so generating never re-reads every photograph.
        focal:
          a.focal_x !== 0.5 || a.focal_y !== 0.5
            ? { x: a.focal_x, y: a.focal_y }
            : await focalPoint(path.join(UPLOAD_DIR, `${a.id}.webp`)),
        // 1200px is the point below which a photograph starts to look soft
        // stretched across a laptop.
        heroCapable: Math.max(a.width, a.height) >= 1200 && aspect >= 0.9,
      };
    }),
  );
}

/* -------------------------------------------------------------------------
   Roles
------------------------------------------------------------------------- */

/**
 * The aspect a picture is cropped to, per role and per screen.
 *
 * A hero and a gallery tile are not the same picture problem: a hero is a
 * band the eye enters through and is cropped wide on a laptop and tall on a
 * phone; a gallery tile is a set of siblings that must agree with each other.
 */
export { ROLE_ASPECT as ROLE_RATIOS } from "@/lib/render";

/**
 * Give every picture a job.
 *
 * The ordering is the argument: the widest, highest-resolution photograph
 * leads, because that is the one that survives being cropped to a band; the
 * rest fill the gallery in the order they were given, which is the creator's
 * own order and better than any score we could invent.
 *
 * `visualWeight` decides how much of the page is willing to carry images at
 * all — the same signal the layout engine already uses, so a law firm with two
 * stock photographs does not become an image-led site.
 */
export function assignRoles(
  insights: ImageInsight[],
  opts: { signals: DesignSignals; kind: Site["meta"]["kind"]; wantsGallery: boolean },
): ImagePlacement[] {
  if (!insights.length) return [];

  const byQuality = [...insights].sort((a, b) => {
    // Hero first: wide and large. Everything else keeps upload order.
    if (a.heroCapable !== b.heroCapable) return a.heroCapable ? -1 : 1;
    return b.edge * Math.min(b.aspect, 2) - a.edge * Math.min(a.aspect, 2);
  });

  const placements: ImagePlacement[] = [];
  const [lead, ...rest] = byQuality;

  // A menu is read at a table; it never gets a decorative hero.
  const heroAllowed = opts.kind !== "menu" && opts.signals.visualWeight >= 0.45;

  if (lead && heroAllowed && lead.heroCapable) {
    placements.push(placement(lead, "hero"));
  } else if (lead) {
    placements.push(placement(lead, opts.kind === "menu" ? "menu" : "section"));
  }

  for (const insight of rest) {
    const role: ImageRole = !opts.wantsGallery
      ? "supporting"
      : opts.signals.visualWeight >= 0.75
        ? "showcase"
        : "gallery";
    placements.push(placement(insight, role));
  }

  return placements;
}

function placement(insight: ImageInsight, role: ImageRole): ImagePlacement {
  return {
    assetId: insight.id,
    role,
    width: insight.width,
    height: insight.height,
    focalX: insight.focal.x,
    focalY: insight.focal.y,
    ratio: ROLE_ASPECT[role],
    // Only the picture at the top of the page is worth blocking on.
    priority: role === "hero",
  };
}

/**
 * Apply the placements to the document.
 *
 * Sections that need a picture get one; sections that were only ever going to
 * hold pictures are switched off when there are none. Nothing is invented, and
 * a gallery is never conjured to fill a template.
 */
export function applyImages(site: Site, placements: ImagePlacement[]): Site {
  const byRole = (role: ImageRole) => placements.filter((p) => p.role === role);
  const hero = byRole("hero")[0] ?? null;
  const section = byRole("section")[0] ?? null;
  const gallery = [...byRole("gallery"), ...byRole("showcase")];

  const sections = site.sections.map((s) => {
    switch (s.type) {
      case "hero": {
        if (hero) return { ...s, imageId: hero.assetId };
        // An image-led hero with no image to lead with is a grey box. The
        // composition changes to one that was designed for type instead.
        const needsImage = s.layout === "image-led" || s.layout === "poster";
        return {
          ...s,
          imageId: "",
          layout: needsImage ? ("typographic" as const) : s.layout,
        };
      }
      case "about": {
        const chosen = section ?? (hero ? null : gallery[0] ?? null);
        return chosen ? { ...s, imageId: chosen.assetId } : s;
      }
      case "gallery": {
        const ids = gallery.map((p) => p.assetId);
        // No photographs means no gallery. The section stays in the document
        // so the creator can fill it later; it just does not render.
        return { ...s, imageIds: ids, visible: ids.length > 0 && s.visible };
      }
      default:
        return s;
    }
  });

  return { ...site, sections, images: placements.length ? placements : undefined };
}

/**
 * Give every placed photograph alt text.
 *
 * Order of preference is the order of who knows most: the creator's own
 * description of the picture, then anything already in the catalog, then a
 * truthful fallback built from verified facts — the business and, if it was
 * confirmed, where it is. What is actually *in* the frame is never guessed:
 * "a plate of grilled octopus" is a claim, and this module cannot see.
 */
export function applyAltText(site: Site, assets: Asset[]): Site {
  const locale = site.meta.defaultLocale;
  const catalog = site.i18n[locale];
  if (!catalog) return site;

  const altOf = new Map(assets.map((a) => [a.id, a.alt ?? ""]));
  const roleOf = new Map((site.images ?? []).map((p) => [p.assetId, p.role]));
  const strings = { ...catalog.strings };
  const input = { site, locale, facts: site.meta.facts ?? null };

  const fill = (k: string, assetId: string, fallbackRole: ImageRole) => {
    if (strings[k]?.trim()) return;
    const role = roleOf.get(assetId) ?? fallbackRole;
    const text = buildAltText(input, altOf.get(assetId) ?? "", role);
    if (text) strings[k] = text;
  };

  for (const section of site.sections) {
    if (section.type === "hero" && section.imageId) {
      fill(key.section(section.id, "imageAlt"), section.imageId, "hero");
    }
    if (section.type === "about" && section.imageId) {
      fill(key.section(section.id, "imageAlt"), section.imageId, "section");
    }
    if (section.type === "gallery") {
      for (const id of section.imageIds) fill(key.row(section.id, id, "alt"), id, "gallery");
    }
  }

  return { ...site, i18n: { ...site.i18n, [locale]: { ...catalog, strings } } };
}

/**
 * Keep placements honest after the creator edits the page.
 *
 * The generator decides roles from measurements; the editor lets someone pick
 * a different picture afterwards. Without this, that picture renders against
 * the previous one's dimensions and the page jumps as it loads.
 *
 * Deliberately cheap: it reads the sizes already recorded at upload and reuses
 * any focal point already computed. No image is decoded again, so saving a
 * section stays instant.
 */
export function syncPlacements(site: Site, assets: Asset[]): Site {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const existing = new Map((site.images ?? []).map((p) => [p.assetId, p]));

  const wanted: { assetId: string; role: ImageRole }[] = [];
  for (const section of site.sections) {
    if (section.type === "hero" && section.imageId) {
      wanted.push({ assetId: section.imageId, role: "hero" });
    }
    if (section.type === "about" && section.imageId) {
      wanted.push({ assetId: section.imageId, role: "section" });
    }
    if (section.type === "gallery") {
      for (const id of section.imageIds) wanted.push({ assetId: id, role: "gallery" });
    }
    if (section.type === "menu") {
      for (const category of section.categories) {
        for (const item of category.items) {
          if (item.imageId) wanted.push({ assetId: item.imageId, role: "menu" });
        }
      }
    }
  }

  const placements: ImagePlacement[] = [];
  const seen = new Set<string>();
  for (const { assetId, role } of wanted) {
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    const asset = byId.get(assetId);
    const prior = existing.get(assetId);
    // An id we know nothing about (an asset deleted since) drops out rather
    // than being carried forward with invented dimensions.
    if (!asset && !prior) continue;
    placements.push({
      assetId,
      role,
      width: asset?.width || prior?.width || 0,
      height: asset?.height || prior?.height || 0,
      focalX: asset?.focal_x ?? prior?.focalX ?? 0.5,
      focalY: asset?.focal_y ?? prior?.focalY ?? 0.5,
      ratio: ROLE_ASPECT[role],
      priority: role === "hero",
    });
  }

  return { ...site, images: placements.length ? placements : undefined };
}
