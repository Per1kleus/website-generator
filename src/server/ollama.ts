import "server-only";

/**
 * Local design model via Ollama.
 *
 * The role is deliberately narrow. The ui-ux-pro-max skill holds the design
 * intelligence; its lookup is keyword-based, so the quality of what comes back
 * depends almost entirely on the quality of the query. "greek coffee shop
 * digital menu" returns a crypto/futuristic system; "warm artisanal cafe"
 * returns the right warm bakery palette and typography for the same business.
 *
 * Turning business facts into that query — plus three numeric dials — is a
 * small, bounded, structured task. That is what a ~400MB local model is
 * genuinely good at, and why the smallest capable model is the right choice
 * rather than a big one.
 *
 * Everything here degrades silently: no daemon, no model, or a timeout all
 * fall back to a deterministic query builder, and generation proceeds.
 */

const HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");

/**
 * The default is the smallest model that reliably follows an instruction and
 * emits valid JSON. Bigger models do this better, but not better enough to
 * justify the download for a query-rewriting task.
 */
export const DEFAULT_MODEL = process.env.WG_OLLAMA_MODEL || "qwen2.5:0.5b";

/** Auto-pull on first launch unless explicitly disabled. */
export const AUTOPULL = process.env.WG_OLLAMA_AUTOPULL !== "0";

/** Ollama omits ":latest" when a model was pulled without a tag. */
const tagged = (name: string) => (name.includes(":") ? name : `${name}:latest`);

export type OllamaState = {
  /** Is the daemon reachable at all? */
  available: boolean;
  /** Is the configured model present locally? */
  modelReady: boolean;
  model: string;
  host: string;
  /** Populated while a pull is running. */
  pull: { status: string; percent: number; error: string | null } | null;
  models: string[];
  checkedAt: number;
};

let state: OllamaState = {
  available: false,
  modelReady: false,
  model: DEFAULT_MODEL,
  host: HOST,
  pull: null,
  models: [],
  checkedAt: 0,
};

export function getState(): OllamaState {
  return state;
}

async function request(path: string, init?: RequestInit, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${HOST}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Cheap liveness + inventory probe. Never throws. */
export async function probe(timeoutMs = 2000): Promise<OllamaState> {
  try {
    const res = await request("/api/tags", {}, timeoutMs);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { models?: { name?: string; model?: string }[] };
    const models = (data.models ?? [])
      .map((m) => m.name || m.model || "")
      .filter(Boolean);

    state = {
      ...state,
      available: true,
      models,
      // The tag is part of the identity — a 0.5B download does not make a
      // configured 3B model ready — so only an implicit ":latest" is
      // normalised away.
      modelReady: models.some((m) => tagged(m) === tagged(DEFAULT_MODEL)),
      checkedAt: Date.now(),
    };
  } catch {
    state = { ...state, available: false, modelReady: false, models: [], checkedAt: Date.now() };
  }
  return state;
}

let pulling: Promise<void> | null = null;

/**
 * Downloads the model, reporting progress into the shared state so the UI can
 * show it. Concurrent callers join the in-flight pull rather than starting a
 * second download.
 */
export function pullModel(model = DEFAULT_MODEL): Promise<void> {
  if (pulling) return pulling;

  pulling = (async () => {
    state = { ...state, pull: { status: "starting", percent: 0, error: null } };
    try {
      // No timeout: a model download legitimately takes minutes.
      const res = await fetch(`${HOST}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`pull failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Ollama streams newline-delimited JSON.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
              error?: string;
            };
            if (msg.error) throw new Error(msg.error);
            const percent =
              msg.total && msg.completed
                ? Math.round((msg.completed / msg.total) * 100)
                : (state.pull?.percent ?? 0);
            state = {
              ...state,
              pull: { status: msg.status ?? "downloading", percent, error: null },
            };
          } catch (err) {
            if (err instanceof Error && err.message && !err.message.startsWith("Unexpected")) {
              throw err;
            }
          }
        }
      }

      await probe();
      state = { ...state, pull: { status: "ready", percent: 100, error: null } };
    } catch (err) {
      const message = err instanceof Error ? err.message : "download failed";
      state = { ...state, pull: { status: "failed", percent: 0, error: message } };
      console.error("[ollama] pull failed:", message);
    } finally {
      pulling = null;
    }
  })();

  return pulling;
}

/**
 * Runs one JSON-returning completion. Returns null on any failure so callers
 * always have a fallback path rather than an exception to handle.
 */
export async function generateJson<T>(
  system: string,
  prompt: string,
  timeoutMs = 45000,
): Promise<T | null> {
  if (!state.available || !state.modelReady) return null;

  try {
    const res = await request(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          stream: false,
          // Ollama's JSON mode constrains decoding, which matters a great deal
          // for a 0.5B model that would otherwise wrap output in prose.
          format: "json",
          options: {
            // Deterministic: the same business should produce the same design.
            temperature: 0,
            num_predict: 512,
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      },
      timeoutMs,
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(content.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

let firstLaunch: Promise<void> | null = null;

/**
 * First-launch setup: probe for Ollama and, if it is there but the model is
 * not, start the download in the background.
 *
 * Runs at most once per process and never blocks a request — a phone user
 * opening the app must not wait on a model download.
 */
export function ensureFirstLaunch(): Promise<void> {
  if (firstLaunch) return firstLaunch;

  firstLaunch = (async () => {
    await probe();
    if (!state.available) {
      console.info("[ollama] not detected — using the built-in query builder.");
      return;
    }
    if (state.modelReady) {
      console.info(`[ollama] ready with ${DEFAULT_MODEL}.`);
      return;
    }
    if (!AUTOPULL) {
      console.info(`[ollama] detected, but ${DEFAULT_MODEL} is missing and autopull is off.`);
      return;
    }
    console.info(`[ollama] detected — downloading ${DEFAULT_MODEL} in the background.`);
    void pullModel();
  })();

  return firstLaunch;
}
