import "server-only";
import { tokenFor } from "./oauth";
import { githubErrorLine } from "@/lib/github-errors";

/**
 * One authorised request to GitHub.
 *
 * The same role `googleCall` plays for Sheets and Drive: every GitHub request
 * in the application goes through here, so there is exactly one place that
 * attaches a credential, one timeout, and one translation of GitHub's status
 * codes into something a person can act on.
 *
 * The token is fetched, used and dropped. It is never returned, never logged
 * — not even truncated, because a prefix of a token is still a piece of a
 * token — and never attached to anything that leaves the server.
 */

const GITHUB_API = process.env.GITHUB_API_BASE || "https://api.github.com";

export type GitHubStep = "auth" | "repo" | "upload" | "pages" | "domain";

export class GitHubError extends Error {
  constructor(
    /** Already translated: safe to show a creator. */
    message: string,
    readonly status: number,
    readonly step: GitHubStep,
    /** True when reconnecting the account would plausibly fix it. */
    readonly reauth: boolean = false,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Never let a URL be built from unvalidated input. */
function apiUrl(path: string): string {
  if (!path.startsWith("/")) throw new Error("GitHub API paths start with /");
  return `${GITHUB_API}${path}`;
}

export async function githubCall(
  userId: string,
  path: string,
  opts: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    step?: GitHubStep;
    /** Statuses the caller handles itself, rather than treating as failures. */
    allow?: number[];
  } = {},
): Promise<{ status: number; data: unknown }> {
  const step = opts.step ?? "repo";
  const token = tokenFor(userId);
  if (!token) {
    throw new GitHubError(
      "GitHub is not connected. Connect a GitHub account on the publishing screen to publish there.",
      401,
      step,
      true,
    );
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "website-generator",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      // GitHub is an external dependency inside a creator-initiated action.
      // Uploading a site of photographs is the slowest thing here, so the
      // budget is generous, but it is not unbounded.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new GitHubError(
      timedOut
        ? "GitHub did not answer in time. Nothing was left half-published — try again."
        : "GitHub could not be reached. Check the internet connection and try again.",
      0,
      step,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (res.ok || opts.allow?.includes(res.status)) {
    return { status: res.status, data };
  }

  /* GitHub's own message is logged, never shown.
     ------------------------------------------------------------------
     It is written for whoever wrote the API — "Validation Failed", a
     documentation URL, a list of field errors — and a creator can do nothing
     with it. What they get instead is the translated sentence plus the one
     action that would change the outcome. The path is logged too, because
     "which call failed" is the first thing anybody diagnosing this needs; the
     token is not, because it never appears outside the header above. */
  const detail =
    (data as { message?: string } | null)?.message ??
    (res.status === 0 ? "network" : `HTTP ${res.status}`);
  console.error(`[github] ${opts.method ?? "GET"} ${path} -> ${res.status}: ${detail}`);

  const rateLimited =
    res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(detail);

  throw new GitHubError(
    githubErrorLine(res.status, step, rateLimited ? "rate limit" : ""),
    res.status,
    step,
    res.status === 401,
  );
}

/* ------------------------------------------------------------ repositories */

export type Repo = {
  owner: string;
  name: string;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
};

type RepoPayload = {
  name?: string;
  private?: boolean;
  html_url?: string;
  default_branch?: string;
  owner?: { login?: string };
};

function toRepo(data: unknown): Repo {
  const r = (data ?? {}) as RepoPayload;
  return {
    owner: r.owner?.login ?? "",
    name: r.name ?? "",
    private: r.private !== false,
    htmlUrl: r.html_url ?? "",
    defaultBranch: r.default_branch || "main",
  };
}

export async function getRepo(userId: string, owner: string, name: string): Promise<Repo | null> {
  const { status, data } = await githubCall(
    userId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    { step: "repo", allow: [404] },
  );
  return status === 404 ? null : toRepo(data);
}

/**
 * Create the repository for a project, private.
 *
 * `private: true` is not a default that a later call could overwrite — it is
 * sent on creation, and `ensureRepo` re-asserts it on every publish. A client
 * website's repository holding their photographs, their prices and their
 * draft copy must never be world-readable because of a settings change
 * somebody made on GitHub.
 *
 * `auto_init: false` keeps the history clean: the first commit this
 * application makes is the website, not a README GitHub wrote.
 */
export async function createRepo(
  userId: string,
  name: string,
  description: string,
): Promise<Repo> {
  const { data } = await githubCall(userId, "/user/repos", {
    method: "POST",
    step: "repo",
    body: {
      name,
      description: description.slice(0, 350),
      private: true,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    },
  });
  return toRepo(data);
}

/** Force a repository back to private if it was made public elsewhere. */
export async function ensurePrivate(userId: string, owner: string, name: string): Promise<void> {
  await githubCall(userId, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
    method: "PATCH",
    step: "repo",
    body: { private: true },
  });
}

/* ------------------------------------------------------------- git objects */

/**
 * Publish a whole directory of files as one commit.
 *
 * The Contents API would mean one request per file and one visible
 * intermediate state per file: a visitor refreshing mid-publish would get a
 * page from the new version and an image from the old one. The Git Data API
 * builds the whole tree first and then moves the branch once, so the site
 * changes in a single step — the same property the built-in publisher gets
 * from renaming a directory.
 *
 * Deleting is implicit: the tree is built from the file list alone, with no
 * `base_tree`, so a file that is no longer in the bundle is no longer in the
 * commit. A photograph removed from a website actually leaves the repository.
 */
export type UploadFile = { path: string; bytes: Buffer };

export async function commitFiles(
  userId: string,
  repo: Repo,
  files: UploadFile[],
  message: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  // Blobs first. Base64 rather than utf-8 for every file, because a
  // photograph is not text and guessing per file by extension is how a binary
  // eventually gets corrupted.
  const tree: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  let done = 0;
  for (const file of files) {
    const { data } = await githubCall(userId, `${base}/git/blobs`, {
      method: "POST",
      step: "upload",
      body: { content: file.bytes.toString("base64"), encoding: "base64" },
    });
    tree.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: String((data as { sha?: string })?.sha ?? ""),
    });
    done += 1;
    onProgress?.(done, files.length);
  }

  const { data: treeData } = await githubCall(userId, `${base}/git/trees`, {
    method: "POST",
    step: "upload",
    body: { tree },
  });
  const treeSha = String((treeData as { sha?: string })?.sha ?? "");

  // The parent, when the branch already exists. A brand-new repository has no
  // ref at all, which is a 404 rather than an error.
  const branch = repo.defaultBranch;
  const { status: refStatus, data: refData } = await githubCall(
    userId,
    `${base}/git/ref/heads/${encodeURIComponent(branch)}`,
    { step: "upload", allow: [404, 409] },
  );
  const parent =
    refStatus === 200
      ? String((refData as { object?: { sha?: string } })?.object?.sha ?? "")
      : "";

  const { data: commitData } = await githubCall(userId, `${base}/git/commits`, {
    method: "POST",
    step: "upload",
    body: { message, tree: treeSha, parents: parent ? [parent] : [] },
  });
  const commitSha = String((commitData as { sha?: string })?.sha ?? "");

  if (parent) {
    await githubCall(userId, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: "PATCH",
      step: "upload",
      body: { sha: commitSha, force: true },
    });
  } else {
    await githubCall(userId, `${base}/git/refs`, {
      method: "POST",
      step: "upload",
      body: { ref: `refs/heads/${branch}`, sha: commitSha },
    });
  }

  return commitSha;
}

/* ----------------------------------------------------------- github pages */

export type PagesInfo = {
  enabled: boolean;
  /** GitHub's own word: "built", "building", "errored". */
  status: string;
  url: string;
  cname: string;
  /** Whether GitHub has issued a certificate for the custom domain. */
  httpsEnforced: boolean;
  httpsState: string;
};

type PagesPayload = {
  status?: string | null;
  html_url?: string;
  cname?: string | null;
  https_enforced?: boolean;
  https_certificate?: { state?: string };
};

function toPages(data: unknown): PagesInfo {
  const p = (data ?? {}) as PagesPayload;
  return {
    enabled: true,
    status: p.status ?? "",
    url: p.html_url ?? "",
    cname: p.cname ?? "",
    httpsEnforced: Boolean(p.https_enforced),
    httpsState: p.https_certificate?.state ?? "",
  };
}

export async function getPages(
  userId: string,
  owner: string,
  name: string,
): Promise<PagesInfo | null> {
  const { status, data } = await githubCall(
    userId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pages`,
    { step: "pages", allow: [404] },
  );
  return status === 404 ? null : toPages(data);
}

/**
 * Switch Pages on, serving the branch root.
 *
 * The bundle is a finished static site — that is the whole point of the
 * existing bundler — so there is no build step to configure and no Jekyll to
 * ask for. `build_type: "legacy"` with a branch source is GitHub serving the
 * files exactly as committed.
 */
export async function enablePages(
  userId: string,
  owner: string,
  name: string,
  branch: string,
): Promise<PagesInfo> {
  const { data } = await githubCall(
    userId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pages`,
    {
      method: "POST",
      step: "pages",
      body: { source: { branch, path: "/" }, build_type: "legacy" },
    },
  );
  return toPages(data);
}

/** Set, change or clear the Pages custom domain. */
export async function setPagesDomain(
  userId: string,
  owner: string,
  name: string,
  domain: string,
): Promise<void> {
  await githubCall(
    userId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pages`,
    { method: "PUT", step: "domain", body: { cname: domain || null } },
  );
}

/**
 * Ask GitHub to enforce HTTPS.
 *
 * Only possible once a certificate exists, which is why this is called on a
 * later poll rather than at the moment the domain is set, and why a refusal
 * here is not a failure — it means "not yet".
 */
export async function enforceHttps(
  userId: string,
  owner: string,
  name: string,
): Promise<boolean> {
  try {
    await githubCall(
      userId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pages`,
      { method: "PUT", step: "domain", body: { https_enforced: true } },
    );
    return true;
  } catch {
    return false;
  }
}

/** Turn the public website off without touching the repository. */
export async function disablePages(userId: string, owner: string, name: string): Promise<void> {
  await githubCall(
    userId,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pages`,
    { method: "DELETE", step: "pages", allow: [404, 204] },
  );
}
