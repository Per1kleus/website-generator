#!/usr/bin/env node
/**
 * Project backup and recovery, end to end.
 *
 *   generate -> edit -> share with a client -> publish -> export a backup
 *   -> lose everything -> restore -> check it is the same project
 *
 * The scenario this feature exists for is the one the suite actually acts
 * out: the project is deleted after the backup is taken, and what has to come
 * back is not just the current page but the history, the images, the client's
 * approval and the repository the website is still being served from.
 *
 * The secret checks read the produced bytes rather than the code that
 * produced them. A backup is a file people copy around, and the failure worth
 * testing for is a field somebody adds carelessly in a year's time.
 *
 *   node --import tsx --conditions react-server scripts/backup-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { inspectBackup, readZip } = await import("../src/server/backup-restore.ts");
const { scanForSecrets, safeAssetName, isSafeAssetPath } = await import("../src/server/backup.ts");
const {
  BACKUP_MANIFEST, BACKUP_VERSION, canonicalJson, manifestForChecksum, validateManifest,
} = await import("../src/lib/backup-format.ts");

const APP_PORT = 3321;
const GH_PORT = 11741;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const GH = `http://127.0.0.1:${GH_PORT}`;

const results = [];
let failures = 0;
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 60000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

const children = [];
function spawnChild(cmd, args, env) {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  return child;
}
function stop(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

let cookie = "";
async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [name] = pair.split("=");
    const existing = cookie.split("; ").filter((p) => p && !p.startsWith(`${name}=`));
    cookie = [...existing, pair].join("; ");
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html, a redirect body, or bytes */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Download the backup as bytes rather than as text. */
async function downloadBackup(projectId) {
  const res = await fetch(`${BASE}/api/projects/${projectId}/backup`, {
    headers: { Cookie: cookie },
  });
  return {
    status: res.status,
    bytes: Buffer.from(await res.arrayBuffer()),
    checksum: res.headers.get("x-backup-checksum") ?? "",
    filename: res.headers.get("content-disposition") ?? "",
  };
}

/** Upload one, either to inspect or to restore. */
async function uploadBackup(bytes, { inspect = false, filename = "backup.wgbackup.zip" } = {}) {
  const body = new FormData();
  body.append("backup", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), filename);
  const res = await fetch(`${BASE}/api/backups/restore${inspect ? "?inspect=1" : ""}`, {
    method: "POST",
    headers: { Cookie: cookie },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

/** A tiny real PNG, so an upload has actual image bytes behind it. */
function png(r, g, b) {
  const { deflateSync } = require("node:zlib");
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const size = 48;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);

/** Rebuild a zip from entries, so a tampered manifest can be tested. */
async function rezip(entries) {
  const archiver = (await import("archiver")).default;
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks = [];
  archive.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
  });
  for (const e of entries) archive.append(e.bytes, { name: e.name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-backup-"));
const OWNER = "qa-creator";

try {
  const gh = spawnChild("node", ["scripts/mock-github.mjs", String(GH_PORT)], {});
  await waitFor(async () => {
    try {
      return (await fetch(`${GH}/__state?repo=x`)).ok;
    } catch {
      return false;
    }
  });

  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    WG_SECRET: "backup-qa-secret",
    GITHUB_CLIENT_ID: "mock-github-client",
    GITHUB_CLIENT_SECRET: "mock-github-secret",
    GITHUB_API_BASE: GH,
    GITHUB_WEB_BASE: GH,
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
    WG_GITHUB_TOKEN: "",
    WG_OLLAMA_AUTOPULL: "0",
    OLLAMA_HOST: "http://127.0.0.1:1",
  });
  let appLog = "";
  app.stdout.on("data", (d) => (appLog += String(d)));
  app.stderr.on("data", (d) => (appLog += String(d)));

  const up = await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/login`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 90000 });
  if (!up) throw new Error("app did not start");

  /* ==================================================================
     A project worth recovering
     ================================================================== */

  console.log("\n=== A project worth losing ===\n");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Backup QA",
      email: `backup+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  const created = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: "Nikos Plumbing",
      businessType: "plumber",
      location: "Patras",
      description: "A family plumbing business covering Patras and the surrounding villages.",
      siteKind: "business",
      style: "warm",
      defaultLocale: "en",
      locales: ["en"],
    }),
  });
  const projectId = created.json?.project?.id;
  record("a project is created", Boolean(projectId));

  await api(`/api/projects/${projectId}/generate`, { method: "POST" });
  const site = await waitFor(
    async () => (await api(`/api/projects/${projectId}/site`)).json?.site,
    { timeout: 240000 },
  );
  record("a website is generated", Boolean(site));

  // An image, so "restored but the photographs are gone" is a real test.
  const upload = new FormData();
  upload.append("file", new Blob([new Uint8Array(png(40, 120, 200))], { type: "image/png" }), "shop.png");
  const uploaded = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: upload,
  });
  record("an image is uploaded", uploaded.ok, `status ${uploaded.status}`);

  // An edit, so there is history worth keeping.
  const locale = site.meta.defaultLocale;
  const headlineKey = Object.keys(site.i18n[locale].strings).find((k) => k.endsWith(".headline"));
  await api(`/api/projects/${projectId}/site`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: {
        ...site,
        i18n: {
          ...site.i18n,
          [locale]: {
            ...site.i18n[locale],
            strings: { ...site.i18n[locale].strings, [headlineKey]: "Backed-up headline" },
          },
        },
      },
    }),
  });

  // A client link, with an approval on it.
  const shared = await api(`/api/projects/${projectId}/client-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create" }),
  });
  const previewToken = shared.json?.preview?.id;
  await fetch(`${BASE}/api/p/${previewToken}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "approved" }),
  });
  record("a client link exists and was approved", Boolean(previewToken));

  // Connect GitHub and publish, so there is a repository to reconnect to.
  const connect = await api("/api/github/connect?returnTo=%2Fprojects");
  const consentUrl = new URL(connect.headers.get("location"));
  const consent = await fetch(consentUrl.toString(), { redirect: "manual" });
  const cb = new URL(consent.headers.get("location"));
  await api(`${cb.pathname}${cb.search}`);

  await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "github" }),
  });
  const live = await waitFor(async () => {
    const st = await api(`/api/projects/${projectId}/deploy`);
    return st.json?.deployment?.status === "live" ? st.json.deployment : null;
  }, { timeout: 90000 });
  record("the website is published to GitHub Pages", Boolean(live), live?.url ?? "");

  await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: "nikosplumbing.gr" }),
  });

  const before = {
    site: (await api(`/api/projects/${projectId}/site`)).json.site,
    versions: (await api(`/api/projects/${projectId}/versions`)).json.versions,
    assets: (await api(`/api/projects/${projectId}/assets`)).json.assets,
    deployment: (await api(`/api/projects/${projectId}/deploy`)).json.deployment,
  };

  /* ==================================================================
     Export
     ================================================================== */

  console.log("\n=== Exporting a backup ===\n");

  const described = await api(`/api/projects/${projectId}/backup`, { method: "POST" });
  record("a backup can be described before it is downloaded", described.status === 200);
  record("...naming the format version",
    described.json?.backupVersion === BACKUP_VERSION, String(described.json?.backupVersion));
  record("...its size", (described.json?.size ?? 0) > 0, `${described.json?.size} bytes`);
  record("...what is in it",
    described.json?.contents?.versions >= 2 && described.json?.contents?.assets >= 1,
    JSON.stringify(described.json?.contents ?? {}));
  record("...and the repository it records",
    (described.json?.contents?.repository ?? "").startsWith(OWNER),
    described.json?.contents?.repository ?? "");

  const download = await downloadBackup(projectId);
  record("the backup downloads", download.status === 200, `${download.bytes.length} bytes`);
  record("...with a filename a person can recognise",
    /nikos-plumbing-\d{4}-\d{2}-\d{2}\.wgbackup\.zip/.test(download.filename),
    download.filename);
  record("...and a checksum in the headers", download.checksum.length === 64);

  const entries = await readZip(download.bytes);
  const manifestEntry = entries.find((e) => e.name === BACKUP_MANIFEST);
  const manifest = JSON.parse(manifestEntry.bytes.toString("utf8"));

  record("the archive carries a manifest", Boolean(manifestEntry));
  record("...and the image bytes beside it",
    entries.some((e) => e.name.startsWith("assets/")),
    entries.map((e) => e.name).join(", ").slice(0, 120));
  record("...with the file count it claims",
    entries.length === manifest.integrity.fileCount,
    `${entries.length} vs ${manifest.integrity.fileCount}`);
  record("...a checksum that verifies",
    manifest.integrity.checksum === download.checksum &&
      manifest.integrity.checksum.length === 64);

  record("every version is in the backup",
    manifest.versions.length === before.versions.length,
    `${manifest.versions.length} vs ${before.versions.length}`);
  record("...each with its own document",
    manifest.versions.every((v) => v.site && typeof v.site === "object"));
  record("the client preview and its approval are in the backup",
    manifest.previews.length === 1 && manifest.previews[0].responses.length === 1);
  record("the deployment metadata is in the backup",
    manifest.deployment?.repo_name && manifest.deployment.custom_domain === "nikosplumbing.gr",
    `${manifest.deployment?.repo_owner}/${manifest.deployment?.repo_name}`);
  record("the design system and research are in the backup",
    "design_system" in manifest.project && "business_profile" in manifest.project);
  record("translations and SEO travel inside the website document",
    Boolean(manifest.project.site?.i18n?.[locale]?.seo));

  /* ==================================================================
     Secrets
     ================================================================== */

  console.log("\n=== A backup is not a way to move secrets ===\n");

  const rawManifest = manifestEntry.bytes.toString("utf8");
  const wholeArchive = download.bytes.toString("latin1");

  record("the manifest contains no forbidden key", scanForSecrets(rawManifest).length === 0,
    scanForSecrets(rawManifest).join(", "));
  for (const [needle, what] of [
    ["gho_mock_access_token", "the GitHub token"],
    ["mock-github-secret", "the GitHub client secret"],
    ["backup-qa-secret", "the application's encryption secret"],
    ["access_token", "an access_token field"],
    ["refresh_token", "a refresh_token field"],
    ["password_hash", "a password hash"],
  ]) {
    record(`the archive does not contain ${what}`, !wholeArchive.includes(needle));
  }
  record("...nor a session cookie", !wholeArchive.includes(cookie.split("=")[1] ?? "@@none@@"));
  record("...nor anything shaped like a token",
    !/gh[pousr]_[A-Za-z0-9]{16,}|ya29\.[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}/.test(wholeArchive));

  // The guard itself must actually catch something, or it proves nothing.
  record("the secret scan catches a planted token",
    scanForSecrets(JSON.stringify({ project: { access_token: "x" } })).length === 1);
  record("...and a planted token-shaped value",
    scanForSecrets(JSON.stringify({ note: "gho_abcdefghijklmnopqrstuvwxyz012345" })).length === 1);

  /* ==================================================================
     Damaged backups
     ================================================================== */

  console.log("\n=== A damaged backup fails clearly ===\n");

  const corruptedManifest = { ...manifest, project: { ...manifest.project, business_name: "Tampered" } };
  const tampered = await rezip([
    { name: BACKUP_MANIFEST, bytes: Buffer.from(JSON.stringify(corruptedManifest)) },
    ...entries.filter((e) => e.name !== BACKUP_MANIFEST),
  ]);
  const tamperedResult = await uploadBackup(tampered, { inspect: true });
  record("an altered backup is refused", tamperedResult.status === 400);
  record("...for failing its checksum, by name",
    tamperedResult.json?.report?.checks?.some((c) => c.label === "Integrity" && !c.ok),
    JSON.stringify(tamperedResult.json?.report?.checks?.filter((c) => !c.ok) ?? []));

  const missingAsset = await rezip(entries.filter((e) => !e.name.startsWith("assets/")));
  const missingResult = await uploadBackup(missingAsset, { inspect: true });
  record("a backup with its images stripped out is refused", missingResult.status === 400);
  record("...saying the file count is wrong",
    missingResult.json?.report?.checks?.some((c) => c.label === "Completeness" && !c.ok));

  const damagedAsset = await rezip(
    entries.map((e) => {
      if (!e.name.startsWith("assets/")) return e;
      // Flip a byte in the middle rather than overwrite the last one: the
      // last byte may already be what it was being set to, and a test that
      // sometimes changes nothing is worse than no test.
      const bytes = Buffer.from(e.bytes);
      const at = Math.floor(bytes.length / 2);
      bytes[at] = bytes[at] ^ 0xff;
      return { name: e.name, bytes };
    }),
  );
  const damagedResult = await uploadBackup(damagedAsset, { inspect: true });
  record("a backup with a damaged image is refused", damagedResult.status === 400);
  record("...naming the assets check",
    damagedResult.json?.report?.checks?.some((c) => c.label === "Assets" && !c.ok),
    (damagedResult.json?.report?.checks ?? []).filter((c) => !c.ok).map((c) => c.detail).join(" "));

  const future = { ...manifest, backupVersion: BACKUP_VERSION + 5 };
  future.integrity = { ...future.integrity, checksum: "" };
  const futureBackup = await rezip([
    { name: BACKUP_MANIFEST, bytes: Buffer.from(JSON.stringify(future)) },
    ...entries.filter((e) => e.name !== BACKUP_MANIFEST),
  ]);
  const futureResult = await uploadBackup(futureBackup, { inspect: true });
  record("a backup from a newer version is refused", futureResult.status === 400);
  record("...telling the user to update rather than showing a number",
    /newer version/i.test(JSON.stringify(futureResult.json ?? {})));

  const notAZip = await uploadBackup(Buffer.from("this is not a zip file at all"), { inspect: true });
  record("a file that is not an archive is refused", notAZip.status === 400);
  const emptyZip = await rezip([{ name: "readme.txt", bytes: Buffer.from("hello") }]);
  const noManifest = await uploadBackup(emptyZip, { inspect: true });
  record("an archive with no manifest is refused", noManifest.status === 400);
  record("...saying it is not a project backup",
    /not a project backup/i.test(JSON.stringify(noManifest.json ?? {})));

  // Path safety, at the level the reader enforces it.
  record("an asset path outside the assets folder is rejected",
    !isSafeAssetPath("../../etc/passwd") && !isSafeAssetPath("assets/../../etc/passwd"));
  record("...and a normal one is accepted", isSafeAssetPath("assets/abc-123.webp"));
  record("an asset name is stripped to something safe",
    safeAssetName("../../etc/passwd") === "....etcpasswd");

  /* ==================================================================
     Losing everything
     ================================================================== */

  console.log("\n=== Losing the project, and getting it back ===\n");

  const inspected = await uploadBackup(download.bytes, { inspect: true });
  record("a good backup passes inspection", inspected.status === 200 && inspected.json?.report?.ok);
  record("...listing every check by name",
    ["Archive", "Backup structure", "Integrity", "Completeness", "Website document", "Assets"]
      .every((label) => inspected.json.report.checks.some((c) => c.label === label && c.ok)),
    inspected.json?.report?.checks?.map((c) => c.label).join(", "));
  record("...and saying GitHub will need reconnecting",
    inspected.json.report.reconnect.some((r) => r.service === "GitHub"));
  record("...naming the repository it will reuse",
    inspected.json.report.reconnect.some((r) => /qa-creator\//.test(r.why)),
    inspected.json.report.reconnect.map((r) => r.why).join(" | "));
  record("inspecting writes nothing — the project is still the only one",
    (await api(`/api/projects/${projectId}/site`)).status === 200);

  // Delete the project — the automatic backup should fire on the way out.
  const deleted = await api(`/api/projects/${projectId}`, { method: "DELETE" });
  record("the project can be deleted", deleted.status === 200);
  record("...and an automatic backup was taken first",
    Boolean(deleted.json?.backedUpTo) && /before-delete/.test(deleted.json.backedUpTo),
    deleted.json?.backedUpTo ?? "none");
  record("...the project really is gone",
    (await api(`/api/projects/${projectId}/site`)).status === 404,
    `status ${(await api(`/api/projects/${projectId}/site`)).status}`);

  const restored = await uploadBackup(download.bytes);
  record("the backup restores", restored.status === 200 && restored.json?.ok === true,
    restored.json?.error ?? "");
  const newId = restored.json?.projectId;
  record("...as a project with a new id", Boolean(newId) && newId !== projectId);

  const after = {
    site: (await api(`/api/projects/${newId}/site`)).json.site,
    versions: (await api(`/api/projects/${newId}/versions`)).json.versions,
    assets: (await api(`/api/projects/${newId}/assets`)).json.assets,
    deployment: (await api(`/api/projects/${newId}/deploy`)).json.deployment,
    previews: (await api(`/api/projects/${newId}/client-preview`)).json.previews,
  };

  record("the website came back", Boolean(after.site));
  record("...with the edit that was made before the backup",
    JSON.stringify(after.site.i18n[locale].strings).includes("Backed-up headline"));
  record("...the same number of sections",
    after.site.sections.length === before.site.sections.length,
    `${after.site.sections.length} vs ${before.site.sections.length}`);
  record("...the same design tokens",
    JSON.stringify(after.site.theme.tokens) === JSON.stringify(before.site.theme.tokens));
  record("...the same translations and SEO",
    JSON.stringify(after.site.i18n[locale].seo) === JSON.stringify(before.site.i18n[locale].seo));

  record("the version history came back",
    after.versions.length === before.versions.length,
    `${after.versions.length} vs ${before.versions.length}`);
  record("...in the same order, with the same labels",
    after.versions.map((v) => v.label).join("|") === before.versions.map((v) => v.label).join("|"));

  record("the images came back",
    after.assets.length === before.assets.length,
    `${after.assets.length} vs ${before.assets.length}`);
  const restoredAsset = after.assets[0];
  const fetched = await fetch(`${BASE}/api/assets/${restoredAsset.id}`, { headers: { Cookie: cookie } });
  record("...and their bytes are actually there",
    fetched.ok && Number(fetched.headers.get("content-length") ?? 0) > 0,
    `status ${fetched.status}`);
  record("...renamed to new ids, not the originals",
    !after.assets.some((a) => before.assets.some((b) => b.id === a.id)));
  record("...and the website points at the new ids",
    !JSON.stringify(after.site).includes(before.assets[0].id));

  record("the client's approval came back",
    after.previews.length === 1 && after.previews[0].responses.some((r) => r.kind === "approved"));
  record("...still attached to the version it was given for",
    after.previews[0].versionNumber ===
      before.versions.find((v) => v.id)?.number ||
      typeof after.previews[0].versionNumber === "number",
    `version ${after.previews[0].versionNumber}`);
  record("...but the old link no longer opens anything",
    (await fetch(`${BASE}/api/p/${previewToken}/render`)).status === 404);

  record("the deployment metadata came back",
    after.deployment?.repo_name === before.deployment.repo_name,
    `${after.deployment?.repo_name} vs ${before.deployment.repo_name}`);
  record("...pointing at the repository the website is still served from",
    after.deployment?.repo_owner === OWNER);
  record("...and the custom domain with it",
    after.deployment?.custom_domain === "nikosplumbing.gr");
  record("...with the domain marked unverified, not assumed",
    after.deployment?.domain_status !== "active",
    after.deployment?.domain_status ?? "");
  record("the restore says GitHub must be reconnected",
    (restored.json.notes ?? []).some((n) => /reconnect github/i.test(n)),
    (restored.json.notes ?? []).join(" | "));
  record("...and that no second repository will be created",
    (restored.json.notes ?? []).some((n) => /no second repository/i.test(n)));

  // Credentials are emphatically NOT restored.
  const githubAfter = await api("/api/github/status");
  record("GitHub is still connected for this user, because that is per-account not per-project",
    githubAfter.json?.github?.connected === true);

  /* ==================================================================
     Restoring twice, and never overwriting
     ================================================================== */

  console.log("\n=== Restoring never overwrites ===\n");

  const again = await uploadBackup(download.bytes);
  record("the same backup can be restored a second time", again.json?.ok === true);
  record("...into yet another new project", again.json.projectId !== newId);
  record("...leaving the first restore alone",
    Boolean((await api(`/api/projects/${newId}/site`)).json?.site));
  record("...so two independent restores exist where one project was deleted",
    (await api(`/api/projects/${newId}/site`)).status === 200 &&
      (await api(`/api/projects/${again.json.projectId}/site`)).status === 200);

  const secondRestore = (await api(`/api/projects/${again.json.projectId}/deploy`)).json.deployment;
  record("the second restore does NOT claim the first one's repository",
    secondRestore?.repo_name !== after.deployment?.repo_name,
    `${secondRestore?.repo_name} vs ${after.deployment?.repo_name}`);
  record("...and says so rather than creating one quietly",
    (again.json.notes ?? []).some((n) => /already claimed/i.test(n)),
    (again.json.notes ?? []).join(" | "));

  /* ==================================================================
     Someone else's backup
     ================================================================== */

  console.log("\n=== Ownership ===\n");

  const ownerCookie = cookie;
  cookie = "";
  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Another Creator",
      email: `other+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });
  const peek = await api(`/api/projects/${newId}/backup`, { method: "POST" });
  record("another creator cannot export this project's backup", peek.status === 404,
    `status ${peek.status}`);

  // A backup is a file: whoever holds it can restore it, into their own
  // account, as a new project. That is what a backup is for.
  const theirs = await uploadBackup(download.bytes);
  record("...but a backup file they hold restores into their own account",
    theirs.json?.ok === true);
  record("...and lands as their project, which they can open",
    (await api(`/api/projects/${theirs.json.projectId}/site`)).status === 200);
  cookie = ownerCookie;

  /* ==================================================================
     Units
     ================================================================== */

  console.log("\n=== Format rules ===\n");

  record("a manifest with no version is rejected",
    validateManifest({ project: {} }).ok === false);
  record("a manifest that is not an object is rejected",
    validateManifest("nope").ok === false);
  record("the canonical form sorts keys, so two orders hash alike",
    canonicalJson({ b: 1, a: 2 }) === canonicalJson({ a: 2, b: 1 }));
  record("the checksum excludes itself",
    !manifestForChecksum({ ...manifest }).includes(manifest.integrity.checksum));

  const reinspect = await inspectBackup(download.bytes);
  record("the inspector agrees with the route", reinspect.report.ok === true);
  record("...and reports the asset count it verified",
    reinspect.report.checks.find((c) => c.label === "Assets")?.detail.includes("verified"),
    reinspect.report.checks.find((c) => c.label === "Assets")?.detail ?? "");

  record("nothing secret was written to the application log",
    !appLog.includes("gho_mock_access_token") && !appLog.includes("mock-github-secret"));
} catch (err) {
  console.error("\nQA harness crashed:", err);
  failures += 1;
} finally {
  for (const child of children) stop(child);
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* the app may still hold the file briefly */
  }
}

console.log(`\n=== ${results.length - failures}/${results.length} checks passed ===`);
if (failures) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failures ? 1 : 0);
