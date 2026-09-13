#!/usr/bin/env node
/**
 * Stages everything the Windows installer needs, then runs the Tauri bundler.
 *
 * The application is a Node server, so the desktop build ships that server as
 * a sidecar rather than pretending the app is a static frontend. This script
 * assembles the three pieces Tauri bundles as resources:
 *
 *   .next/standalone   the self-contained server (plus static/ and public/,
 *                      which Next deliberately leaves for the packager)
 *   binaries/wg-node   the Node runtime, so the user installs nothing
 *   python/            optional: keeps the design catalogue working
 *
 * Nothing secret is staged. API keys and OAuth credentials are the user's own
 * and live in their OS profile, never in the installer.
 *
 * The installer is written as WebsiteGenerator-Setup.exe.
 *
 *   node scripts/build-desktop.mjs [--no-bundle] [--target <triple>] [--runner <cmd>]
 *
 * `--target` builds for another platform than this one — the Windows
 * installer from a Linux machine, say — which additionally needs the Rust
 * Windows target, cargo-xwin and makensis. Without it the build is for this
 * machine, exactly as before.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readlinkSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TAURI = path.join(ROOT, "desktop", "tauri", "src-tauri");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const CACHE = path.join(ROOT, "desktop", "tauri", ".cache");

/**
 * The installer's filename.
 *
 * Tauri names it after the product and version. This is the name a person is
 * told to download and double-click, so it is fixed and boring on purpose.
 */
const INSTALLER_NAME = "WebsiteGenerator-Setup.exe";

/** Windows ships npm and npx as .cmd shims; execFileSync uses no shell. */
const bin = (name) => (process.platform === "win32" ? `${name}.cmd` : name);
const run = (cmd, args, opts = {}) =>
  execFileSync(bin(cmd), args, { stdio: "inherit", cwd: ROOT, ...opts });

/** The machine this build is running on. */
function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return out.match(/^host:\s*(.+)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * The machine this build is *for*.
 *
 * Normally the same one. `--target` (or WG_TARGET_TRIPLE) names another, which
 * is how a Windows installer is produced from a Linux machine: Rust already
 * knows how to emit Windows objects, and everything else staged here — the
 * server, npm, the icons — is platform-independent JavaScript and data. The
 * one piece that is not is the Node runtime, and that is handled below.
 */
function targetTriple() {
  const flag = process.argv.indexOf("--target");
  if (flag >= 0 && process.argv[flag + 1]) return process.argv[flag + 1];
  return process.env.WG_TARGET_TRIPLE || hostTriple();
}

console.log("→ Building the application server…");
run("npx", ["next", "build"]);

if (!existsSync(path.join(STANDALONE, "server.js"))) {
  console.error(
    'No standalone server was produced. next.config.ts must set output: "standalone".',
  );
  process.exit(1);
}

// Next intentionally leaves these for whoever packages the app.
console.log("→ Staging static assets…");
cpSync(path.join(ROOT, ".next", "static"), path.join(STANDALONE, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(ROOT, "public"))) {
  cpSync(path.join(ROOT, "public"), path.join(STANDALONE, "public"), { recursive: true });
}
// A packaged app must never ship the developer's own database or uploads.
rmSync(path.join(STANDALONE, "data"), { recursive: true, force: true });

/**
 * Replace Next's native-module symlinks with real packages.
 *
 * Turbopack externalises native modules under hashed names and links them from
 * `.next/node_modules/<name>-<hash>` to the real package. Symlinks do not
 * survive being bundled into an installer — Tauri's resource copier drops
 * them, and Windows needs a privilege to create them at all — so the installed
 * app would start, then fail to render any page with
 * "Cannot find module 'better-sqlite3-<hash>'".
 *
 * Each link becomes a two-line package that requires the real one, which is
 * already staged in the standalone tree. That is a few hundred bytes rather
 * than a second copy of sharp.
 */
function materialiseExternals() {
  const dir = path.join(STANDALONE, ".next", "node_modules");
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name);
    if (!lstatSync(entry).isSymbolicLink()) continue;
    const real = path.basename(readlinkSync(entry));
    rmSync(entry, { recursive: true, force: true });
    mkdirSync(entry, { recursive: true });
    if (existsSync(path.join(STANDALONE, "node_modules", real))) {
      writeFileSync(
        path.join(entry, "package.json"),
        `${JSON.stringify({ name, version: "0.0.0", main: "index.js" }, null, 2)}\n`,
      );
      writeFileSync(path.join(entry, "index.js"), `module.exports = require("${real}");\n`);
    } else {
      // No staged copy to point at, so carry the package itself.
      cpSync(path.join(ROOT, "node_modules", real), entry, {
        recursive: true,
        dereference: true,
      });
    }
    console.log(`   ${name} → ${real}`);
  }
}

console.log("→ Materialising native-module links…");
materialiseExternals();

/**
 * npm, staged beside the Node runtime.
 *
 * First-launch setup installs UI/UX Pro Max the way its own project documents
 * — `npm install ui-ux-pro-max-cli`, then `uipro init`. That needs an npm, and
 * the user is promised they will never install one. It is a few megabytes of
 * JavaScript next to a runtime that is already there.
 */
console.log("→ Staging npm…");
const npmSource = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm");
const npmTarget = path.join(ROOT, "desktop", "tauri", "npm");
rmSync(npmTarget, { recursive: true, force: true });
if (existsSync(npmSource)) {
  cpSync(npmSource, npmTarget, { recursive: true, dereference: true });
  console.log(`   from ${path.relative(ROOT, npmSource)}`);
} else {
  console.error(
    `Could not find npm next to this Node install (looked in ${npmSource}).\n` +
      "The packaged application needs it to install the design system on first launch.",
  );
  process.exit(1);
}

// Optional: an embedded Python keeps the ui-ux-pro-max design catalogue
// working. Without it the app still runs and falls back, as it does on any
// machine without Python.
const embeddedPython = process.env.WG_PYTHON_DIR;
if (embeddedPython && existsSync(embeddedPython)) {
  console.log("→ Staging the embedded Python runtime…");
  cpSync(embeddedPython, path.join(TAURI, "python"), { recursive: true });
} else {
  console.log("   (no WG_PYTHON_DIR set — the design catalogue will use the system Python)");
}

/**
 * Nothing bundled may be a symlink: an installer cannot carry one reliably,
 * and a link that silently vanishes turns into a runtime crash on a user's
 * machine rather than a build failure here.
 */
function findSymlinks(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name);
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink()) found.push(entry);
    else if (stat.isDirectory()) findSymlinks(entry, found);
    if (found.length > 20) break;
  }
  return found;
}

const links = [STANDALONE, npmTarget, path.join(ROOT, "desktop", "bootstrap")]
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => findSymlinks(dir));
if (links.length) {
  console.error("These symlinks would not survive packaging:");
  for (const link of links) console.error(`  ${path.relative(ROOT, link)}`);
  process.exit(1);
}

console.log("→ Staging the Node runtime…");
const triple = targetTriple();
if (!triple) {
  console.error("Could not determine the Rust target triple. Is the Rust toolchain installed?");
  process.exit(1);
}
const host = hostTriple();
const cross = Boolean(host) && triple !== host;
const targetIsWindows = triple.includes("windows");

/**
 * Fetch the official Node build for another platform.
 *
 * `process.execPath` is this machine's Node, and on a cross-build it is the
 * wrong architecture entirely — an installer carrying it would install
 * cleanly and then fail to start, which is the worst possible time to find
 * out. So the runtime for the target comes from nodejs.org, at the same
 * version this build was made and tested with, and its checksum is compared
 * against the release's own SHASUMS256.txt before it is used.
 */
async function fetchNodeFor(platform, arch) {
  const version = process.version; // e.g. v22.22.2
  const name = `node-${version}-${platform}-${arch}`;
  const exe = platform === "win" ? "node.exe" : "node";
  const cached = path.join(CACHE, `${name}-${exe}`);
  if (existsSync(cached) && statSync(cached).size > 1_000_000) {
    console.log(`   using the cached ${version} ${platform}-${arch} runtime`);
    return cached;
  }

  const base = `https://nodejs.org/dist/${version}`;
  const url = `${base}/${platform}-${arch}/${exe}`;
  console.log(`   downloading ${url}`);
  const [payload, sums] = await Promise.all([
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url} returned ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${base}/SHASUMS256.txt`).then((r) => {
      if (!r.ok) throw new Error(`could not read the checksums for ${version}`);
      return r.text();
    }),
  ]);

  const want = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === `${platform}-${arch}/${exe}`)?.[0];
  if (!want) throw new Error(`${version} publishes no ${platform}-${arch}/${exe}`);

  const body = Buffer.from(payload);
  const got = createHash("sha256").update(body).digest("hex");
  if (got !== want) {
    throw new Error(`the downloaded runtime does not match its published checksum`);
  }

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, body);
  console.log(`   checksum verified (${(body.length / 1e6).toFixed(0)} MB)`);
  return cached;
}

const binaries = path.join(TAURI, "binaries");
mkdirSync(binaries, { recursive: true });
// Tauri names sidecars by target triple, and the extension follows the target
// rather than the machine doing the building.
const suffix = targetIsWindows ? ".exe" : "";
const sidecarPath = path.join(binaries, `wg-node-${triple}${suffix}`);

if (cross) {
  const arch = triple.startsWith("aarch64") ? "arm64" : "x64";
  const platform = targetIsWindows ? "win" : triple.includes("darwin") ? "darwin" : "linux";
  copyFileSync(await fetchNodeFor(platform, arch), sidecarPath);
} else {
  copyFileSync(process.execPath, sidecarPath);
}
if (!targetIsWindows) chmodSync(sidecarPath, 0o755);
console.log(`   ${path.basename(sidecarPath)}`);


if (process.argv.includes("--no-bundle")) {
  console.log("\nStaged. Skipping the bundler (--no-bundle).");
  process.exit(0);
}

console.log("→ Bundling the Windows installer…");
const tauriArgs = ["tauri", "build"];
if (cross) {
  // Documented Tauri cross-compilation: Rust emits the Windows binary through
  // cargo-xwin, and the NSIS bundler runs against the system makensis.
  // `--runner` overrides that, for a target that needs no MSVC runtime.
  const flag = process.argv.indexOf("--runner");
  const runner = flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1] : "cargo-xwin";
  tauriArgs.push("--target", triple, "--runner", runner);
}
run("npx", tauriArgs, { cwd: path.join(ROOT, "desktop", "tauri") });

/**
 * Give the installer the name people are told to look for.
 *
 * Tauri names it "<product>_<version>_<arch>-setup.exe". That is a fine name
 * for a build artefact and a poor one for a download link, and the difference
 * matters more than it looks: the filename is the first thing a person sees
 * and the thing they search their downloads folder for later.
 */
const bundleDir = path.join(
  TAURI, "target", ...(cross ? [triple] : []), "release", "bundle", "nsis",
);
if (existsSync(bundleDir)) {
  const built = readdirSync(bundleDir).filter((f) => f.endsWith(".exe") && f !== INSTALLER_NAME);
  for (const file of built) {
    renameSync(path.join(bundleDir, file), path.join(bundleDir, INSTALLER_NAME));
    // The .sig beside it names the file it signs; keep the pair together.
    if (existsSync(path.join(bundleDir, `${file}.sig`))) {
      renameSync(
        path.join(bundleDir, `${file}.sig`),
        path.join(bundleDir, `${INSTALLER_NAME}.sig`),
      );
    }
    console.log(`   ${file} → ${INSTALLER_NAME}`);
  }
  const installer = path.join(bundleDir, INSTALLER_NAME);
  if (existsSync(installer)) {
    const mb = (statSync(installer).size / 1e6).toFixed(1);
    console.log(`\nDone. ${path.relative(ROOT, installer)} (${mb} MB)`);
    process.exit(0);
  }
}

console.error("\nThe bundler finished but produced no installer.");
process.exit(1);
