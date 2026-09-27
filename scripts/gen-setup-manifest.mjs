#!/usr/bin/env node
/**
 * Turn `setup-manifest.json` into a TypeScript module the server can import.
 *
 * The manifest is one file, edited by hand, read at runtime by the first-launch
 * bootstrap. The running server needs the same values — and importing the JSON
 * from `src/` is the obvious way to get them, which is exactly what must not
 * happen: Next's output tracing follows an import that leaves `src/` by
 * carrying its neighbours into the standalone build. Pointed at `desktop/` it
 * swept in the Rust build directory; pointed at the repository root it swept in
 * the documentation, the screenshots and the scripts. Either way a 7.5 GB
 * server, and either way not the manifest's fault.
 *
 * So the values are generated into `src/server/setup-manifest.data.ts`, which
 * lives inside `src/` and traces to nothing. The generated file is committed, so
 * a fresh checkout builds without a hidden step, and `scripts/setup-qa.mjs`
 * fails if the two ever disagree — which is what makes "one source of truth"
 * true rather than merely intended.
 *
 *   node scripts/gen-setup-manifest.mjs           write it
 *   node scripts/gen-setup-manifest.mjs --check   fail if it is out of date
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "setup-manifest.json");
const TARGET = path.join(ROOT, "src", "server", "setup-manifest.data.ts");

const manifest = JSON.parse(readFileSync(SOURCE, "utf8"));

/** The commentary belongs in the JSON; carrying it into generated code twice
 *  would only give it a second place to go stale. */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, inner]) => [key, strip(inner)]),
    );
  }
  return value;
}

const contents = `/**
 * GENERATED FILE — do not edit.
 *
 * Written from setup-manifest.json by scripts/gen-setup-manifest.mjs, which runs
 * before every build. Edit the JSON; this follows.
 *
 * It exists because the server cannot import the JSON directly: Next's output
 * tracing follows an import that leaves src/ by carrying its neighbouring files
 * into the standalone build, which turned a 40 MB server into a 7.5 GB one. A
 * generated module inside src/ traces to nothing.
 */
export const MANIFEST = ${JSON.stringify(strip(manifest), null, 2)};
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* missing counts as out of date */
  }
  if (current !== contents) {
    console.error(
      "src/server/setup-manifest.data.ts is out of date.\n" +
        "Run: node scripts/gen-setup-manifest.mjs",
    );
    process.exit(1);
  }
  console.log("setup-manifest.data.ts is up to date.");
  process.exit(0);
}

writeFileSync(TARGET, contents);
console.log(`Wrote ${path.relative(ROOT, TARGET)} from ${path.relative(ROOT, SOURCE)}`);
