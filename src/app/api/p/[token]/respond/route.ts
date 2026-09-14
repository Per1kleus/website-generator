import { NextResponse } from "next/server";
import { MAX_FEEDBACK, recordResponse, resolvePreview } from "@/server/client-preview";

/**
 * What the client said about the version they were shown.
 *
 * The only thing a client may write, anywhere. It appends a row and does not
 * touch the website document — a client who could change the site is a client
 * who could break it, and the creator is the one who stays in control of what
 * ships.
 *
 * The response carries nothing back but a confirmation. No project id, no
 * version id, no reflection of internal state.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!resolvePreview(token)) {
    return NextResponse.json({ error: "This preview link is no longer available." }, { status: 404 });
  }

  let body: { kind?: unknown; message?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "That did not send correctly." }, { status: 400 });
  }

  const kind = body.kind === "approved" ? "approved" : body.kind === "changes" ? "changes" : null;
  if (!kind) {
    return NextResponse.json({ error: "Choose approve or request changes." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (kind === "changes" && !message) {
    return NextResponse.json(
      { error: "Tell us what you would like changed." },
      { status: 400 },
    );
  }
  if (message.length > MAX_FEEDBACK) {
    return NextResponse.json(
      { error: `Please keep it under ${MAX_FEEDBACK} characters.` },
      { status: 400 },
    );
  }

  const recorded = recordResponse(token, kind, message);
  if (!recorded) {
    return NextResponse.json({ error: "This preview link is no longer available." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, kind });
}

export const dynamic = "force-dynamic";
