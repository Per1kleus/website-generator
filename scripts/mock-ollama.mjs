#!/usr/bin/env node
/**
 * A stand-in for the Ollama daemon, used to test the integration.
 *
 * No real Ollama is available in CI or in this container, and "it will
 * probably work" is not verification. This implements the three endpoints the
 * app actually uses — /api/tags, /api/pull and /api/chat — with the same
 * shapes and the same NDJSON streaming, so the client code is exercised for
 * real: detection, background pull with progress, and JSON-mode generation.
 *
 *   node scripts/mock-ollama.mjs [port] [--preinstalled]
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] || 11500);
const preinstalled = process.argv.includes("--preinstalled");
const MODEL = process.env.WG_OLLAMA_MODEL || "qwen2.5:0.5b";

let installed = preinstalled ? [MODEL] : [];

/**
 * Stands in for the model's judgement. The real 0.5B model is asked to turn a
 * business brief into a design-catalogue query; this returns the answer a
 * competent one would give, so the plumbing around it is what gets tested.
 */
function answer(prompt) {
  const p = prompt.toLowerCase();
  const has = (...words) => words.some((w) => p.includes(w));

  let query = "warm local business";
  if (has("coffee", "cafe", "café", "espresso", "roast")) query = "warm artisanal cafe";
  if (has("bakery", "bake", "pastry", "bread")) query = "warm artisanal bakery";
  if (has("architect", "studio", "concrete", "stone")) query = "minimal architecture studio";
  if (has("taverna", "restaurant", "dining", "kitchen")) query = "rustic mediterranean restaurant";
  if (has("barber", "salon", "hair")) query = "modern barber salon";
  if (has("law", "legal", "attorney")) query = "professional law firm";

  const menu = has("kind: menu", "website kind: menu");
  return {
    query,
    variance: has("bold", "creative", "experimental") ? 8 : 4,
    motion: menu ? 1 : 2,
    density: menu ? 9 : 4,
  };
}

const server = createServer((req, res) => {
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  if (req.method === "GET" && req.url?.startsWith("/api/tags")) {
    return send(200, {
      models: installed.map((name) => ({ name, model: name, size: 397_000_000 })),
    });
  }

  if (req.method === "POST" && req.url?.startsWith("/api/pull")) {
    // Remember what was actually asked for: a stub that always installs the
    // same name would hide a caller that downloads the wrong model.
    let requested = MODEL;
    let pullBody = "";
    req.on("data", (c) => (pullBody += c));
    req.on("end", () => {
      try {
        requested = JSON.parse(pullBody).model || MODEL;
      } catch {
        /* keep the default */
      }
    });
    // Ollama streams newline-delimited JSON progress objects.
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    const total = 397_000_000;
    let sent = 0;
    res.write(JSON.stringify({ status: "pulling manifest" }) + "\n");
    const timer = setInterval(() => {
      sent = Math.min(total, sent + total / 5);
      res.write(JSON.stringify({ status: "downloading", completed: sent, total }) + "\n");
      if (sent >= total) {
        clearInterval(timer);
        installed = [...new Set([...installed, requested])];
        res.write(JSON.stringify({ status: "success" }) + "\n");
        res.end();
      }
    }, 120);
    return;
  }

  if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (!installed.length) return send(404, { error: `model '${MODEL}' not found` });
      let prompt = "";
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.messages ?? []).map((m) => m.content).join("\n");
      } catch {
        /* fall through to the default answer */
      }
      send(200, {
        model: MODEL,
        done: true,
        message: { role: "assistant", content: JSON.stringify(answer(prompt)) },
      });
    });
    return;
  }

  send(404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-ollama listening on http://127.0.0.1:${port} (preinstalled=${preinstalled})`);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
