import { NextResponse } from "next/server";
import {
  createSession,
  createUser,
  findUserByEmail,
  hashPassword,
} from "@/server/auth";

export async function POST(req: Request) {
  const { name, email, password } = (await req.json()) as Record<string, string>;

  if (!name?.trim() || name.trim().length < 2) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email?.trim() ?? "")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Use at least 8 characters." }, { status: 400 });
  }
  if (findUserByEmail(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  const user = createUser(email, name, await hashPassword(password));
  await createSession(user.id);
  return NextResponse.json({ ok: true, user });
}
