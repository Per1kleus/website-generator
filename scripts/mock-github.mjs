#!/usr/bin/env node
/**
 * A stand-in for GitHub's OAuth, Repositories, Git Data and Pages APIs.
 *
 * Real GitHub credentials are not available in CI, and "it will probably
 * work" is not verification. This implements the exact endpoints and response
 * shapes the application uses, so the OAuth exchange, repository creation,
 * blob/tree/commit/ref upload, Pages configuration and custom-domain settings
 * are all genuinely exercised rather than mocked at the function level.
 *
 * It also behaves like GitHub where that matters to the code under test:
 *
 *   - creating a repository that already exists is a 422, not a silent reuse
 *   - a brand-new repository has no branch ref at all, so the first commit
 *     has no parent and the second one does
 *   - a tree with no base_tree replaces the whole file set
 *   - `GET /pages` is a 404 until Pages is switched on
 *   - enabling Pages twice is a 409
 *   - HTTPS certificates do not exist immediately
 *
 * Failures can be provoked on demand through /__control, so the error paths
 * are tested against real responses rather than assumed.
 *
 *   node scripts/mock-github.mjs [port]
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const port = Number(process.argv[2] || 11730);

const LOGIN = "qa-creator";
const TOKEN = "gho_mock_access_token";

/** owner/name -> repository */
const repos = new Map();
/** owner/name -> { blobs, trees, commits, refs, pages } */
const git = new Map();
const codes = new Map();

/** Provoked failures: { path: /regex/, status, times } */
let faults = [];
/** Every call, so a test can assert what the app actually did. */
const calls = [];

const sha = (s) => createHash("sha1").update(s).digest("hex");

function send(res, status, body, headers = {}) {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function repoState(key) {
  if (!git.has(key)) {
    git.set(key, { blobs: new Map(), trees: new Map(), commits: new Map(), refs: new Map(), pages: null });
  }
  return git.get(key);
}

/** The files a commit contains, flattened from its tree. */
function filesOf(key, commitSha) {
  const state = repoState(key);
  const commit = state.commits.get(commitSha);
  if (!commit) return {};
  const tree = state.trees.get(commit.tree);
  if (!tree) return {};
  const out = {};
  for (const entry of tree.tree) {
    const blob = state.blobs.get(entry.sha);
    if (blob) out[entry.path] = Buffer.from(blob, "base64");
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = url.pathname;
  const method = req.method ?? "GET";
  const auth = req.headers.authorization ?? "";
  calls.push({ method, path: p });

  /* ------------------------------------------------ test control plane */

  if (p === "/__control") {
    const body = await readBody(req);
    if (body.reset) {
      repos.clear();
      git.clear();
      faults = [];
      calls.length = 0;
    }
    if (Array.isArray(body.faults)) {
      faults = body.faults.map((f) => ({ ...f, times: f.times ?? 1 }));
    }
    // Make a repository public behind the app's back, so the next publish has
    // something real to notice and close again.
    if (body.makePublic) {
      const repo = repos.get(body.makePublic);
      if (repo) repo.private = false;
    }
    // Hand a certificate to a domain, so the HTTPS step can be reached.
    if (body.certifyPages) {
      const state = repoState(body.certifyPages);
      if (state.pages) state.pages.https_certificate = { state: "approved" };
    }
    return send(res, 200, { ok: true });
  }

  if (p === "/__state") {
    const key = url.searchParams.get("repo") ?? "";
    const state = git.get(key);
    const head = state?.refs.get("refs/heads/main");
    return send(res, 200, {
      repo: repos.get(key) ?? null,
      pages: state?.pages ?? null,
      commits: state ? [...state.commits.keys()].length : 0,
      head: head ?? null,
      files: head ? Object.keys(filesOf(key, head)) : [],
      calls: calls.length,
      created: calls.filter((c) => c.method === "POST" && c.path === "/user/repos").length,
    });
  }

  // One published file's bytes, so a test can prove the site really uploaded.
  if (p === "/__file") {
    const key = url.searchParams.get("repo") ?? "";
    const want = url.searchParams.get("path") ?? "";
    const head = repoState(key).refs.get("refs/heads/main");
    const files = head ? filesOf(key, head) : {};
    if (!files[want]) return send(res, 404, { message: "Not Found" });
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end(files[want]);
  }

  /* ---------------------------------------------------- provoked faults */

  const fault = faults.find((f) => new RegExp(f.path).test(p) && f.times > 0);
  if (fault) {
    fault.times -= 1;
    return send(
      res,
      fault.status,
      { message: fault.message ?? "Provoked failure" },
      fault.status === 403 && fault.rateLimit ? { "x-ratelimit-remaining": "0" } : {},
    );
  }

  /* ------------------------------------------------------------- oauth */

  if (p === "/login/oauth/authorize") {
    const state = url.searchParams.get("state") ?? "";
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const scope = url.searchParams.get("scope") ?? "";
    const code = `code_${Math.random().toString(36).slice(2)}`;
    codes.set(code, { scope });
    const back = new URL(redirect);
    back.searchParams.set("code", code);
    back.searchParams.set("state", state);
    res.writeHead(302, { Location: back.toString() });
    return res.end();
  }

  if (p === "/login/oauth/access_token" && method === "POST") {
    const body = await readBody(req);
    const entry = codes.get(body.code);
    if (!entry) return send(res, 200, { error: "bad_verification_code" });
    codes.delete(body.code);
    return send(res, 200, {
      access_token: TOKEN,
      token_type: "bearer",
      // Echo what was asked for, so a narrowed scope really is narrowed.
      scope: entry.scope || "repo",
    });
  }

  /* --------------------------------------------------- authorised area */

  if (!/^Bearer\s+\S+/.test(auth)) {
    return send(res, 401, { message: "Requires authentication" });
  }

  if (p === "/user") return send(res, 200, { login: LOGIN, id: 1 });

  if (p === "/user/repos" && method === "POST") {
    const body = await readBody(req);
    const key = `${LOGIN}/${body.name}`;
    if (repos.get(key)) {
      return send(res, 422, { message: "Repository creation failed: name already exists" });
    }
    const repo = {
      name: body.name,
      owner: { login: LOGIN },
      // GitHub honours what was asked for; the app always asks for private.
      private: body.private !== false,
      html_url: `https://github.com/${key}`,
      default_branch: "main",
    };
    repos.set(key, repo);
    repoState(key);
    return send(res, 201, repo);
  }

  const repoMatch = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (repoMatch) {
    const [, owner, name, rest = ""] = repoMatch;
    const key = `${owner}/${name}`;
    const repo = repos.get(key);
    if (!repo) return send(res, 404, { message: "Not Found" });
    const state = repoState(key);

    if (rest === "" && method === "GET") return send(res, 200, repo);

    if (rest === "" && method === "PATCH") {
      const body = await readBody(req);
      if (typeof body.private === "boolean") repo.private = body.private;
      return send(res, 200, repo);
    }

    /* ------------------------------------------------------ git data */

    if (rest === "/git/blobs" && method === "POST") {
      const body = await readBody(req);
      const id = sha(`blob:${body.content}`);
      state.blobs.set(id, body.content);
      return send(res, 201, { sha: id });
    }

    if (rest === "/git/trees" && method === "POST") {
      const body = await readBody(req);
      const id = sha(`tree:${JSON.stringify(body.tree)}`);
      state.trees.set(id, { tree: body.tree });
      return send(res, 201, { sha: id });
    }

    if (rest === "/git/commits" && method === "POST") {
      const body = await readBody(req);
      const id = sha(`commit:${body.tree}:${(body.parents ?? []).join(",")}:${Date.now()}:${Math.random()}`);
      state.commits.set(id, { tree: body.tree, parents: body.parents ?? [], message: body.message });
      return send(res, 201, { sha: id });
    }

    const refGet = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (refGet && method === "GET") {
      const ref = `refs/heads/${refGet[1]}`;
      const current = state.refs.get(ref);
      if (!current) return send(res, 404, { message: "Not Found" });
      return send(res, 200, { ref, object: { sha: current } });
    }

    if (rest === "/git/refs" && method === "POST") {
      const body = await readBody(req);
      if (state.refs.has(body.ref)) {
        return send(res, 422, { message: "Reference already exists" });
      }
      state.refs.set(body.ref, body.sha);
      return send(res, 201, { ref: body.ref, object: { sha: body.sha } });
    }

    const refPatch = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (refPatch && method === "PATCH") {
      const body = await readBody(req);
      const ref = `refs/heads/${refPatch[1]}`;
      if (!state.refs.has(ref)) return send(res, 422, { message: "Reference does not exist" });
      state.refs.set(ref, body.sha);
      return send(res, 200, { ref, object: { sha: body.sha } });
    }

    /* --------------------------------------------------------- pages */

    if (rest === "/pages") {
      if (method === "GET") {
        if (!state.pages) return send(res, 404, { message: "Not Found" });
        return send(res, 200, state.pages);
      }
      if (method === "POST") {
        if (state.pages) return send(res, 409, { message: "Pages is already enabled" });
        const body = await readBody(req);
        state.pages = {
          status: "building",
          html_url: `https://${owner.toLowerCase()}.github.io/${name}/`,
          cname: null,
          https_enforced: false,
          https_certificate: undefined,
          source: body.source ?? { branch: "main", path: "/" },
        };
        return send(res, 201, state.pages);
      }
      if (method === "PUT") {
        if (!state.pages) return send(res, 404, { message: "Not Found" });
        const body = await readBody(req);
        if ("cname" in body) {
          state.pages.cname = body.cname || null;
          // GitHub starts issuing a certificate when a domain is set, and it
          // is not ready straight away.
          state.pages.https_certificate = body.cname ? { state: "new" } : undefined;
          state.pages.https_enforced = false;
        }
        if (body.https_enforced === true) {
          if (state.pages.https_certificate?.state !== "approved") {
            return send(res, 422, { message: "HTTPS certificate is not ready" });
          }
          state.pages.https_enforced = true;
        }
        return send(res, 204, null);
      }
      if (method === "DELETE") {
        state.pages = null;
        return send(res, 204, null);
      }
    }

    return send(res, 404, { message: "Not Found" });
  }

  send(res, 404, { message: "Not Found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock github on http://127.0.0.1:${port}`);
});
