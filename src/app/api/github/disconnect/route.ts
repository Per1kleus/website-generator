import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { connectionStatus, disconnect } from "@/server/github/oauth";

/**
 * Forget the creator's GitHub token.
 *
 * Nothing published is touched. The repositories, the websites and the
 * domains stay exactly as they are — they live in the creator's own GitHub
 * account, not in this application — and publishing again simply needs the
 * account connected again.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const before = connectionStatus(user.id);
  disconnect(user.id);
  const after = connectionStatus(user.id);

  return NextResponse.json({
    ok: true,
    github: after,
    // An operator-wide token is not this creator's to disconnect, and saying
    // "disconnected" while publishing still works would be a lie.
    ...(before.via === "operator" || after.via === "operator"
      ? {
          notice:
            "This server publishes with a GitHub account configured by whoever runs it, so there is nothing personal to disconnect.",
        }
      : {}),
  });
}

export const dynamic = "force-dynamic";
