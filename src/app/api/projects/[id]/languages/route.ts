import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getProject, saveVersion, syncLocales, updateProjectSite } from "@/server/projects";
import { addLocale, fillMissingStrings, removeLocale } from "@/server/translate";
import { validateSite } from "@/server/validate";
import { isSupportedLocale } from "@/lib/locales";

/**
 * Creator-side language management (requirements 9, 17, 18).
 *
 * Adding a language translates the existing catalog and touches nothing else —
 * no regeneration, no design change. Removing one deletes only its catalog.
 * The default language can never be removed.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const { action, locale } = (await req.json()) as { action?: string; locale?: string };
  if (!locale || !isSupportedLocale(locale)) {
    return NextResponse.json({ error: "That language is not supported." }, { status: 400 });
  }

  const site = project.site;

  if (action === "remove") {
    if (locale === site.meta.defaultLocale) {
      return NextResponse.json(
        { error: "The default language cannot be removed. Change the default first." },
        { status: 400 },
      );
    }
    const next = removeLocale(site, locale);
    updateProjectSite(id, user.id, next);
    return NextResponse.json({ ok: true, site: next });
  }

  if (action === "setDefault") {
    if (!site.meta.locales.includes(locale)) {
      return NextResponse.json({ error: "Enable that language first." }, { status: 400 });
    }
    const next = { ...site, meta: { ...site.meta, defaultLocale: locale } };
    updateProjectSite(id, user.id, next);
    syncLocales(id, locale, next.meta.locales);
    return NextResponse.json({ ok: true, site: next });
  }

  // add / retranslate: snapshot first so the creator can always go back.
  saveVersion(id, `Before ${action === "retranslate" ? "re-translating" : "adding"} ${locale.toUpperCase()}`, site);

  const next =
    action === "retranslate"
      ? await fillMissingStrings(site, locale)
      : await addLocale(site, locale);

  updateProjectSite(id, user.id, next);
  return NextResponse.json({
    ok: true,
    site: next,
    warnings: validateSite(next).filter((f) => f.area === "language").map((f) => f.message),
  });
}

// Translation is a model call across the whole catalog.
export const maxDuration = 600;
