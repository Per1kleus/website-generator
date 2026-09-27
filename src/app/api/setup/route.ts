import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import {
  AUTOPULL, DEFAULT_MODEL, ensureFirstLaunch, probe, pullModel,
} from "@/server/ollama";
import { skillAvailable, skillSource } from "@/server/uiux";
import { readiness, repair } from "@/server/setup-readiness";

/**
 * What this installation actually has, and how to repair what it does not.
 *
 * Two different questions, deliberately separated.
 *
 * The short answer — the design catalogue and the local model — is what the
 * profile screen paints immediately, and it is cheap. The full readiness report
 * checks every component the setup manifest requires, file by file, and is
 * asked for explicitly because verifying a model means loading it.
 *
 * Nothing here reports a component as ready on the strength of a directory
 * existing or a record saying so. "Installed" means the files are present and
 * readable; "verified" means the application's own loader used it.
 */

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  void ensureFirstLaunch();
  const state = await probe();
  const url = new URL(req.url);
  const full = url.searchParams.get("readiness") === "1";
  const verifyModel = url.searchParams.get("verify") === "1";

  return NextResponse.json({
    skill: {
      available: await skillAvailable(),
      name: "ui-ux-pro-max",
      source: skillSource(),
    },
    ollama: {
      available: state.available,
      modelReady: state.modelReady,
      model: DEFAULT_MODEL,
      host: state.host,
      pull: state.pull,
      autopull: AUTOPULL,
    },
    // The component-by-component picture, only when asked for.
    ...(full ? { readiness: await readiness({ verifyModel }) } : {}),
  });
}

/**
 * Install what is missing.
 *
 * `repair` checks every component and provisions only what is absent — nothing
 * working is deleted and nothing already present is downloaded again. The older
 * behaviour, "start the model download", is what a repair does when the model is
 * the thing that is missing, so it is the same path rather than a second one.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "repair") {
    const result = await repair();
    return NextResponse.json(result);
  }

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
