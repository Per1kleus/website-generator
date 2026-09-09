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
 *   node scripts/build-desktop.mjs [--no-bundle]
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readlinkSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TAURI = path.join(ROOT, "desktop", "tauri", "src-tauri");
const STANDALONE = path.join(ROOT, ".next", "standalone");

/** Windows ships npm and npx as .cmd shims; execFileSync uses no shell. */
const bin = (name) => (process.platform === "win32" ? `${name}.cmd` : name);
const run = (cmd, args, opts = {}) =>
  execFileSync(bin(cmd), args, { stdio: "inherit", cwd: ROOT, ...opts });

/** Tauri names sidecar binaries by target triple. */
function targetTriple() {
  if (process.env.WG_TARGET_TRIPLE) return process.env.WG_TARGET_TRIPLE;
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return out.match(/^host:\s*(.+)$/m)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
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

const links = findSymlinks(STANDALONE);
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
const binaries = path.join(TAURI, "binaries");
mkdirSync(binaries, { recursive: true });
const suffix = process.platform === "win32" ? ".exe" : "";
const sidecarPath = path.join(binaries, `wg-node-${triple}${suffix}`);
copyFileSync(process.execPath, sidecarPath);
if (process.platform !== "win32") chmodSync(sidecarPath, 0o755);
console.log(`   ${path.basename(sidecarPath)}`);

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

if (process.argv.includes("--no-bundle")) {
  console.log("\nStaged. Skipping the bundler (--no-bundle).");
  process.exit(0);
}

console.log("→ Bundling the Windows installer…");
run("npx", ["tauri", "build"], { cwd: path.join(ROOT, "desktop", "tauri") });
console.log("\nDone. The installer is under desktop/tauri/src-tauri/target/release/bundle/nsis/");
