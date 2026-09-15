#!/usr/bin/env node
/**
 * GitHub Pages publishing: the whole documented flow, end to end.
 *
 *   connect GitHub -> publish -> private repository created -> files committed
 *   -> Pages enabled -> republish updates the same repository -> rollback
 *   -> unpublish -> republish -> custom domain -> DNS -> HTTPS
 *
 * Three stand-ins, none of them a stub of the application's own code:
 *
 *   scripts/mock-github.mjs  GitHub's OAuth, Repositories, Git Data and Pages
 *                            APIs, with the behaviours that matter — a 422 on
 *                            a duplicate repository, no ref on a fresh one, a
 *                            409 on enabling Pages twice, certificates that
 *                            are not instant.
 *   scripts/mock-dns.mjs     a real authoritative DNS server, so every domain
 *                            state comes from a real lookup.
 *   the application itself    started as it is in production.
 *
 * What is deliberately not simulated is a valid TLS certificate for a domain
 * this machine does not own, which is why the last domain state is reached
 * through `domainState`'s probe parameter and reported as such.
 *
 *   node --import tsx --conditions react-server scripts/github-qa.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Set before the module is imported: the resolver reads it when it is built.
process.env.WG_DNS_SERVERS = `127.0.0.1:${11755}`;
const { domainState, httpsWorks } = await import("../src/server/github/domain.ts");
const { checkDomain, requiredRecords } = await import("../src/lib/domain.ts");
const { repoNameFor } = await import("../src/server/providers/github.ts");

const APP_PORT = 3318;
const GH_PORT = 11731;
const DNS_PORT = 11755;
const DNS_CONTROL = 11756;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const GH = `http://127.0.0.1:${GH_PORT}`;
const DNS_API = `http://127.0.0.1:${DNS_CONTROL}`;

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

/* Everything the application writes to its own log, so "no credential is ever
   logged" is checked against what was actually logged rather than hoped. */
let appLog = "";

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
    /* html or a redirect body */
  }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

const ghControl = (body) =>
  fetch(`${GH}/__control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const ghState = (repo) => fetch(`${GH}/__state?repo=${encodeURIComponent(repo)}`).then((r) => r.json());
const ghFile = (repo, file) =>
  fetch(`${GH}/__file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(file)}`).then(
    async (r) => (r.ok ? r.text() : null),
  );
const dnsControl = (body) =>
  fetch(DNS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

/** Publish, then wait for the deployment to settle. */
async function publish(projectId, platform = "github") {
  const started = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  });
  if (started.status !== 200) return { started, final: null };
  const final = await waitFor(async () => {
    const st = await api(`/api/projects/${projectId}/deploy`);
    const d = st.json?.deployment;
    return d && (d.status === "live" || d.status === "failed") ? st.json : null;
  }, { timeout: 90000 });
  return { started, final };
}

const dataDir = mkdtempSync(path.join(tmpdir(), "wg-github-"));
const OWNER = "qa-creator";

try {
  const gh = spawnChild("node", ["scripts/mock-github.mjs", String(GH_PORT)], {});
  const dns = spawnChild(
    "node",
    ["scripts/mock-dns.mjs", String(DNS_PORT), String(DNS_CONTROL)],
    {},
  );
  await waitFor(async () => {
    try {
      return (await fetch(`${GH}/__state?repo=x`)).ok;
    } catch {
      return false;
    }
  });
  await waitFor(async () => {
    try {
      return (await fetch(DNS_API, { method: "POST", body: "{}" })).ok;
    } catch {
      return false;
    }
  });

  const app = spawnChild("npx", ["next", "start", "-p", String(APP_PORT)], {
    WG_DATA_DIR: dataDir,
    WG_SECRET: "github-qa-secret",
    GITHUB_CLIENT_ID: "mock-github-client",
    GITHUB_CLIENT_SECRET: "mock-github-secret",
    GITHUB_API_BASE: GH,
    GITHUB_WEB_BASE: GH,
    WG_DNS_SERVERS: `127.0.0.1:${DNS_PORT}`,
    /* Deliberately left set to something that would work if the application
       read it. A bare GITHUB_TOKEN is exported by GitHub Actions on every
       run and by the gh CLI; treating it as permission to publish client
       websites to somebody's account would be a serious surprise, and the
       first assertion below is that it is ignored. */
    GITHUB_TOKEN: "gho_a_token_from_some_other_tool",
    GH_TOKEN: "gho_a_token_from_some_other_tool",
    WG_GITHUB_TOKEN: "",
    WG_OLLAMA_AUTOPULL: "0",
    OLLAMA_HOST: "http://127.0.0.1:1",
  });
  const capture = (d) => {
    appLog += String(d);
  };
  app.stdout.on("data", capture);
  app.stderr.on("data", capture);

  const up = await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/login`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 90000 });
  if (!up) throw new Error("app did not start");

  /* ==================================================================
     Authentication
     ================================================================== */

  console.log("\n=== Connecting GitHub ===\n");

  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "GitHub QA",
      email: `gh+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });

  const before = await api("/api/github/status");
  record("GitHub starts disconnected", before.json?.github?.connected === false);
  record("...even though a GITHUB_TOKEN from another tool is in the environment",
    before.json?.github?.via === "none", before.json?.github?.via ?? "");
  record("...and says the server is configured for it",
    before.json?.github?.configured === true);
  record("...and returns nothing that resembles a token",
    !/token|gho_|ghp_/i.test(JSON.stringify(before.json ?? {})),
    JSON.stringify(before.json?.github ?? {}));

  const project = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: "Kafeneio Petros",
      businessType: "cafe",
      location: "Thessaloniki",
      description: "A neighbourhood cafe serving coffee and small plates.",
      siteKind: "business",
      style: "warm",
      defaultLocale: "en",
      locales: ["en"],
    }),
  });
  const projectId = project.json?.project?.id;
  record("a project is created", Boolean(projectId));

  await api(`/api/projects/${projectId}/generate`, { method: "POST" });
  const generated = await waitFor(async () => {
    const site = await api(`/api/projects/${projectId}/site`);
    return site.json?.site ? site.json.site : null;
  }, { timeout: 240000 });
  record("a website is generated to publish", Boolean(generated));

  // Publishing to GitHub before connecting must be refused, in words that say
  // what to do — not "403".
  const refused = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "github" }),
  });
  record("publishing to GitHub without connecting is refused", refused.status === 400);
  record("...with an instruction rather than a status code",
    /connect a github account/i.test(refused.json?.error ?? ""),
    refused.json?.error ?? "");

  // The real OAuth round trip, through the mock's authorize + token endpoints.
  const connect = await api("/api/github/connect?returnTo=%2Fprojects");
  record("connecting redirects to GitHub", connect.status === 307 || connect.status === 302);
  const consentUrl = new URL(connect.location);
  record("...asking only for the repo scope",
    consentUrl.searchParams.get("scope") === "repo",
    consentUrl.searchParams.get("scope") ?? "");
  record("...and carrying a state value", Boolean(consentUrl.searchParams.get("state")));

  const consent = await fetch(consentUrl.toString(), { redirect: "manual" });
  const callbackUrl = new URL(consent.headers.get("location"));
  const callback = await api(`${callbackUrl.pathname}${callbackUrl.search}`);
  record("the callback completes the connection",
    (callback.location ?? "").includes("github=connected"),
    callback.location ?? "");

  const after = await api("/api/github/status");
  record("GitHub is now connected", after.json?.github?.connected === true);
  record("...as the account GitHub named", after.json?.github?.login === OWNER,
    after.json?.github?.login ?? "");
  record("...through OAuth rather than a server-wide token",
    after.json?.github?.via === "oauth");

  // A forged callback must not attach an account.
  const forged = await api("/api/github/callback?code=whatever&state=not-the-one");
  record("a forged callback is rejected", (forged.location ?? "").includes("github=state"),
    forged.location ?? "");

  /* ==================================================================
     First publish
     ================================================================== */

  console.log("\n=== Publishing to GitHub Pages ===\n");

  const repo = repoNameFor("kafeneio-petros");
  const repoKey = `${OWNER}/${repo}`;

  const first = await publish(projectId);
  record("publishing is accepted", first.started.status === 200,
    `status ${first.started.status} ${(first.started.text ?? "").slice(0, 160)}`);
  const live = first.final?.deployment;
  record("the deployment reaches live", live?.status === "live",
    live?.status ?? "none", );
  record("...with no error", !live?.error, live?.error ?? "");

  const state = await ghState(repoKey);
  record("a repository was created", Boolean(state.repo), JSON.stringify(state.repo ?? {}));
  record("...named after the project", state.repo?.name === repo, state.repo?.name ?? "");
  record("...and it is private", state.repo?.private === true);
  record("...created exactly once", state.created === 1, String(state.created));

  record("the website was committed", state.files.length > 0, `${state.files.length} files`);
  record("...including the default-language page", state.files.includes("en/index.html"));
  record("...the root redirect", state.files.includes("index.html"));
  record("...the sitemap and robots", state.files.includes("sitemap.xml") && state.files.includes("robots.txt"));

  record("GitHub Pages was switched on", Boolean(state.pages));
  record("...serving the repository root",
    state.pages?.source?.path === "/" && state.pages?.source?.branch === "main");

  record("the live URL is the GitHub Pages address",
    live?.url === `https://${OWNER.toLowerCase()}.github.io/${repo}/`, live?.url ?? "");
  record("the deployment records the repository", live?.repo_name === repo);
  record("...as private", live?.repo_private === 1);
  record("...and which version went live", Boolean(live?.version_id));

  // The published page must be a real page, and must be self-contained.
  const page = await ghFile(repoKey, "en/index.html");
  record("the committed page is a real document",
    Boolean(page) && page.includes("<main") && page.length > 500, `${page?.length ?? 0} bytes`);
  record("...and points at itself, not at this application",
    Boolean(page) && page.includes(`${OWNER.toLowerCase()}.github.io/${repo}`) &&
      !page.includes(`127.0.0.1:${APP_PORT}`));
  record("...with no reference to the builder's API",
    Boolean(page) && !page.includes("/api/projects/") && !page.includes("/api/assets/"));

  /* ==================================================================
     Republishing
     ================================================================== */

  console.log("\n=== Republishing ===\n");

  const beforeSecond = await ghState(repoKey);
  const unchanged = await api(`/api/projects/${projectId}/deploy`);
  record("an unchanged website reports no pending changes",
    unchanged.json?.hasChanges === false);

  // Change something visible, then publish again.
  const site = (await api(`/api/projects/${projectId}/site`)).json.site;
  const locale = site.meta.defaultLocale;
  const heroKey = Object.keys(site.i18n[locale].strings).find((k) => k.endsWith(".headline"));
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
            strings: { ...site.i18n[locale].strings, [heroKey]: "Second publish marker" },
          },
        },
      },
    }),
  });
  const changed = await api(`/api/projects/${projectId}/deploy`);
  record("editing a published website is reported as changes not yet published",
    changed.json?.hasChanges === true);

  const second = await publish(projectId);
  record("publishing changes is accepted", second.started.status === 200);
  record("...and reaches live", second.final?.deployment?.status === "live");

  const afterSecond = await ghState(repoKey);
  record("no second repository was created", afterSecond.created === 1, String(afterSecond.created));
  record("...the same repository moved forward", afterSecond.head !== beforeSecond.head);
  const updated = await ghFile(repoKey, "en/index.html");
  record("...and the change is in the committed website",
    Boolean(updated) && updated.includes("Second publish marker"));
  record("the address a client was given has not moved",
    second.final?.deployment?.url === live?.url, second.final?.deployment?.url ?? "");
  record("...and there are no pending changes any more",
    second.final?.hasChanges === false);

  /* Publishing must leave the version history — and anything a client is
     looking at — exactly as it found it. Deployment records which version is
     public; it is not itself an edit. */
  {
    const shared = await api(`/api/projects/${projectId}/client-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create" }),
    });
    const token = shared.json?.preview?.id;
    const pinned = shared.json?.previews?.[0]?.versionNumber;
    const beforeHtml = await (await fetch(`${BASE}/api/p/${token}/render`)).text();
    const versionsBefore = (await api(`/api/projects/${projectId}/versions`)).json.versions.length;

    await publish(projectId);

    const versionsAfter = (await api(`/api/projects/${projectId}/versions`)).json.versions.length;
    record("publishing creates no new version", versionsAfter === versionsBefore,
      `${versionsBefore} -> ${versionsAfter}`);
    const rows = (await api(`/api/projects/${projectId}/client-preview`)).json.previews;
    record("...and does not move a client's pinned version",
      rows.find((r) => r.id === token)?.versionNumber === pinned);
    const afterHtml = await (await fetch(`${BASE}/api/p/${token}/render`)).text();
    record("...so the client still sees exactly what they were sent",
      afterHtml === beforeHtml);
  }

  /* ==================================================================
     Rollback
     ================================================================== */

  console.log("\n=== Publishing a rollback ===\n");

  const versions = (await api(`/api/projects/${projectId}/versions`)).json.versions;
  // The oldest version predates the marker, so rolling back to it and
  // publishing must take the marker off the live website.
  const oldest = versions[versions.length - 1];
  const restored = await api(`/api/projects/${projectId}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restore", versionId: oldest.id }),
  });
  record("an older version can be restored", restored.status === 200,
    `status ${restored.status}`);

  const third = await publish(projectId);
  record("the restored version publishes", third.final?.deployment?.status === "live");
  const rolledBack = await ghFile(repoKey, "en/index.html");
  record("...and the live website really went back",
    Boolean(rolledBack) && !rolledBack.includes("Second publish marker"));
  const afterThird = await ghState(repoKey);
  record("...through the same repository", afterThird.created === 1);
  record("...recorded against a version of this project",
    Boolean(third.final?.deployment?.version_id));

  /* ==================================================================
     Private repositories
     ================================================================== */

  console.log("\n=== The repository stays private ===\n");

  await ghControl({ makePublic: repoKey });
  const madePublic = await ghState(repoKey);
  record("a repository made public on GitHub is noticed",
    madePublic.repo?.private === false);

  await publish(projectId);
  const reclosed = await ghState(repoKey);
  record("...and the next publish closes it again", reclosed.repo?.private === true);

  /* ==================================================================
     Unpublish and republish
     ================================================================== */

  console.log("\n=== Unpublishing ===\n");

  const down = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "unpublish" }),
  });
  record("the website can be taken down", down.status === 200 && down.json?.ok === true);
  const afterDown = await ghState(repoKey);
  record("...GitHub Pages is switched off", afterDown.pages === null);
  record("...the repository is NOT deleted", Boolean(afterDown.repo));
  record("...and neither is its content", afterDown.files.length > 0,
    `${afterDown.files.length} files`);
  record("...the project remembers it was published",
    (down.json?.deployment?.published_at ?? 0) > 0 &&
      down.json?.deployment?.status === "unpublished");

  const back = await publish(projectId);
  record("it can be published again", back.final?.deployment?.status === "live");
  const afterBack = await ghState(repoKey);
  record("...into the same repository", afterBack.created === 1);
  record("...with Pages switched back on", Boolean(afterBack.pages));
  record("...at the same address", back.final?.deployment?.url === live?.url);

  /* ==================================================================
     Custom domains
     ================================================================== */

  console.log("\n=== Custom domains ===\n");

  const DOMAIN = "clientbusiness.test";

  for (const [input, why] of [
    ["not a domain", "no dot"],
    ["exam ple.gr", "a space"],
    ["../../etc/passwd", "a path"],
    ["example.gr; rm -rf /", "a shell command"],
    ["<script>alert(1)</script>.gr", "markup"],
    ["evil.com/../x", "traversal"],
    ["user@example.gr", "an @"],
    ["example.github.io", "a GitHub address"],
  ]) {
    const res = await api(`/api/projects/${projectId}/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "connect-domain", domain: input }),
    });
    record(`a domain containing ${why} is refused`, res.status === 400,
      `${JSON.stringify(input)} -> ${res.status}`);
  }

  // Nothing resolves yet, so the honest state is "create these records".
  const connected = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: DOMAIN }),
  });
  record("a valid domain is accepted", connected.status === 200,
    `status ${connected.status} ${(connected.text ?? "").slice(0, 160)}`);
  record("...and the domain is recorded",
    connected.json?.deployment?.custom_domain === DOMAIN);
  record("...with DNS not yet done",
    connected.json?.deployment?.domain_status === "dns-required",
    connected.json?.deployment?.domain_status ?? "");
  record("...and the exact records to create are supplied",
    (connected.json?.records ?? []).length === 4 &&
      connected.json.records.every((r) => r.type === "A"),
    JSON.stringify(connected.json?.records ?? []));

  // Pointing somewhere else is a different state from pointing nowhere.
  await dnsControl({ set: { [DOMAIN]: { a: ["203.0.113.10"] } } });
  const elsewhere = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check-domain" }),
  });
  record("a domain pointing elsewhere is 'waiting for DNS'",
    elsewhere.json?.deployment?.domain_status === "waiting-dns",
    elsewhere.json?.deployment?.domain_status ?? "");
  record("...and says what it currently points at",
    /203\.0\.113\.10/.test(elsewhere.json?.deployment?.domain_error ?? ""),
    elsewhere.json?.deployment?.domain_error ?? "");

  // Now point it at GitHub Pages for real.
  await dnsControl({ set: { [DOMAIN]: { a: ["185.199.108.153", "185.199.109.153"] } } });
  const detected = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check-domain" }),
  });
  record("correct DNS is detected",
    ["dns-detected", "https-pending"].includes(detected.json?.deployment?.domain_status),
    detected.json?.deployment?.domain_status ?? "");
  record("...from the real lookup, not from what was typed",
    (detected.json?.dns?.aRecords ?? []).includes("185.199.108.153"),
    JSON.stringify(detected.json?.dns ?? {}));

  // Publishing writes the CNAME file and tells GitHub.
  const withDomain = await publish(projectId);
  record("publishing with a domain connected succeeds",
    withDomain.final?.deployment?.status === "live");
  const cnameFile = await ghFile(repoKey, "CNAME");
  record("...a CNAME file is committed, so the next commit cannot drop it",
    (cnameFile ?? "").trim() === DOMAIN, JSON.stringify(cnameFile));
  const pagesState = await ghState(repoKey);
  record("...and GitHub Pages is told about the domain",
    pagesState.pages?.cname === DOMAIN, pagesState.pages?.cname ?? "");

  const pending = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check-domain" }),
  });
  record("with DNS right and no certificate yet, the state is 'HTTPS pending'",
    pending.json?.deployment?.domain_status === "https-pending",
    pending.json?.deployment?.domain_status ?? "");
  record("...and it says so in words, with what GitHub reported",
    /certificate/i.test(pending.json?.deployment?.domain_error ?? ""),
    pending.json?.deployment?.domain_error ?? "");

  /* The last state needs a valid certificate for a domain this machine does
     not own, which no test environment can produce. The logic is exercised
     through `domainState`'s probe, and the real probe is checked separately
     to confirm it answers "no" for a domain that is not served. */
  const reallyNoHttps = await httpsWorks(DOMAIN);
  record("the real HTTPS probe says no for a domain that is not served",
    reallyNoHttps === false);
  const activeState = await domainState({
    domain: DOMAIN,
    pagesHost: `${OWNER}.github.io`,
    configuredCname: DOMAIN,
    httpsState: "approved",
    probe: async () => true,
  });
  record("once HTTPS answers, the domain is active",
    activeState.state === "active", activeState.state);

  // Changing the domain.
  const SECOND_DOMAIN = "www.clientbusiness.test";
  await dnsControl({ set: { [SECOND_DOMAIN]: { cname: [`${OWNER}.github.io`] } } });
  const changedDomain = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: SECOND_DOMAIN }),
  });
  record("the domain can be changed",
    changedDomain.json?.deployment?.custom_domain === SECOND_DOMAIN,
    changedDomain.json?.deployment?.custom_domain ?? "");
  record("...and a subdomain is told to use a CNAME, not four A records",
    (changedDomain.json?.records ?? []).length === 1 &&
      changedDomain.json.records[0].type === "CNAME" &&
      changedDomain.json.records[0].value === `${OWNER}.github.io`,
    JSON.stringify(changedDomain.json?.records ?? []));

  // Removing it.
  const removed = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "disconnect-domain" }),
  });
  record("the domain can be removed", removed.status === 200);
  record("...leaving no domain on the project",
    removed.json?.deployment?.custom_domain === "");
  record("...and the website back on its GitHub Pages address",
    (removed.json?.deployment?.url ?? "").includes("github.io"),
    removed.json?.deployment?.url ?? "");
  const afterRemoval = await ghState(repoKey);
  record("...with GitHub told to stop using it", !afterRemoval.pages?.cname);
  record("...and the repository untouched", Boolean(afterRemoval.repo));

  /* ==================================================================
     Failure handling
     ================================================================== */

  console.log("\n=== Failures say what to do ===\n");

  const failures_ = [
    { path: "/user/repos", status: 403, expect: /permission to create private repositories/i,
      label: "no permission to create a private repository" },
    { path: "/git/blobs", status: 401, expect: /connect github again/i,
      label: "an expired connection" },
    { path: "/git/blobs", status: 403, rateLimit: true, expect: /rate-limiting/i,
      label: "a rate limit" },
    { path: "/repos/.*/pages", status: 403, expect: /pages/i,
      label: "no permission for Pages" },
    { path: "/git/trees", status: 500, expect: /github is having trouble/i,
      label: "GitHub being down" },
  ];

  for (const f of failures_) {
    // A fresh project each time, so a provoked failure cannot be absorbed by
    // work an earlier publish already did.
    const p = await api("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessName: `Failure ${f.status} ${f.label.slice(0, 8)}`,
        businessType: "shop", location: "Athens",
        description: "A small shop used to provoke one GitHub failure.",
        siteKind: "business", style: "warm", defaultLocale: "en", locales: ["en"],
      }),
    });
    const pid = p.json?.project?.id;
    await api(`/api/projects/${pid}/generate`, { method: "POST" });
    await waitFor(async () => (await api(`/api/projects/${pid}/site`)).json?.site, { timeout: 240000 });

    await ghControl({ faults: [{ path: f.path, status: f.status, times: 20, rateLimit: f.rateLimit }] });
    const attempt = await publish(pid);
    await ghControl({ faults: [] });

    const deployment = attempt.final?.deployment;
    record(`${f.label}: the deployment fails rather than claiming success`,
      deployment?.status === "failed", deployment?.status ?? "none");
    record(`${f.label}: the message says what to do`,
      f.expect.test(deployment?.error ?? ""), (deployment?.error ?? "").slice(0, 120));
    record(`${f.label}: GitHub's own wording is not shown`,
      !/HTTP \d|Validation Failed|Provoked failure/i.test(deployment?.error ?? ""),
      (deployment?.error ?? "").slice(0, 80));
  }

  /* ==================================================================
     Security
     ================================================================== */

  console.log("\n=== Security ===\n");

  const TOKEN = "gho_mock_access_token";

  // Nothing the browser can fetch may carry the token.
  const deployGet = await api(`/api/projects/${projectId}/deploy`);
  const statusGet = await api("/api/github/status");
  const projectGet = await api(`/api/projects/${projectId}`);
  const bodies = [deployGet.text, statusGet.text, projectGet.text, connected.text, removed.text];
  record("no API response contains the GitHub token",
    bodies.every((b) => !(b ?? "").includes(TOKEN)));
  record("...or anything that looks like one",
    bodies.every((b) => !/gh[pousr]_[A-Za-z0-9]/.test(b ?? "")));
  record("...or the client secret",
    bodies.every((b) => !(b ?? "").includes("mock-github-secret")));

  // Nor the published website.
  const committedFiles = (await ghState(repoKey)).files;
  let leaked = "";
  for (const name of committedFiles) {
    const content = await ghFile(repoKey, name);
    if (content && (content.includes(TOKEN) || content.includes("mock-github-secret"))) {
      leaked = name;
      break;
    }
  }
  record("no published file contains a credential", leaked === "", leaked);

  // Nor the application's own log.
  record("the token never appears in the application log", !appLog.includes(TOKEN));
  record("...and neither does the client secret", !appLog.includes("mock-github-secret"));
  record("...while failures WERE logged, so this is not silence",
    /\[github\]/.test(appLog));

  // The database stores it encrypted, not in the clear.
  const { readFileSync } = await import("node:fs");
  const dbBytes = readFileSync(path.join(dataDir, "app.db"));
  const walPath = path.join(dataDir, "app.db-wal");
  const walBytes = (() => {
    try {
      return readFileSync(walPath);
    } catch {
      return Buffer.alloc(0);
    }
  })();
  record("the token is not stored in the database in the clear",
    !dbBytes.includes(TOKEN) && !walBytes.includes(TOKEN));

  // Project isolation: a second creator cannot see or publish this project.
  const otherCookie = cookie;
  cookie = "";
  await api("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Someone Else",
      email: `other+${Date.now()}@example.com`,
      password: "supersecret123",
    }),
  });
  const peek = await api(`/api/projects/${projectId}/deploy`);
  record("another creator cannot read this project's deployment", peek.status === 404,
    `status ${peek.status}`);
  const hijack = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "github" }),
  });
  record("...nor publish it", hijack.status === 400 || hijack.status === 404,
    `status ${hijack.status}`);
  const reposBeforeHijack = (await ghState(repoKey)).created;
  const headBeforeHijack = (await ghState(repoKey)).head;
  const stealDomain = await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: "stolen.test" }),
  });
  record("...nor point a domain at it", stealDomain.status !== 200, `status ${stealDomain.status}`);
  const stateAfterHijack = await ghState(repoKey);
  record("...and nothing reached the repository",
    stateAfterHijack.created === reposBeforeHijack &&
      stateAfterHijack.head === headBeforeHijack &&
      !stateAfterHijack.pages?.cname,
    `${reposBeforeHijack} -> ${stateAfterHijack.created}`);
  cookie = otherCookie;

  // A repository name can only ever be a safe slug.
  for (const nasty of ["../../etc", "a/b", "..", "with space", "semi;colon", "$(whoami)"]) {
    const name = repoNameFor(nasty);
    record(`a repository name from ${JSON.stringify(nasty)} is safe`,
      /^[a-z0-9-]+$/.test(name) && !name.includes("..") && name.length > 0, name);
  }

  // A second project cannot land in the first project's repository: the slug
  // is unique per project, and the repository name comes from the slug.
  const rival = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessName: "Kafeneio Petros",
      businessType: "cafe", location: "Thessaloniki",
      description: "A different business that happens to share a name.",
      siteKind: "business", style: "warm", defaultLocale: "en", locales: ["en"],
    }),
  });
  const rivalId = rival.json?.project?.id;
  await api(`/api/projects/${rivalId}/generate`, { method: "POST" });
  await waitFor(async () => (await api(`/api/projects/${rivalId}/site`)).json?.site, { timeout: 240000 });
  const rivalPublish = await publish(rivalId);
  record("a second project with the same business name publishes separately",
    rivalPublish.final?.deployment?.status === "live",
    rivalPublish.final?.deployment?.status ?? "");
  record("...into its own repository",
    rivalPublish.final?.deployment?.repo_name !== repo,
    `${rivalPublish.final?.deployment?.repo_name} vs ${repo}`);
  const originalAfterRival = await ghFile(repoKey, "en/index.html");
  record("...leaving the first project's website untouched",
    Boolean(originalAfterRival) && !originalAfterRival.includes("A different business"));

  // One domain cannot be pointed at two projects.
  await api(`/api/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: "shared.test" }),
  });
  const clash = await api(`/api/projects/${rivalId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "connect-domain", domain: "shared.test" }),
  });
  record("a domain already used by another project is refused", clash.status === 400,
    clash.json?.error ?? "");

  /* ==================================================================
     Nothing else changed
     ================================================================== */

  console.log("\n=== Built-in hosting still works ===\n");

  const builtin = await publish(rivalId, "builtin");
  record("a project can still publish to built-in hosting",
    builtin.final?.deployment?.status === "live",
    builtin.final?.deployment?.status ?? "");
  record("...at this server's own address",
    (builtin.final?.deployment?.url ?? "").includes(`/s/`),
    builtin.final?.deployment?.url ?? "");
  const served = await fetch(`${builtin.final.deployment.url}en/`);
  const servedText = await served.text();
  record("...and it is actually served", served.status === 200 && servedText.includes("<main"));

  /* ==================================================================
     Units the flow cannot reach
     ================================================================== */

  console.log("\n=== Domain rules ===\n");

  record("a pasted URL is read as a domain",
    checkDomain("https://Example.GR/path")?.domain === "example.gr");
  record("an apex domain needs four A records",
    requiredRecords("example.gr", "x.github.io").length === 4);
  record("a subdomain needs one CNAME",
    requiredRecords("www.example.gr", "x.github.io").length === 1);
  record("an IP address is not a domain", checkDomain("185.199.108.153").ok === false);
  record("a single label is not a domain", checkDomain("localhost").ok === false);
  record("a 300-character name is refused", checkDomain(`${"a".repeat(300)}.gr`).ok === false);
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
