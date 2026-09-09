#!/usr/bin/env node
/**
 * Prepares and builds the Android client.
 *
 * Android cannot run the application's server: it needs Node, native modules
 * (better-sqlite3, sharp) and a Python subprocess. The Android app is
 * therefore a client to a deployment — the same UI, served over the network —
 * rather than a second implementation.
 *
 * WG_REMOTE_URL bakes the backend address in so a distributed APK opens
 * straight into the app. Without it the first screen asks for the address once
 * and remembers it.
 *
 *   WG_REMOTE_URL=https://generator.example.com node scripts/build-android.mjs [--release|--bundle]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const MOBILE = path.join(ROOT, "mobile");
// src/ is the tracked template; www/ is generated on every build. Keeping them
// apart means the __WG_REMOTE_URL__ placeholder survives the first build.
const TEMPLATE = path.join(MOBILE, "android-shell", "src", "index.html");
const WEB_DIR = path.join(MOBILE, "android-shell", "www");

/** Windows ships npm and npx as .cmd shims; execFileSync uses no shell. */
const bin = (name) =>
  process.platform === "win32" && /^(npm|npx)$/.test(name) ? `${name}.cmd` : name;
const run = (cmd, args, opts = {}) =>
  execFileSync(bin(cmd), args, { stdio: "inherit", cwd: MOBILE, ...opts });

const remote = (process.env.WG_REMOTE_URL ?? "").trim().replace(/\/+$/, "");
if (remote && !/^https:\/\//i.test(remote)) {
  // Android blocks cleartext traffic by default, and shipping an app that
  // sends a session cookie over http would be worse than failing here.
  console.error("WG_REMOTE_URL must be an https:// address.");
  process.exit(1);
}

console.log(
  remote
    ? `→ Baking backend address: ${remote}`
    : "→ No WG_REMOTE_URL set — the app will ask for the address on first run.",
);
mkdirSync(WEB_DIR, { recursive: true });
writeFileSync(
  path.join(WEB_DIR, "index.html"),
  readFileSync(TEMPLATE, "utf8").replace(/__WG_REMOTE_URL__/g, remote),
);

// Capacitor needs its own toolchain; it is not a dependency of the web app.
if (!existsSync(path.join(MOBILE, "node_modules", "@capacitor", "cli"))) {
  console.log("→ Installing the Capacitor toolchain…");
  run("npm", ["install"]);
}

if (!existsSync(path.join(MOBILE, "android"))) {
  console.log("→ Creating the Android project…");
  run("npx", ["cap", "add", "android"]);
}

console.log("→ Syncing…");
run("npx", ["cap", "sync", "android"]);

const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const androidDir = path.join(MOBILE, "android");

if (process.argv.includes("--bundle")) {
  console.log("→ Building the release App Bundle (.aab)…");
  run(gradle, ["bundleRelease"], { cwd: androidDir });
  console.log("\nDone: mobile/android/app/build/outputs/bundle/release/app-release.aab");
} else if (process.argv.includes("--release")) {
  console.log("→ Building the release APK…");
  run(gradle, ["assembleRelease"], { cwd: androidDir });
  console.log("\nDone: mobile/android/app/build/outputs/apk/release/");
} else {
  console.log("→ Building the debug APK…");
  run(gradle, ["assembleDebug"], { cwd: androidDir });
  console.log("\nDone: mobile/android/app/build/outputs/apk/debug/app-debug.apk");
}
