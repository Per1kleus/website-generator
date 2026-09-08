import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { deleteProject, getProject, updateProjectFields } from "@/server/projects";
import { isProbablyMapsUrl } from "@/lib/maps";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  if (!getProject(id, user.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const b = (await req.json()) as Record<string, string>;
  if (b.maps_url && !isProbablyMapsUrl(b.maps_url)) {
    return NextResponse.json({ error: "That is not a Google Maps link." }, { status: 400 });
  }
  if ((b.business_name ?? "").trim().length < 2) {
    return NextResponse.json({ error: "Enter the name of the business." }, { status: 400 });
  }

  updateProjectFields(id, user.id, {
    business_name: b.business_name?.trim(),
    business_type: b.business_type?.trim(),
    maps_url: b.maps_url?.trim(),
    location: b.location?.trim(),
    phone: b.phone?.trim(),
    email: b.email?.trim(),
    description: b.description?.trim(),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;
  deleteProject(id, user.id);
  return NextResponse.json({ ok: true });
}
