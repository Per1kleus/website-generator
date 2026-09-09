#!/usr/bin/env node
/**
 * Re-vendors the ui-ux-pro-max skill from upstream.
 *
 * The skill is committed rather than fetched at runtime so generation works
 * offline and a given business produces the same design recommendation every
 * time. This script is how you deliberately move to a newer catalogue.
 *
 * Run `npm run test:mobile` afterwards — a catalogue change can legitimately
 * move the recommended palette or typography.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const UPSTREAM = "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git";
const DEST = path.resolve("vendor/ui-ux-pro-max");

const tmp = mkdtempSync(path.join(tmpdir(), "uiux-"));
try {
  console.log("Cloning upstream…");
  execFileSync("git", ["clone", "--depth", "1", UPSTREAM, tmp], { stdio: "inherit" });

  const sha = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const version = JSON.parse(readFileSync(path.join(tmp, "skill.json"), "utf8")).version;
  const src = path.join(tmp, "src", "ui-ux-pro-max");

  for (const dir of ["data", "scripts"]) {
    rmSync(path.join(DEST, dir), { recursive: true, force: true });
    cpSync(path.join(src, dir), path.join(DEST, dir), { recursive: true });
  }
  // Upstream's tests exercise upstream, not this integration.
  rmSync(path.join(DEST, "scripts", "tests"), { recursive: true, force: true });
  rmSync(path.join(DEST, "scripts", "__pycache__"), { recursive: true, force: true });
  cpSync(path.join(tmp, "LICENSE"), path.join(DEST, "LICENSE"));

  const provenance = readFileSync(path.join(DEST, "PROVENANCE.md"), "utf8")
    .replace(/^- Version:.*$/m, `- Version:  ${version}`)
    .replace(/^- Commit:.*$/m, `- Commit:   ${sha}`);
  writeFileSync(path.join(DEST, "PROVENANCE.md"), provenance);

  console.log(`Vendored ui-ux-pro-max ${version} (${sha.slice(0, 12)}).`);
  console.log("Now run: npm run test:mobile");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
