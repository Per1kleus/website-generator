import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { createProject } from "@/server/projects";
import { SITE_KINDS } from "@/lib/site";
import { STYLE_PRESETS } from "@/lib/styles";
import { isProbablyMapsUrl } from "@/lib/maps";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json()) as Record<string, string>;
  const businessName = (body.businessName ?? "").trim();

  if (businessName.length < 2) {
    return NextResponse.json({ error: "Enter the name of the business." }, { status: 400 });
  }
  const mapsUrl = (body.mapsUrl ?? "").trim();
  if (mapsUrl && !isProbablyMapsUrl(mapsUrl)) {
    return NextResponse.json({ error: "That is not a Google Maps link." }, { status: 400 });
  }
  if (!mapsUrl && !(body.location ?? "").trim()) {
    return NextResponse.json(
      { error: "Add a Google Maps link or a town/city." },
      { status: 400 },
    );
  }

  const siteKind = SITE_KINDS.some((k) => k.id === body.siteKind) ? body.siteKind : "business";
  const style = body.style in STYLE_PRESETS ? body.style : "classic";

  const project = createProject({
    userId: user.id,
    name: businessName,
    businessName,
    businessType: (body.businessType ?? "").trim(),
    siteKind,
    mapsUrl,
    location: (body.location ?? "").trim(),
    phone: (body.phone ?? "").trim(),
    email: (body.email ?? "").trim(),
    description: (body.description ?? "").trim(),
    style,
  });

  return NextResponse.json({ ok: true, project: { id: project.id } });
}
