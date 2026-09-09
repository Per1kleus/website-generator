import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { isDesktop } from "@/server/runtime";
import { saveSettings, settingsStatus } from "@/server/settings";

/**
 * The desktop application's own configuration.
 *
 * Deliberately unavailable on a hosted deployment: there, environment
 * variables belong to the operator, and letting any signed-in creator rewrite
 * them would hand one user the whole server's credentials. On the desktop the
 * user *is* the operator — the server is their own machine.
 *
 * GET never returns a value, only whether one is set and a last-four hint.
 */
function guard() {
  if (isDesktop()) return null;
  return NextResponse.json(
    { error: "Settings are configured by the server operator on this deployment." },
    { status: 404 },
  );
}

export async function GET() {
  const blocked = guard();
  if (blocked) return blocked;
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json(
    { settings: settingsStatus() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const blocked = guard();
  if (blocked) return blocked;
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  saveSettings(body as Record<string, unknown>);
  return NextResponse.json({ ok: true, settings: settingsStatus() });
}

export const dynamic = "force-dynamic";
