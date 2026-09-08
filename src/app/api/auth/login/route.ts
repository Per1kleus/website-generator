import { NextResponse } from "next/server";
import { createSession, findUserByEmail, verifyPassword } from "@/server/auth";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as Record<string, string>;
  const user = findUserByEmail(email ?? "");

  // Same message and roughly the same work either way: no user enumeration.
  if (!user || !(await verifyPassword(password ?? "", user.password_hash))) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
