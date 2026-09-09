import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  getProject, saveVersion, setDesignAnswers, updateProjectSite,
} from "@/server/projects";
import { db } from "@/server/db";
import { analyseIdentity, themeFromIdentity, type VisualIdentity } from "@/server/identity";
import { emptyProfile, type BusinessProfile } from "@/server/research";
import type { SiteKind } from "@/lib/site";

/**
 * Design decision questions (requirement 7).
 *
 * The questions are produced during identity analysis when the model could not
 * confidently settle a design decision. They are answered *after* generation
 * rather than blocking it: making a phone user wait at a modal before they
 * have seen anything would be a worse product, and re-running the design stage
 * is cheap because it touches only the theme.
 *
 * Crucially this re-runs the DESIGN stage only. All copy, all translations and
 * all structure are preserved.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) {
    return NextResponse.json({ error: "Generate the website first." }, { status: 400 });
  }

  const { answers } = (await req.json()) as { answers?: Record<string, string> };
  if (!answers || !Object.keys(answers).length) {
    return NextResponse.json({ error: "No answers were provided." }, { status: 400 });
  }

  setDesignAnswers(id, answers);
  saveVersion(id, "Before design refresh", project.site);

  const profile = (project.businessProfile as BusinessProfile | null) ?? emptyProfile();
  const identity = await analyseIdentity({
    profile,
    businessName: project.business_name,
    businessType: project.business_type,
    description: project.description,
    kind: project.site_kind as SiteKind,
    stylePreset: project.design.style ?? "classic",
    logoAssetId: project.logo_asset_id || null,
    // The creator's answers are the strongest signal available, so they are
    // passed as explicit design direction.
    designNotes: [
      project.design_notes,
      ...Object.entries(answers).map(([q, a]) => `${q} → ${a}`),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  // Only the theme moves. Sections and every locale's catalog are untouched.
  const next = {
    ...project.site,
    // Only the theme moves, and the skill's font pairing is preserved:
    // answering a question about mood should not silently drop typography.
    theme: themeFromIdentity(
      identity,
      project.site.meta.kind,
      project.site.theme.fontFamilies,
    ),
  };

  updateProjectSite(id, user.id, next);
  db.prepare("UPDATE projects SET design_system = ? WHERE id = ?").run(
    JSON.stringify({ ...identity, questions: [] as VisualIdentity["questions"] }),
    id,
  );

  return NextResponse.json({ ok: true, site: next, architecture: identity.architecture });
}

export const maxDuration = 300;
