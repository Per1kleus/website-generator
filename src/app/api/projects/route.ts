import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { adoptAsset, createProject } from "@/server/projects";
import { isSupportedLocale } from "@/lib/locales";
import { SITE_KINDS } from "@/lib/site";
import { STYLE_PRESETS } from "@/lib/styles";
import { isProbablyMapsUrl } from "@/lib/maps";
import { checkWebsiteUrl } from "@/lib/website-url";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const s = (k: string) => String(body[k] ?? "").trim();

  const businessName = s("businessName");
  if (businessName.length < 2) {
    return NextResponse.json({ error: "Enter the name of the business." }, { status: 400 });
  }

  const mapsUrl = s("mapsUrl");
  if (mapsUrl && !isProbablyMapsUrl(mapsUrl)) {
    return NextResponse.json({ error: "That is not a Google Maps link." }, { status: 400 });
  }
  // Requirement 1: a Google Maps URL OR a written description is enough.
  if (!mapsUrl && !s("description") && !s("location")) {
    return NextResponse.json(
      { error: "Add a Google Maps link, or describe the business." },
      { status: 400 },
    );
  }

  // The existing website is optional in the strongest sense: leaving it empty
  // is a success. A malformed one is rejected with a message that says what is
  // wrong, so the creator can fix it or clear the field and carry on.
  const website = checkWebsiteUrl(s("websiteUrl"));
  if (!website.ok) {
    return NextResponse.json(
      { error: `${website.error} You can also leave that field empty.` },
      { status: 400 },
    );
  }

  const siteKind = SITE_KINDS.some((k) => k.id === body.siteKind) ? s("siteKind") : "business";
  const style = s("style") in STYLE_PRESETS ? s("style") : "classic";

  const defaultLocale = isSupportedLocale(s("defaultLocale")) ? s("defaultLocale") : "en";
  const requested = Array.isArray(body.locales) ? (body.locales as unknown[]).map(String) : [];
  const locales = [
    defaultLocale,
    ...requested.filter((l) => isSupportedLocale(l) && l !== defaultLocale),
  ];

  const project = createProject({
    userId: user.id,
    name: businessName,
    businessName,
    businessType: s("businessType"),
    siteKind,
    mapsUrl,
    websiteUrl: website.url,
    location: s("location"),
    phone: s("phone"),
    email: s("email"),
    description: s("description"),
    style,
    designNotes: s("designNotes"),
    logoAssetId: s("logoAssetId"),
    defaultLocale,
    locales,
  });

  // The logo was uploaded before the project existed; move it across now.
  const logoAssetId = s("logoAssetId");
  if (logoAssetId) adoptAsset(logoAssetId, project.id, user.id);

  return NextResponse.json({ ok: true, project: { id: project.id } });
}
