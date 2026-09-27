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
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { installerSpec, ollamaHost, readiness } from "./manifest.mjs";

const execFileAsync = promisify(execFile);

export const DEFAULT_HOST = "http://127.0.0.1:11434";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function host() {
  return ollamaHost();
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

/**
 * Wait for the daemon, backing off.
 *
 * Ollama's Windows installer starts a service, and "installed" and "answering"
 * are separated by anything from a second to most of a minute on a cold
 * machine. Polling hard for that whole time is wasteful and polling once is
 * wrong, so the interval grows from a few hundred milliseconds to a few seconds
 * and the whole wait is bounded by the manifest's timeout.
 *
 * Returns false rather than throwing when it never answers: that is a reportable
 * outcome with a retry, not an exception.
 */
export async function waitForDaemon({ timeoutMs = readiness().startTimeoutMs, onWait = null } = {}) {
  const { pollInitialMs, pollMaxMs } = readiness();
  const deadline = Date.now() + timeoutMs;
  let wait = pollInitialMs;
  for (let attempt = 1; ; attempt += 1) {
    if (await daemonUp()) return true;
    if (Date.now() >= deadline) return false;
    if (onWait) onWait({ attempt, waitedMs: wait });
    await sleep(Math.min(wait, Math.max(0, deadline - Date.now())));
    wait = Math.min(Math.round(wait * 1.6), pollMaxMs);
  }
}

/**
 * Is one exact model installed?
 *
 * Three answers, and the third matters: `null` means the daemon could not be
 * reached, which is not the same as the model being absent. A launch that
 * treated an unreachable daemon as a missing model would reopen setup on every
 * machine where Ollama simply had not started yet.
 */
export async function modelPresent(id, timeoutMs = 1500) {
  try {
    const res = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const data = await res.json();
    const names = (data.models ?? []).map((m) => m.name || m.model).filter(Boolean);
    return hasModel(names, id);
  } catch {
    return null;
  }
}

/**
 * Can anything be downloaded at all?
 *
 * Asked before a large download starts, so "no internet" is reported as itself
 * rather than as a mysterious failure twenty seconds into a model pull. A HEAD
 * against the host the installer comes from, because that is the host that has
 * to be reachable; a redirect or any HTTP answer counts, since the question is
 * connectivity and not the state of someone's CDN.
 */
export async function internetReachable(timeoutMs = 6000) {
  const url = installerSpec().windowsUrl;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status > 0;
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
export async function startDaemon({ timeoutMs = readiness().startTimeoutMs, onWait = null } = {}) {
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
  return waitForDaemon({ timeoutMs, onWait });
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

  try {
    report({ detail: "Downloading the Ollama installer…" });
    const download = await fetchInstaller(report);
    if (!download.ok) return { ok: false, reason: download.reason };

    report({
      detail:
        "Opening the Ollama installer. Accept its prompts, then this setup continues automatically.",
    });
    const child = spawn(download.file, [], { detached: true, stdio: "ignore" });
    child.unref();

    // The user is now driving the vendor's installer; wait for the daemon it
    // starts rather than assuming a duration.
    const ready = await waitForDaemon({
      timeoutMs: readiness().installTimeoutMs,
      onWait: () => report({ detail: "Waiting for Ollama to finish installing…" }),
    });
    return ready ? { ok: true, via: "installer" } : { ok: false, reason: "installer-not-finished" };
  } catch (err) {
    return { ok: false, reason: short(err) };
  }
}

/**
 * Download the vendor's installer, and prove it is the installer.
 *
 * This file is about to be executed on the user's machine. A truncated
 * download, an interception, or a captive portal's login page served with a 200
 * would otherwise all be run as an executable, so every one of them is checked
 * for before anything is spawned:
 *
 *   the bytes received must match the length the server declared;
 *   the size must be plausible for this installer;
 *   the file must actually start with the Windows executable signature;
 *   and when an operator has pinned a digest, it must match exactly.
 *
 * Ollama publishes no stable per-release digest at a floating download URL, so
 * a pin cannot be shipped in the manifest honestly. What can be shipped is
 * every check that does not require one — and `WG_OLLAMA_SETUP_SHA256` for an
 * operator who has verified a specific build and wants it enforced.
 *
 * A failed check deletes the file. Leaving a rejected executable in the
 * temporary directory would invite exactly the mistake this function exists to
 * prevent.
 */
async function fetchInstaller(report) {
  const spec = installerSpec();
  const { tmpdir } = await import("node:os");
  const { writeFile } = await import("node:fs/promises");
  const path = (await import("node:path")).default;

  const res = await fetch(spec.windowsUrl, { redirect: "follow" });
  if (!res.ok) return { ok: false, reason: `download failed (${res.status})` };

  const declared = Number(res.headers.get("content-length") ?? 0);
  const bytes = Buffer.from(await res.arrayBuffer());

  const verdict = checkInstaller(bytes, { declared });
  if (!verdict.ok) {
    // Nothing is written to disk. Leaving a rejected executable in the
    // temporary directory would invite exactly the mistake this prevents.
    console.error(`[setup] refused the Ollama installer: ${verdict.reason}`);
    return { ok: false, reason: verdict.reason };
  }

  report({
    detail: verdict.pinned
      ? "Installer downloaded and its checksum verified."
      : "Installer downloaded and checked.",
  });

  const file = path.join(tmpdir(), "OllamaSetup.exe");
  await writeFile(file, bytes);
  return { ok: true, file, digest: verdict.digest, bytes: bytes.byteLength };
}

/**
 * Is this actually the installer?
 *
 * Pure, and exported, so every rejection path is tested rather than argued
 * about. `declared` is the Content-Length the server sent; 0 means it sent none.
 */
export function checkInstaller(bytes, { declared = 0, spec = installerSpec(), env = process.env } = {}) {
  if (declared > 0 && bytes.byteLength !== declared) {
    return { ok: false, reason: "the download was incomplete" };
  }
  if (bytes.byteLength < spec.minBytes || bytes.byteLength > spec.maxBytes) {
    return { ok: false, reason: "the download was not the expected size" };
  }
  if (bytes.subarray(0, spec.expectHeader.length).toString("latin1") !== spec.expectHeader) {
    return { ok: false, reason: "the download was not a Windows installer" };
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  const pinned = (env[spec.sha256Env] ?? "").trim().toLowerCase();
  if (pinned && pinned !== digest) {
    return { ok: false, reason: "the download did not match the expected checksum" };
  }
  return { ok: true, digest, pinned: Boolean(pinned) };
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
 *
 * A model that is present but cannot answer is not a completed setup — a pull
 * can finish against a corrupted blob, and a machine can be short of the memory
 * the model needs to load at all. So the check loads it and asks it something.
 *
 * Deliberately minimal and deliberately not the user's content: a fixed
 * instruction, temperature zero, a 64-token ceiling. It is a health check, not
 * a generation, and nothing about anybody's business is sent to it.
 */
export async function verifyModel(id, timeoutMs = readiness().verifyTimeoutMs) {
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
