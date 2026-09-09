#!/usr/bin/env node
/**
 * Desktop sidecar launcher.
 *
 * The application is a Node server — every route is server-rendered and it
 * uses native modules — so the desktop app boots that same server on a
 * loopback port rather than reimplementing it. This script is what the Tauri
 * shell spawns.
 *
 * Contract with the shell, over stdout, one line each:
 *
 *   WG_READY <url>     the server answered /api/health; open this URL
 *   WG_FAILED <reason> it will not start; show the user this reason
 *
 * Everything else on stdout/stderr is the server's own logging, which the
 * shell forwards to its log file.
 *
 * Shutdown: SIGTERM, or stdin closing when the shell exits. Both stop the
 * child, so no orphaned server survives the window closing.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const HOST = "127.0.0.1";

function say(line) {
  process.stdout.write(`${line}\n`);
}

/** An ephemeral loopback port. Bound and released so the child can take it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Where the packaged server lives.
 *
 * Tauri passes --resources; in development the repo layout is used, so the
 * same script drives `npm run desktop:dev` and the installed application.
 */
function resolveLayout() {
  const flag = process.argv.indexOf("--resources");
  const resources = flag > -1 ? process.argv[flag + 1] : null;

  if (resources && existsSync(path.join(resources, "server", "server.js"))) {
    return {
      cwd: path.join(resources, "server"),
      entry: path.join(resources, "server", "server.js"),
      // A Python interpreter is shipped alongside so the design catalogue
      // keeps working without the user installing anything.
      python: findPython(resources),
    };
  }

  const repo = path.resolve(process.cwd());
  const standalone = path.join(repo, ".next", "standalone");
  if (existsSync(path.join(standalone, "server.js"))) {
    return { cwd: standalone, entry: path.join(standalone, "server.js"), python: null };
  }
  return null;
}

function findPython(resources) {
  const candidates = [
    path.join(resources, "python", "python.exe"),
    path.join(resources, "python", "bin", "python3"),
    path.join(resources, "python", "python3"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function waitForHealth(url, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // Still booting; Next takes a moment to bind.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const dataFlag = process.argv.indexOf("--data-dir");
  const dataDir = dataFlag > -1 ? process.argv[dataFlag + 1] : path.join(process.cwd(), "data");

  const layout = resolveLayout();
  if (!layout) {
    say("WG_FAILED The application files are missing or damaged. Reinstall to repair.");
    process.exit(1);
  }

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    say(`WG_FAILED Cannot write application data to ${dataDir}.`);
    process.exit(1);
  }

  const port = await freePort();
  const url = `http://${HOST}:${port}`;

  const child = spawn(process.execPath, [layout.entry], {
    cwd: layout.cwd,
    env: {
      ...process.env,
      NODE_ENV: "production",
      WG_RUNTIME: "desktop",
      WG_DATA_DIR: dataDir,
      WG_SELF_ORIGIN: url,
      ...(layout.python ? { WG_PYTHON: layout.python } : {}),
      // Bind to loopback only: this server is for this machine, and must not
      // be reachable from the local network.
      HOSTNAME: HOST,
      HOST,
      PORT: String(port),
      // The desktop app is a single user's own machine; nothing here polls a
      // remote registry unless they ask for it.
      WG_OLLAMA_AUTOPULL: process.env.WG_OLLAMA_AUTOPULL ?? "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stderr.write(`[server] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  child.on("error", (err) => {
    say(`WG_FAILED Could not start the application service: ${err.message}`);
    process.exit(1);
  });

  const ready = await waitForHealth(url, child);
  if (!ready) {
    say("WG_FAILED The application service did not start in time.");
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    process.exit(1);
  }

  say(`WG_READY ${url}`);

  /* ---------------------------- shutdown ------------------------------- */
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    // Do not let a hung server keep the process tree alive after the window
    // has closed.
    const force = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      process.exit(code);
    }, 4000);
    force.unref();
    child.once("exit", () => process.exit(code));
  };

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(0));
  // The shell exiting closes our stdin, which is the reliable cross-platform
  // signal on Windows where POSIX signals are not delivered.
  process.stdin.resume();
  process.stdin.on("end", () => stop(0));
  process.stdin.on("close", () => stop(0));

  child.on("exit", (code) => {
    if (!stopping) {
      say(`WG_FAILED The application service stopped unexpectedly (code ${code}).`);
      process.exit(code ?? 1);
    }
  });
}

main().catch((err) => {
  say(`WG_FAILED ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
