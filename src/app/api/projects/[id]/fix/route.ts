import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  getProject, listAssets, saveVersion, updateProjectSite,
} from "@/server/projects";
import { correctSite } from "@/lib/qa-fix";

/**
 * Apply the safe corrections the readiness report offered.
 *
 * This is the same engine generation already runs — `lib/qa-fix.ts`, bounded
 * to a couple of passes, discarding any pass that makes the score worse. It is
 * not a second QA system and it invents nothing.
 *
 * What it will never do is rewrite the business's own words. Every fixer
 * changes a decision this application made: a heading scale, a line length,
 * the vertical rhythm, which photograph leads the page, whether an empty
 * section is displayed. Copy is reported to the creator and left exactly as
 * they wrote it — which is why this can be a button at all.
 *
 * The document as it was is saved first, so pressing it is reversible from
 * version history.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const project = getProject(id, user.id);
  if (!project?.site) return NextResponse.json({ error: "Nothing to fix yet." }, { status: 404 });

  const images = Object.fromEntries(
    listAssets(id).map((a) => [a.id, { width: a.width, height: a.height, bytes: a.bytes }]),
  );

  const outcome = correctSite({
    site: project.site,
    locale: project.site.meta.defaultLocale,
    images,
  });

  if (!outcome.applied.length) {
    return NextResponse.json({
      ok: true,
      applied: [],
      message: "Nothing could be fixed automatically.",
    });
  }

  saveVersion(id, "Before automatic fixes", project.site);
  updateProjectSite(id, user.id, outcome.site);
  // Recorded as a correction rather than a manual edit, so history reads as
  // what actually happened.
  saveVersion(id, `Fixed ${outcome.applied.length} issue${outcome.applied.length === 1 ? "" : "s"}`,
    outcome.site, "correction");

  return NextResponse.json({
    ok: true,
    applied: outcome.applied,
    score: outcome.report.score,
  });
}
