import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { inspectBackup, restoreBackup } from "@/server/backup-restore";

/**
 * Check a backup, and — separately — restore it.
 *
 * Two steps on purpose. `?inspect=1` reads the file and reports every check
 * without writing anything, so the screen can show what is in the backup and
 * what will need reconnecting before a person commits to it. Only a second
 * request actually creates the project.
 */
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("backup");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a backup file to restore." }, { status: 400 });
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return NextResponse.json(
      { error: "That backup is larger than this application will read." },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const { report, manifest, entries } = await inspectBackup(bytes);

  const inspectOnly = new URL(req.url).searchParams.get("inspect") === "1";
  if (inspectOnly || !report.ok || !manifest) {
    return NextResponse.json({ ok: report.ok, report }, { status: report.ok ? 200 : 400 });
  }

  try {
    /* A restore always creates a new project. There is no path here that
       writes into an existing one, which is why nothing in this route takes
       a project id. */
    const result = await restoreBackup(user.id, manifest, entries);
    return NextResponse.json({ ok: true, report, ...result });
  } catch (err) {
    console.error("[backup] restore failed:", err);
    return NextResponse.json(
      { error: "The backup could not be restored. Nothing was changed." },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;
