import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { deleteProject, getProject, updateProjectFields } from "@/server/projects";
import { autoBackup } from "@/server/backup";
import { isProbablyMapsUrl } from "@/lib/maps";
import { checkWebsiteUrl } from "@/lib/website-url";

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
  const website = checkWebsiteUrl(b.website_url ?? "");
  if (!website.ok) {
    return NextResponse.json(
      { error: `${website.error} You can also leave that field empty.` },
      { status: 400 },
    );
  }

  updateProjectFields(id, user.id, {
    business_name: b.business_name?.trim(),
    business_type: b.business_type?.trim(),
    maps_url: b.maps_url?.trim(),
    website_url: website.url,
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

  /* One automatic backup, before the only irreversible thing this
     application does.

     Deleting a project takes its website, its history, its photographs and
     every approval a client ever gave with it, and the row is gone the
     moment this runs. A copy on the same disk is not disaster recovery — a
     dead disk takes it too — but it is the answer to the failure that
     actually happens, which is pressing Delete on the wrong project. It
     never blocks the deletion: a backup that cannot be written is logged,
     and the creator's instruction is still carried out. */
  const project = getProject(id, user.id);
  let backup: string | null = null;
  if (project) backup = await autoBackup(project, "before-delete");

  deleteProject(id, user.id);
  return NextResponse.json({
    ok: true,
    // Named, so the answer to "can I get it back?" is a file path rather
    // than a shrug.
    backedUpTo: backup ? backup.split("/").pop() : null,
  });
}
