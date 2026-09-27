/**
 * Installing UI/UX Pro Max the way its own project says to.
 *
 * The skill publishes a CLI — `npm install -g ui-ux-pro-max-cli`, then
 * `uipro init --ai <assistant>` — so that is what runs here, rather than
 * copying files out of the repository by hand. The application already ships a
 * vendored copy of the catalogue so that generation works offline on day one;
 * this step installs the current release next to it and the generator prefers
 * whichever is newer.
 *
 * Two details make this work inside a packaged application:
 *
 *   npm is staged beside the bundled Node runtime, so `npm install` is a real
 *   possibility on a machine where the user has never installed Node.
 *
 *   Everything lands under the application's own data directory with
 *   `--prefix`, so nothing needs administrator rights, nothing is written to
 *   Program Files, and a global npm setup the user may already have is left
 *   completely alone.
 */
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { skills } from "./manifest.mjs";
import { bundledSkillDir, defaultSkillDir } from "./state.mjs";

const execFileAsync = promisify(execFile);

/**
 * The skills a complete installation has, from the manifest.
 *
 * "All required skills, not only the first one that happens to be needed" is a
 * requirement, so the list is data and every function below iterates it. There
 * is one today; adding a second is a manifest entry, not a code change.
 */
export const REQUIRED = skills();

export const PACKAGE = REQUIRED[0]?.package ?? "ui-ux-pro-max-cli";
/** Claude Code's layout is the one this application's generator reads. */
export const ASSISTANT = REQUIRED[0]?.assistant ?? "claude";

export function toolsDir(dataDir) {
  return path.join(dataDir, "tools");
}

/** Where `uipro init` is run, and therefore where the skill ends up. */
export function skillHome(dataDir) {
  return path.join(dataDir, "uiux");
}

export function skillDir(dataDir, skill = REQUIRED[0]) {
  return defaultSkillDir(dataDir, skill);
}

/**
 * npm's global layout differs by platform, and the CLI's own shim adds a third
 * shape. Running the entry point with a known Node binary sidesteps all of it.
 */
function cliEntry(prefix) {
  const candidates = [
    path.join(prefix, "lib", "node_modules", PACKAGE, "dist", "index.js"),
    path.join(prefix, "node_modules", PACKAGE, "dist", "index.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function installedVersion(prefix) {
  for (const dir of [
    path.join(prefix, "lib", "node_modules", PACKAGE),
    path.join(prefix, "node_modules", PACKAGE),
  ]) {
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    try {
      return JSON.parse(readFileSync(manifest, "utf8")).version ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The npm to use: the one staged with the application, or the machine's own.
 * `null` means npm is genuinely unavailable and the caller falls back to the
 * vendored catalogue rather than failing the setup.
 */
export function findNpm({ resources, node = process.execPath } = {}) {
  const candidates = [];
  if (resources) {
    candidates.push(
      path.join(resources, "npm", "bin", "npm-cli.js"),
      path.join(resources, "npm", "npm-cli.js"),
    );
  }
  // The npm that belongs to the Node binary now running. On a developer's
  // machine that is their own npm; in the packaged app it is the staged copy.
  const nodeDir = path.dirname(node);
  candidates.push(
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
  );

  const script = candidates.map((p) => path.resolve(p)).find((p) => existsSync(p));
  // Running npm's own entry point with a known Node avoids every difference
  // between the POSIX symlink, the Windows .cmd shim and PATH.
  if (script) return { kind: "script", node, script };
  return { kind: "system", command: process.platform === "win32" ? "npm.cmd" : "npm" };
}

async function runNpm(npm, args, cwd) {
  const options = { cwd, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 };
  if (npm.kind === "script") {
    return execFileAsync(npm.node, [npm.script, ...args], options);
  }
  return execFileAsync(npm.command, args, options);
}

/**
 * Is a usable skill already there?
 *
 * An application update must not reinstall what is already installed and
 * working, so this is the question asked before anything is downloaded. And
 * "there" means every file the manifest names, readable and non-empty — an npm
 * install killed halfway leaves a directory behind with half its catalogue, and
 * a directory existing is the one thing that must never be taken as proof.
 */
export function existing(dataDir, skill = REQUIRED[0]) {
  if (!skill) return null;
  const dir = skillDir(dataDir, skill);
  const missing = missingFiles(dir, skill);
  if (missing.length) return null;
  return {
    id: skill.id,
    path: dir,
    version: installedVersion(toolsDir(dataDir)),
    source: "cli",
  };
}

/** Which of a skill's required files are absent, empty or unreadable. */
export function missingFiles(dir, skill) {
  return skill.requiredFiles.filter((relative) => {
    const file = path.join(dir, relative);
    try {
      const info = statSync(file);
      if (!info.isFile() || info.size === 0) return true;
      /* Readable, not merely present: a file this process cannot open is as
         useless to the design catalogue as one that is not there. One byte is
         enough to prove it and avoids reading a megabyte of CSV to find out. */
      const fd = openSync(file, "r");
      try {
        return readSync(fd, Buffer.alloc(1), 0, 1, 0) !== 1;
      } finally {
        closeSync(fd);
      }
    } catch {
      return true;
    }
  });
}

/**
 * Install the CLI and run its initialiser.
 *
 * `report` receives plain-language progress. npm gives no machine-readable
 * progress for an install this small, so the caller shows an indeterminate
 * indicator rather than inventing percentages.
 */
export async function install(dataDir, { resources = null, report = () => {} } = {}) {
  const prefix = toolsDir(dataDir);
  const home = skillHome(dataDir);
  const npm = findNpm({ resources });

  // On a first launch none of these exist yet, and spawning into a directory
  // that is not there fails with a misleading ENOENT for the interpreter.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(prefix, { recursive: true });
  mkdirSync(home, { recursive: true });

  report({ detail: `Installing ${PACKAGE}…` });
  try {
    await runNpm(npm, ["install", PACKAGE, "--prefix", prefix, "--no-audit", "--no-fund"], dataDir);
  } catch (err) {
    throw new Error(`Could not install ${PACKAGE}: ${firstLine(err)}`);
  }

  const entry = cliEntry(prefix);
  if (!entry) throw new Error(`${PACKAGE} installed but its command was not found.`);

  report({ detail: "Setting up the design system…" });
  const node = npm.kind === "script" ? npm.node : process.execPath;
  try {
    await execFileAsync(node, [entry, "init", "--ai", ASSISTANT, "--force"], {
      cwd: home,
      timeout: 10 * 60_000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(`uipro init failed: ${firstLine(err)}`);
  }

  const installed = existing(dataDir);
  if (!installed) throw new Error("The design system did not appear where it was expected.");
  return { ...installed, installedAt: Date.now() };
}

/**
 * Prove a skill can answer, not just that its files are on disk.
 *
 * The check is the manifest's: the same script, the same arguments and the same
 * key in the answer that the application's own generator depends on. So
 * "verified" means the loader can use it, which is the only definition worth
 * recording.
 *
 * Python drives the search, so with no interpreter this reports `false` with a
 * reason rather than failing outright: the application falls back to its own
 * rules, which is the same behaviour as any machine without Python.
 */
export async function verify(dataDir, python = "python3", skill = REQUIRED[0], { dir = null } = {}) {
  if (!skill) return { ok: false, reason: "no-skill-required" };
  const root = dir ?? skillDir(dataDir, skill);

  const missing = missingFiles(root, skill);
  if (missing.length) {
    return { ok: false, reason: "not-installed", missing };
  }

  const spec = skill.verify;
  try {
    const { stdout } = await execFileAsync(
      python,
      [path.join(root, spec.script), ...spec.args],
      { cwd: root, timeout: spec.timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout);
    return { ok: Boolean(parsed?.[spec.expectKey]), reason: null, missing: [] };
  } catch (err) {
    return { ok: false, reason: `search-failed: ${firstLine(err)}`, missing: [] };
  }
}

/**
 * Every required skill, checked the same way.
 *
 * Returns one record per skill so the setup can report "3 of 3 installed,
 * 3 verified" rather than a single boolean that hides which one is broken.
 */
export async function verifyAll(dataDir, python = "python3", { resources = null, state = null } = {}) {
  const out = {};
  for (const skill of REQUIRED) {
    // Prefer the installed copy; fall back to the one bundled with the
    // application, which is a complete catalogue in its own right.
    const installedDir = state?.skills?.[skill.id]?.path ?? skillDir(dataDir, skill);
    const installedMissing = missingFiles(installedDir, skill);
    const dir = installedMissing.length ? bundledSkillDir(resources, skill) : installedDir;

    const result = await verify(dataDir, python, skill, { dir });
    out[skill.id] = {
      id: skill.id,
      label: skill.label,
      path: dir,
      source: dir === installedDir ? "installed" : "bundled",
      /** Whether the recorded copy has lost files, which is what a repair fixes. */
      installedMissing,
      required: skill.requiredFiles.length,
      installed: skill.requiredFiles.length - (result.missing?.length ?? 0),
      missing: result.missing ?? [],
      complete: (result.missing?.length ?? 0) === 0,
      verified: result.ok,
      reason: result.reason,
    };
  }
  return out;
}

function firstLine(err) {
  const message = err instanceof Error ? (err.stderr || err.message) : String(err);
  return String(message).trim().split("\n").pop().slice(0, 200);
}
