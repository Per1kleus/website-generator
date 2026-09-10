import "server-only";
import { GoogleGenAI, type ContentListUnion, type Part, type ToolListUnion } from "@google/genai";

/**
 * The hosted model: Google Gemini.
 *
 * Five features use it — business research, visual identity analysis, copy
 * generation, translation and free-form AI editing. Each one builds its own
 * prompt and parses its own JSON, exactly as before; this module exists only
 * so the model name, the client and the failure vocabulary live in one place
 * rather than in five.
 *
 * It is deliberately thin. Everything about how the application uses the model
 * — the prompts, the JSON shapes, the validation, the fallbacks when no key is
 * configured — belongs to the feature modules and is unchanged.
 *
 * The local Ollama model is a different thing entirely and is untouched by
 * this file: it writes design-catalogue queries on the user's own machine, and
 * nothing here ever stands in for it.
 */

/**
 * The one place the model is chosen.
 *
 * Gemini 2.5 Pro is the reasoning-heavy model that matches this workload:
 * grounded research, image-aware identity analysis, long structured JSON, and
 * a whole-document edit. `WG_GEMINI_MODEL` overrides it, in the same way
 * `WG_OLLAMA_MODEL` overrides the local one.
 */
export const MODEL = process.env.WG_GEMINI_MODEL || "gemini-2.5-pro";

/**
 * Is a hosted model available at all?
 *
 * Every AI feature checks this first and has a real path when the answer is
 * no, which is why the application works with no key configured.
 */
export function hasApiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function newClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  // Callers check hasApiKey() first; this is the guard for a caller that did
  // not, and it names the variable rather than any part of its value.
  if (!apiKey) throw new Error("No GEMINI_API_KEY is configured.");
  const baseUrl = process.env.GEMINI_BASE_URL;
  return new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
}

export type GenerateArgs = {
  /** System instruction. Unchanged from the prompts the application already used. */
  system: string;
  /** The user turn: a string, or parts when an image is involved. */
  content: string | Part[];
  maxOutputTokens: number;
  /** Server-side tools, currently only used by business research. */
  tools?: ToolListUnion;
};

export type GenerateResult = {
  /** Everything the model said, concatenated. */
  text: string;
  /**
   * True when the model stopped for a reason other than finishing: safety,
   * recitation, forbidden terms. Callers treat this exactly as they treated
   * a refusal before — it is the same branch, not a new one.
   */
  refused: boolean;
};

/** Stopping reasons that mean "the model would not produce this". */
const REFUSALS = new Set(["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"]);

/**
 * One generation, streamed and concatenated.
 *
 * Streamed for the same reason the previous provider's calls were: these are
 * long responses — a whole site document runs to tens of thousands of tokens —
 * and a single buffered response is the one shape that times out. Nothing
 * partial is surfaced; callers get the finished text, as they always did.
 *
 * Errors propagate. Each feature already decides what a failure means for it
 * (a template, a fallback identity, the untranslated string, the local
 * editor), and that decision stays where it is.
 */
export async function generateText(args: GenerateArgs): Promise<GenerateResult> {
  const ai = newClient();
  const contents: ContentListUnion =
    typeof args.content === "string"
      ? args.content
      : [{ role: "user", parts: args.content }];

  const stream = await ai.models.generateContentStream({
    model: MODEL,
    contents,
    config: {
      systemInstruction: args.system,
      maxOutputTokens: args.maxOutputTokens,
      // The closest equivalent of the adaptive thinking this application asked
      // for before: the model decides how much to think, per request.
      thinkingConfig: { thinkingBudget: -1 },
      ...(args.tools ? { tools: args.tools } : {}),
    },
  });

  let text = "";
  let finishReason = "";
  for await (const chunk of stream) {
    text += chunk.text ?? "";
    const reason = chunk.candidates?.[0]?.finishReason;
    if (reason) finishReason = String(reason);
  }

  return { text, refused: REFUSALS.has(finishReason) };
}

/**
 * A failure a person can read, with nothing sensitive in it.
 *
 * The API key never appears in a Gemini error, but an error body can carry
 * request detail that has no business in a log or on a screen, so only the
 * recognised shapes are described and anything else stays generic.
 */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(message)) {
    return "The Gemini API key was rejected. Check the key in your settings.";
  }
  if (/RESOURCE_EXHAUSTED|rate limit|quota|429/i.test(message)) {
    return "Gemini is rate limiting this account. Try again in a moment.";
  }
  if (/NOT_FOUND|is not found|404/i.test(message)) {
    return `The Gemini model ${MODEL} is not available to this key.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed|aborted/i.test(message)) {
    return "Could not reach Gemini.";
  }
  return "Gemini could not complete that request.";
}
