/**
 * The local AI runtime: Ollama, and the one model this application uses.
 *
 * Three things matter here, all of them from the requirements:
 *
 *   Only install what is missing. A user who already runs Ollama — and may
 *   already have models they care about — gets their installation used, not
 *   replaced.
 *
 *   Never fake progress. Ollama streams real byte counts while pulling, so
 *   that is what the progress bar shows; steps that cannot report progress say
 *   so instead of animating a lie.
 *
 *   Never leave the application broken. Every failure here is recoverable and
 *   the application works without a local model, so this step can be retried
 *   or skipped rather than trapping the user in a setup screen.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_HOST = "http://127.0.0.1:11434";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function host() {
  return (process.env.OLLAMA_HOST || DEFAULT_HOST).replace(/\/+$/, "");
}

/** Is the daemon answering? Never throws. */
export async function daemonUp(timeoutMs = 1500) {
  try {
    const res = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function installedModels() {
  try {
    const res = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map((m) => m.name || m.model).filter(Boolean);
  } catch {
    return [];
  }
}

export function hasModel(models, id) {
  // The tag is part of the identity: qwen2.5:0.5b does not satisfy a request
  // for qwen2.5:3b. Only an implicit ":latest" is normalised.
  const tagged = (name) => (name.includes(":") ? name : `${name}:latest`);
  const want = tagged(id);
  return models.some((m) => tagged(m) === want);
}

/** Is the ollama command on PATH, whether or not the daemon is running? */
export async function binaryPresent() {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", ["ollama"], {
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the daemon that is already installed.
 *
 * Detached, because it outlives this setup process and belongs to the machine
 * rather than to the application: quitting the app should not stop a service
 * the user may also use from a terminal.
 */
export async function startDaemon(timeoutMs = 20000) {
  if (await daemonUp()) return true;
  if (!(await binaryPresent())) return false;
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await daemonUp()) return true;
    await sleep(500);
  }
  return false;
}

async function wingetAvailable() {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("winget", ["--version"], { timeout: 8000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Ollama on Windows.
 *
 * winget first: it is the platform's own package manager, it installs silently
 * and it is the path that needs no guessing about a third-party installer's
 * command-line flags.
 *
 * If winget is not available the vendor's installer is downloaded and run
 * normally — visible, as its author intended. That is a real installer window,
 * not a terminal, and inventing silent flags for it would be exactly the kind
 * of fragile workaround worth avoiding.
 */
export async function installRuntime(report) {
  if (process.platform !== "win32") {
    return { ok: false, reason: "unsupported-platform" };
  }

  if (await wingetAvailable()) {
    report({ detail: "Installing Ollama with Windows Package Manager…" });
    try {
      await execFileAsync(
        "winget",
        [
          "install", "--id", "Ollama.Ollama", "--exact", "--silent",
          "--accept-package-agreements", "--accept-source-agreements",
        ],
        { timeout: 15 * 60_000, windowsHide: true },
      );
      return { ok: true, via: "winget" };
    } catch (err) {
      report({ detail: `Windows Package Manager could not install it (${short(err)}).` });
    }
  }

  report({
    detail:
      "Opening the Ollama installer. Accept its prompts, then this setup continues automatically.",
  });
  try {
    const { tmpdir } = await import("node:os");
    const { writeFile } = await import("node:fs/promises");
    const path = (await import("node:path")).default;
    const res = await fetch("https://ollama.com/download/OllamaSetup.exe", {
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const file = path.join(tmpdir(), "OllamaSetup.exe");
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    const child = spawn(file, [], { detached: true, stdio: "ignore" });
    child.unref();
    // The user is now driving the vendor's installer; wait for the daemon it
    // starts rather than assuming a duration.
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      if (await daemonUp()) return { ok: true, via: "installer" };
      await sleep(2000);
    }
    return { ok: false, reason: "installer-not-finished" };
  } catch (err) {
    return { ok: false, reason: short(err) };
  }
}

function short(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0].slice(0, 200);
}

/**
 * Download a model, reporting real bytes.
 *
 * Ollama keeps the blobs it has already fetched, so re-running this after an
 * interrupted download continues from where it stopped — the percentage simply
 * starts partway along. Nothing here deletes a partial download to "start
 * clean"; that would throw away exactly the gigabyte the user already paid for.
 */
export async function pullModel(id, report, signal) {
  const res = await fetch(`${host()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: id, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama refused the download (${res.status}).`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastPercent = -1;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.error) throw new Error(msg.error);
      if (msg.total && msg.completed != null) {
        const percent = Math.floor((msg.completed / msg.total) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          report({
            percent,
            detail: `${gb(msg.completed)} of ${gb(msg.total)}`,
            status: msg.status,
          });
        }
      } else if (msg.status) {
        // Manifest and verification phases report no byte count, so the UI is
        // told to show an indeterminate indicator rather than a made-up number.
        report({ percent: null, detail: msg.status });
      }
    }
  }
}

function gb(bytes) {
  const value = bytes / 1024 ** 3;
  return value >= 1 ? `${value.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * Prove the model works, rather than trusting that the download finished.
 * A model that is present but cannot answer is not a completed setup.
 */
export async function verifyModel(id, timeoutMs = 120_000) {
  try {
    const res = await fetch(`${host()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: id,
        stream: false,
        format: "json",
        options: { temperature: 0, num_predict: 64 },
        messages: [
          { role: "system", content: 'Reply with JSON only: {"ok":true}' },
          { role: "user", content: "Say ok." },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return typeof data?.message?.content === "string" && data.message.content.includes("{");
  } catch {
    return false;
  }
}
