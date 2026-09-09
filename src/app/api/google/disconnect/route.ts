import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { disconnect } from "@/server/google/oauth";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  disconnect(user.id);
  return NextResponse.json({ ok: true });
}
