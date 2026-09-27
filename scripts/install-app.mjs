#!/usr/bin/env node
/**
 * Install and start Website Generator on this computer, from this folder.
 *
 * The other way in is the Windows installer — `WebsiteGenerator-Setup.exe`,
 * built by `scripts/build-desktop.mjs`. That one needs Rust and the Tauri
 * prerequisites to *produce*, which is fine for whoever publishes releases and
 * no use at all to someone who has the source folder and wants the application.
 *
 * So this is the same installation, driven from a console instead of a native
 * window. Everything it does is the existing machinery:
 *
 *   npm            installs the dependencies
 *   next build     produces the standalone server
 *   bootstrap      desktop/bootstrap/run.mjs — the one first-launch system,
 *                  spoken to exactly as the Tauri shell speaks to it
 *   sidecar        desktop/sidecar/launch.mjs — the one launcher
 *
 * Nothing here is a second installer, a second first-launch system or a second
 * model download. It is a second *front end* to the first one, which is the
 * part that was missing: until now the only thing that could drive the
 * bootstrap was the Rust shell.
 *
 * The data directory is the one the packaged application uses, so an
 * installation done this way and one done from the .exe share their setup,
 * their database and their projects rather than quietly keeping two.
 *
 *   node scripts/install-app.mjs            install, then offer to start
 *   node scripts/install-app.mjs --start    start an installation that exists
 *   node scripts/install-app.mjs --repair   re-run provisioning for what is missing
 *   node scripts/install-app.mjs --rebuild  rebuild the server even if it is there
 *   node scripts/install-app.mjs --reinstall reinstall the dependencies too
 *   node scripts/install-app.mjs --yes      take every default, ask nothing
 *   node scripts/install-app.mjs --no-start install without starting afterwards
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const START_ONLY = has("start");
const ASSUME_YES = has("yes") || !process.stdin.isTTY;

/* --------------------------------------------------------------- reporting */

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", bold: "\x1b[1m", ok: "\x1b[32m", warn: "\x1b[33m", bad: "\x1b[31m", off: "\x1b[0m" }
  : { dim: "", bold: "", ok: "", warn: "", bad: "", off: "" };

const say = (line = "") => process.stdout.write(`${line}\n`);
const step = (text) => say(`\n${C.bold}${text}${C.off}`);
const good = (text) => say(`  ${C.ok}✓${C.off} ${text}`);
const note = (text) => say(`  ${C.dim}·${C.off} ${text}`);
const warn = (text) => say(`  ${C.warn}!${C.off} ${text}`);
const fail = (text) => say(`  ${C.bad}✗${C.off} ${text}`);

/** One line, overwritten — a progress bar rather than a thousand lines of log. */
let transient = false;
function progress(text) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\r  ${C.dim}${text}${C.off}\x1b[K`);
  transient = true;
}
function clearProgress() {
  if (transient) process.stdout.write("\r\x1b[K");
  transient = false;
}

function ask(question, fallback) {
  if (ASSUME_YES) return Promise.resolve(fallback);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim() || fallback);
    });
  });
}

async function confirm(question, fallback = true) {
  const answer = await ask(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`, fallback ? "y" : "n");
  return /^y/i.test(answer);
}

/* ------------------------------------------------------------------- places */

/**
 * Where the application keeps its data.
 *
 * Deliberately the directory the packaged application uses — Tauri's
 * app_local_data_dir for this identifier — so installing from source and
 * installing from the .exe are the same installation rather than two that do
 * not know about each other.
 */
const IDENTIFIER = "app.websitegenerator.desktop";

function dataDir() {
  if (process.env.WG_DATA_DIR) return path.resolve(process.env.WG_DATA_DIR);
  if (WINDOWS) {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, IDENTIFIER);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", IDENTIFIER);
  }
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, IDENTIFIER);
}

/* ------------------------------------------------------------------ running */

/** npm and npx are .cmd shims on Windows, and there is no shell here. */
const bin = (name) => (WINDOWS ? `${name}.cmd` : name);

function run(command, commandArgs, { quiet = false } = {}) {
  const result = spawnSync(bin(command), commandArgs, {
    cwd: ROOT,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  return { ok: result.status === 0, status: result.status, output: String(result.stdout ?? "") };
}

function available(command, probeArgs = ["--version"]) {
  const result = spawnSync(bin(command), probeArgs, { stdio: "ignore" });
  return result.status === 0;
}

/* --------------------------------------------------------- prerequisites */

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

function requiredNodeMajor() {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "desktop", "bootstrap", "manifest.json"), "utf8"),
    );
    return manifest.runtime?.nodeMinimumMajor ?? 20;
  } catch {
    return 20;
  }
}

function checkNode() {
  const need = requiredNodeMajor();
  if (nodeMajor() >= need) {
    good(`Node ${process.versions.node}`);
    return true;
  }
  fail(`Node ${need} or newer is needed. This is Node ${process.versions.node}.`);
  note("Install the current LTS from https://nodejs.org and run this again.");
  return false;
}

/* ------------------------------------------------------------ the pieces */

function dependenciesInstalled() {
  return existsSync(path.join(ROOT, "node_modules", "next", "package.json"));
}

function serverBuilt() {
  return existsSync(path.join(ROOT, ".next", "standalone", "server.js"));
}

async function installDependencies() {
  if (dependenciesInstalled() && !has("reinstall")) {
    good("Dependencies are already installed");
    return true;
  }
  const lockfile = existsSync(path.join(ROOT, "package-lock.json"));
  note(`Installing dependencies with npm ${lockfile ? "ci" : "install"} — this takes a few minutes.`);
  const result = run("npm", lockfile ? ["ci"] : ["install"]);
  if (!result.ok) {
    fail("The dependencies could not be installed.");
    note("Check your internet connection and run this again.");
    return false;
  }
  good("Dependencies installed");
  return true;
}

async function buildServer() {
  if (serverBuilt() && !has("rebuild")) {
    good("The application is already built");
    stageStaticAssets();
    return true;
  }
  note("Building the application — this takes a few minutes and happens once.");
  const result = run("npm", ["run", "build"]);
  if (!result.ok) {
    fail("The application could not be built.");
    return false;
  }
  stageStaticAssets();
  good("Application built");
  return true;
}

/**
 * Put the static assets where the standalone server looks for them.
 *
 * Next deliberately leaves `.next/static` and `public/` out of the standalone
 * output and expects whoever packages the application to copy them in. Skip it
 * and the server starts perfectly, answers every route, and serves a page whose
 * stylesheets and images all 404 — which looks like a broken application rather
 * than a missing copy step. `scripts/build-desktop.mjs` does the same thing when
 * it packages the installer.
 */
function stageStaticAssets() {
  const standalone = path.join(ROOT, ".next", "standalone");
  const target = path.join(standalone, ".next", "static");
  const source = path.join(ROOT, ".next", "static");
  try {
    if (existsSync(source)) cpSync(source, target, { recursive: true });
    const publicSource = path.join(ROOT, "public");
    if (existsSync(publicSource)) {
      cpSync(publicSource, path.join(standalone, "public"), { recursive: true });
    }
  } catch {
    warn("Some static files could not be copied; the application may look unstyled.");
  }
}

/* ------------------------------------------------- the first-launch bootstrap */

/**
 * Drive `desktop/bootstrap/run.mjs`, exactly as the Tauri shell does.
 *
 * Same process, same newline-delimited JSON on its stdout, same answers on its
 * stdin. The only difference is that the events are rendered as console lines
 * instead of as a native window — which is the whole reason this file exists
 * rather than a second provisioning system.
 */
function runBootstrap(extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        path.join(ROOT, "desktop", "bootstrap", "run.mjs"),
        "--data-dir",
        dataDir(),
        /* Deliberately no --resources. That flag points the bootstrap at a
           packaged layout; from a source folder its absence is what makes it
           look for the catalogue in this checkout's own vendor/ directory,
           which is where the catalogue actually is. */
        ...extraArgs,
      ],
      { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"], env: process.env },
    );

    const titles = new Map();
    let buffer = "";
    let failed = null;

    const answer = (id, payload) => {
      try {
        child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      } catch {
        /* the bootstrap has already gone */
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        void handle(event);
      }
    });

    async function handle(event) {
      switch (event.t) {
        case "begin":
          note(BEGIN[event.reason] ?? BEGIN.other);
          break;
        case "step":
          if (event.title) titles.set(event.id, event.title);
          if (event.state === "running") {
            progress(`${titles.get(event.id) ?? event.id}…`);
          } else {
            clearProgress();
            const label = titles.get(event.id) ?? event.id;
            if (event.state === "failed") fail(label);
            else good(event.state === "skipped" ? `${label} — nothing to do` : label);
            for (const [key, value] of Array.isArray(event.detail) ? event.detail : []) {
              note(`${key}: ${value}`);
            }
            if (typeof event.detail === "string") note(event.detail);
          }
          break;
        case "progress":
          progress(
            event.percent == null
              ? `${titles.get(event.id) ?? event.id}: ${event.detail ?? "working"}`
              : `${titles.get(event.id) ?? event.id}: ${bar(event.percent)} ${event.percent}%  ${event.detail ?? ""}`,
          );
          break;
        case "failed":
          clearProgress();
          failed = event.message ?? "Something did not finish.";
          fail(failed);
          for (const [key, value] of Array.isArray(event.detail) ? event.detail : []) {
            note(`${key}: ${value}`);
          }
          break;
        case "ask":
          clearProgress();
          answer(event.id, await answerQuestion(event));
          break;
        case "done":
          clearProgress();
          /* The fast path says nothing at all otherwise, and a step that prints
             nothing reads as a step that failed. */
          if (event.reason === "already-initialised") {
            good("Already set up — nothing to install");
          } else if (event.reason === "incomplete") {
            warn("Some parts are not finished yet.");
          }
          break;
        default:
          break;
      }
    }

    /**
     * The two questions the bootstrap asks.
     *
     * The model is confirmed before anything is downloaded, which is a
     * requirement rather than a nicety — so `--yes` takes the recommendation
     * rather than skipping the question, and a person at a console is shown
     * the size and the reason first.
     */
    async function answerQuestion(event) {
      if (event.kind === "model") {
        const model = event.recommended ?? {};
        say("");
        say(`  ${C.bold}Local AI model${C.off}`);
        note(`${model.label} — about ${model.downloadGb} GB to download.`);
        note(event.why ?? "");
        if (ASSUME_YES) {
          note("Taking the recommendation.");
          return { answer: { model: model.id } };
        }
        for (const option of event.options ?? []) {
          note(
            `${option.id === model.id ? "→" : " "} ${option.label} · ${option.downloadGb} GB` +
              `${option.fits ? "" : " (not enough free space)"}`,
          );
        }
        const reply = await ask(
          `Press Enter for ${model.label}, type another id, or type skip:`,
          model.id,
        );
        if (/^skip$/i.test(reply)) return { skip: true };
        const picked = (event.options ?? []).find((o) => o.id === reply);
        return { answer: { model: picked?.id ?? model.id } };
      }

      // A retry. Optional steps may also be continued without.
      if (ASSUME_YES) return event.canSkip ? { skip: true } : { retry: true };
      const choices = event.canSkip ? "[r]etry, [s]kip, [q]uit" : "[r]etry, [q]uit";
      const reply = await ask(`${choices}:`, "r");
      if (/^q/i.test(reply)) return { cancel: true };
      if (/^s/i.test(reply) && event.canSkip) return { skip: true };
      return { retry: true };
    }

    child.on("exit", (code) => {
      clearProgress();
      resolve({ ok: code === 0, code, message: failed });
    });
  });
}

/** Why this launch is doing anything, in a sentence rather than a code. */
const BEGIN = {
  "first-launch": "Setting up for the first time. This happens once.",
  "resume-download": "Continuing the download that was interrupted.",
  update: "Installing the parts this version changed. The rest is left alone.",
  repair: "Repairing the installation — only what is missing is installed.",
  "skills-missing": "Part of the design catalogue is missing; installing it again.",
  "model-missing": "The local AI model is no longer installed; downloading it again.",
  other: "Checking what needs installing.",
};

function bar(percent) {
  const width = 24;
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`;
}

/* ---------------------------------------------------------------- shortcuts */

/**
 * A Start Menu entry and a desktop shortcut, on Windows.
 *
 * Written with PowerShell's WScript.Shell, which is what every Windows
 * installer uses and needs no administrator: both locations are inside the
 * user's own profile.
 */
function createShortcuts() {
  if (!WINDOWS || has("no-shortcuts")) return false;
  const target = path.join(ROOT, "start-windows.cmd");
  if (!existsSync(target)) return false;

  const icon = path.join(ROOT, "desktop", "tauri", "src-tauri", "icons", "icon.ico");
  const places = [
    path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs"),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : "",
  ].filter(Boolean);

  const script = places
    .map(
      (dir) => `
$link = $shell.CreateShortcut((Join-Path '${dir.replace(/'/g, "''")}' 'Website Generator.lnk'))
$link.TargetPath = '${target.replace(/'/g, "''")}'
$link.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'
$link.Description = 'Website Generator'
${existsSync(icon) ? `$link.IconLocation = '${icon.replace(/'/g, "''")}'` : ""}
$link.Save()`,
    )
    .join("\n");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `$shell = New-Object -ComObject WScript.Shell\n${script}`],
    { stdio: "ignore" },
  );
  return result.status === 0;
}

/* ------------------------------------------------------------------ starting */

/**
 * Start the application through the sidecar the packaged app uses.
 *
 * `desktop/sidecar/launch.mjs` already picks a free loopback port, boots the
 * standalone server, waits for `/api/health` and prints `WG_READY <url>`. That
 * contract is what this reads; the only thing added is opening a browser at the
 * address, because there is no native window here to navigate.
 */
function startApplication() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "desktop", "sidecar", "launch.mjs"), "--data-dir", dataDir()],
      { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"], env: process.env },
    );

    let buffer = "";
    let opened = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const ready = line.match(/^WG_READY (.+)$/);
        if (ready && !opened) {
          opened = true;
          const url = ready[1].trim();
          good(`Website Generator is running at ${url}`);
          note("Leave this window open while you use it. Closing it stops the application.");
          openBrowser(url);
          continue;
        }
        const failure = line.match(/^WG_FAILED (.+)$/);
        if (failure) fail(failure[1].trim());
      }
    });

    const stop = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    child.on("exit", (code) => resolve({ ok: opened && code === 0, code }));
  });
}

function openBrowser(url) {
  const [command, commandArgs] = WINDOWS
    // `start` is a shell builtin, and the empty title argument is what stops
    // cmd treating a quoted URL as the window title.
    ? ["cmd.exe", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];

  try {
    const child = spawn(command, commandArgs, { detached: true, stdio: "ignore" });
    /* A missing browser opener must not take the application down with it.
       `spawn` reports ENOENT asynchronously, so a try/catch around it never
       sees the failure — the handler is the only thing that does. A headless
       machine legitimately has no xdg-open, and the server is already running
       and perfectly usable at the address printed above. */
    child.once("error", () => note(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    note(`Open ${url} in your browser.`);
  }
}

/* ---------------------------------------------------------------- launchers */

/**
 * The scripts a person double-clicks afterwards.
 *
 * Written rather than committed for Windows only, because the working directory
 * has to be this folder and the folder is wherever the person put it.
 */
function writeLauncher() {
  if (!WINDOWS) return;
  const file = path.join(ROOT, "start-windows.cmd");
  if (existsSync(file)) return;
  writeFileSync(
    file,
    [
      "@echo off",
      "rem Starts Website Generator. Created by install-windows.cmd.",
      'cd /d "%~dp0"',
      'node "scripts\\install-app.mjs" --start',
      "if errorlevel 1 pause",
      "",
    ].join("\r\n"),
  );
}

/* --------------------------------------------------------------------- main */

async function main() {
  say("");
  say(`${C.bold}Website Generator${C.off}`);

  if (START_ONLY) {
    if (!serverBuilt()) {
      fail("The application has not been installed yet.");
      note(WINDOWS ? "Double-click install-windows.cmd first." : "Run ./install.sh first.");
      process.exitCode = 1;
      return;
    }
    const started = await startApplication();
    process.exitCode = started.ok ? 0 : 1;
    return;
  }

  step("Checking what is needed");
  if (!checkNode()) {
    process.exitCode = 1;
    return;
  }
  mkdirSync(dataDir(), { recursive: true });
  good("Application folder ready");

  step("Installing the application");
  if (!(await installDependencies())) {
    process.exitCode = 1;
    return;
  }
  if (!(await buildServer())) {
    process.exitCode = 1;
    return;
  }

  step("Setting up");
  const bootstrap = await runBootstrap(has("repair") ? ["--force"] : []);
  if (!bootstrap.ok) {
    warn("Setup did not finish. Nothing has been lost — run this again to carry on.");
  }

  writeLauncher();
  if (WINDOWS) {
    if (createShortcuts()) good("Added to the Start Menu and your desktop");
    else note("Shortcuts could not be created; start-windows.cmd starts the application.");
  }

  step("Done");
  good("Website Generator is installed on this computer.");
  note(
    WINDOWS
      ? "Start it from the Start Menu, your desktop, or start-windows.cmd."
      : "Start it with ./start.sh, or: node scripts/install-app.mjs --start",
  );

  // `--no-start` is for a scripted install, where blocking on a running server
  // is the last thing wanted.
  if (!has("no-start") && (await confirm("Start it now?", true))) {
    const started = await startApplication();
    process.exitCode = started.ok ? 0 : 1;
  }
}

main().catch((err) => {
  clearProgress();
  fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
