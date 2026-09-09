import { NextResponse } from "next/server";
import { publicConfig } from "@/server/runtime";

/**
 * Readiness probe and public configuration.
 *
 * The desktop shell polls this to know when the bundled server has finished
 * booting, before it shows the window — that is what makes launching feel like
 * a native application rather than a browser waiting on localhost.
 *
 * Deliberately unauthenticated: the shell has no session yet. It returns only
 * the values on the public allowlist in server/runtime.ts.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, ...publicConfig() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const dynamic = "force-dynamic";
