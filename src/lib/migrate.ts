import { architecture } from "./architectures";
import {
  emptyCatalog, key, newId,
  type Section, type Site,
} from "./site";

/**
 * Upgrades a v1 Site document to v2 in place-safe fashion.
 *
 * v1 stored translatable text inline on each section and had no concept of a
 * locale. Projects generated before the multi-language work must keep working
 * untouched, so this lifts their existing copy into the default locale's
 * catalog and leaves everything else — order, visibility, images, prices —
 * exactly as it was.
 */

/* The shapes we are migrating *from*. Deliberately loose. */
type V1Section = { id: string; type: string; title?: string; visible?: boolean; props?: Record<string, unknown> };
type V1Site = {
  version?: number;
  meta?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  sections?: V1Section[];
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function isV2(doc: unknown): doc is Site {
  return Boolean(doc && typeof doc === "object" && (doc as { version?: number }).version === 2);
}

export function migrateToV2(doc: unknown, defaultLocale = "en"): Site {
  if (isV2(doc)) return doc;

  const v1 = (doc ?? {}) as V1Site;
  const strings: Record<string, string> = {};
  const sections: Section[] = [];

  const meta = (v1.meta ?? {}) as Record<string, unknown>;
  const oldSticky = (meta.stickyCta ?? {}) as Record<string, unknown>;

  strings[key.meta("tagline")] = str(meta.tagline);
  strings[key.meta("stickyCtaLabel")] = str(oldSticky.label) || "Contact";
  strings[key.meta("logoAlt")] = str(meta.businessName);
  strings[key.meta("skipToContent")] = "Skip to content";
  strings[key.meta("menuLabel")] = "Menu";

  for (const s of arr(v1.sections) as V1Section[]) {
    const p = (s.props ?? {}) as Record<string, unknown>;
    const id = s.id || newId("sec");
    const visible = s.visible !== false;
    const set = (field: string, value: string) => {
      strings[key.section(id, field)] = value;
    };
    set("title", str(s.title));

    switch (s.type) {
      case "hero":
        set("eyebrow", str(p.eyebrow));
        set("headline", str(p.headline));
        set("subheadline", str(p.subheadline));
        set("ctaLabel", str(p.ctaLabel));
        set("secondaryLabel", str(p.secondaryLabel));
        sections.push({
          id, type: "hero", visible,
          ctaHref: str(p.ctaHref), secondaryHref: str(p.secondaryHref),
          imageId: str(p.imageId),
        });
        break;

      case "about": {
        set("heading", str(p.heading));
        set("body", str(p.body));
        const highlights = arr(p.highlights).map((h) => {
          const rid = newId("hl");
          strings[key.row(id, rid, "text")] = str(h);
          return { id: rid };
        });
        sections.push({ id, type: "about", visible, imageId: str(p.imageId), highlights });
        break;
      }

      case "services": {
        set("heading", str(p.heading));
        set("intro", str(p.intro));
        const items = arr(p.items).map((raw) => {
          const it = raw as Record<string, unknown>;
          const rid = newId("svc");
          strings[key.row(id, rid, "name")] = str(it.name);
          strings[key.row(id, rid, "description")] = str(it.description);
          return { id: rid, price: str(it.price) };
        });
        sections.push({ id, type: "services", visible, items });
        break;
      }

      case "menu": {
        set("heading", str(p.heading));
        set("note", str(p.note));
        const categories = arr(p.categories).map((rawCat) => {
          const cat = rawCat as Record<string, unknown>;
          const cid = newId("cat");
          strings[key.row(id, cid, "name")] = str(cat.name);
          const items = arr(cat.items).map((rawItem) => {
            const it = rawItem as Record<string, unknown>;
            const iid = newId("itm");
            strings[key.menuItem(id, cid, iid, "name")] = str(it.name);
            strings[key.menuItem(id, cid, iid, "description")] = str(it.description);
            return {
              id: iid,
              price: str(it.price),
              tags: arr(it.tags).map(str).filter(Boolean),
            };
          });
          return { id: cid, items };
        });
        sections.push({ id, type: "menu", visible, categories });
        break;
      }

      case "gallery": {
        set("heading", str(p.heading));
        const imageIds = arr(p.imageIds).map(str).filter(Boolean);
        for (const imgId of imageIds) strings[key.row(id, imgId, "alt")] = "";
        sections.push({ id, type: "gallery", visible, imageIds });
        break;
      }

      case "hours": {
        set("heading", str(p.heading));
        set("note", str(p.note));
        const rows = arr(p.rows).map((raw) => {
          const r = raw as Record<string, unknown>;
          const rid = newId("day");
          strings[key.row(id, rid, "day")] = str(r.day);
          return { id: rid, hours: str(r.hours) };
        });
        sections.push({ id, type: "hours", visible, rows });
        break;
      }

      case "testimonials": {
        set("heading", str(p.heading));
        const items = arr(p.items).map((raw) => {
          const it = raw as Record<string, unknown>;
          const rid = newId("tst");
          strings[key.row(id, rid, "quote")] = str(it.quote);
          strings[key.row(id, rid, "author")] = str(it.author);
          return { id: rid };
        });
        sections.push({ id, type: "testimonials", visible, items });
        break;
      }

      case "cta":
        set("heading", str(p.heading));
        set("body", str(p.body));
        set("ctaLabel", str(p.ctaLabel));
        sections.push({ id, type: "cta", visible, ctaHref: str(p.ctaHref) });
        break;

      case "contact":
        set("heading", str(p.heading));
        set("address", str(p.address));
        set("bookingLabel", "Book now");
        sections.push({
          id, type: "contact", visible,
          phone: str(p.phone), email: str(p.email),
          mapsUrl: str(p.mapsUrl), bookingUrl: str(p.bookingUrl),
        });
        break;

      case "footer": {
        set("tagline", str(p.tagline));
        const links = arr(p.links).map((raw) => {
          const l = raw as Record<string, unknown>;
          const rid = newId("lnk");
          strings[key.row(id, rid, "label")] = str(l.label);
          return { id: rid, href: str(l.href) };
        });
        sections.push({ id, type: "footer", visible, links });
        break;
      }
    }
  }

  const oldTheme = (v1.theme ?? {}) as Record<string, unknown>;
  const oldColors = (oldTheme.colors ?? {}) as Record<string, unknown>;
  const oldFonts = (oldTheme.fonts ?? {}) as Record<string, unknown>;
  const kind = (str(meta.kind) || "business") as Site["meta"]["kind"];
  // v1 had no architecture. Infer a sensible one rather than flattening
  // every legacy project to the same look.
  const archId = kind === "menu" ? "menu-first" : "classic";
  const arch = architecture(archId);

  return {
    version: 2,
    meta: {
      businessName: str(meta.businessName),
      kind,
      defaultLocale,
      locales: [defaultLocale],
      logo: null,
      stickyCta: {
        enabled: Boolean(oldSticky.enabled),
        href: str(oldSticky.href),
      },
    },
    theme: {
      colors: {
        primary: str(oldColors.primary) || "#4338ca",
        secondary: str(oldColors.secondary) || "#1e1b4b",
        accent: str(oldColors.accent) || "#f59e0b",
        bg: str(oldColors.bg) || "#ffffff",
        text: str(oldColors.text) || "#16161d",
      },
      fonts: {
        heading: str(oldFonts.heading) || arch.fonts.heading,
        body: str(oldFonts.body) || arch.fonts.body,
      },
      layout: (["minimal", "balanced", "dense"] as const).includes(oldTheme.layout as never)
        ? (oldTheme.layout as Site["theme"]["layout"])
        : "balanced",
      radius: typeof oldTheme.radius === "number" ? oldTheme.radius : arch.radius,
      architecture: archId,
    },
    sections,
    i18n: {
      [defaultLocale]: {
        ...emptyCatalog(),
        strings,
        seo: {
          title: str(meta.businessName),
          description: str(meta.description),
          ogTitle: str(meta.businessName),
          ogDescription: str(meta.description),
          keywords: [],
        },
      },
    },
  };
}
