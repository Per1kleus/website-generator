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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const PACKAGE = "ui-ux-pro-max-cli";
/** Claude Code's layout is the one this application's generator reads. */
export const ASSISTANT = "claude";

export function toolsDir(dataDir) {
  return path.join(dataDir, "tools");
}

/** Where `uipro init` is run, and therefore where the skill ends up. */
export function skillHome(dataDir) {
  return path.join(dataDir, "uiux");
}

export function skillDir(dataDir) {
  return path.join(skillHome(dataDir), ".claude", "skills", "ui-ux-pro-max");
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
 * working, so this is the question asked before anything is downloaded.
 */
export function existing(dataDir) {
  const dir = skillDir(dataDir);
  const search = path.join(dir, "scripts", "search.py");
  const data = path.join(dir, "data", "styles.csv");
  if (!existsSync(search) || !existsSync(data)) return null;
  return {
    path: dir,
    version: installedVersion(toolsDir(dataDir)),
    source: "cli",
  };
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
 * Prove the skill can answer, not just that its files are on disk.
 *
 * Python drives the search, so with no interpreter this reports `false` with a
 * reason instead of failing: the application falls back to its rule set, which
 * is the same behaviour as any machine without Python.
 */
export async function verify(dataDir, python = "python3") {
  const dir = skillDir(dataDir);
  const search = path.join(dir, "scripts", "search.py");
  if (!existsSync(search)) return { ok: false, reason: "not-installed" };
  try {
    const { stdout } = await execFileAsync(
      python,
      [search, "warm artisanal cafe", "--design-system", "--json"],
      { cwd: dir, timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout);
    return { ok: Boolean(parsed?.design_system), reason: null };
  } catch (err) {
    return { ok: false, reason: `search-failed: ${firstLine(err)}` };
  }
}

function firstLine(err) {
  const message = err instanceof Error ? (err.stderr || err.message) : String(err);
  return String(message).trim().split("\n").pop().slice(0, 200);
}
