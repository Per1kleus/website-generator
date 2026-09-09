import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  AUTOPULL, DEFAULT_MODEL, ensureFirstLaunch, getState, probe, pullModel,
} from "@/server/ollama";
import { skillAvailable } from "@/server/uiux";

/**
 * Status of the local design stack: the vendored ui-ux-pro-max skill and the
 * optional Ollama model that writes its queries.
 *
 * Neither is required. The endpoint reports what is actually there so the app
 * can be honest about which tier of design intelligence produced a site.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  void ensureFirstLaunch();
  const state = await probe();

  return NextResponse.json({
    skill: { available: await skillAvailable(), name: "ui-ux-pro-max" },
    ollama: {
      available: state.available,
      modelReady: state.modelReady,
      model: DEFAULT_MODEL,
      host: state.host,
      pull: state.pull,
      autopull: AUTOPULL,
    },
  });
}

/** Manual install trigger, for when autopull is off or a pull failed. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const state = await probe();
  if (!state.available) {
    return NextResponse.json(
      {
        error:
          "Ollama is not running. Install it from ollama.com and start it, then try again.",
      },
      { status: 400 },
    );
  }
  if (state.modelReady) {
    return NextResponse.json({ ok: true, alreadyInstalled: true });
  }

  // Returns immediately; progress is read back from GET.
  void pullModel();
  return NextResponse.json({ ok: true, started: true, model: DEFAULT_MODEL });
}

export const dynamic = "force-dynamic";
