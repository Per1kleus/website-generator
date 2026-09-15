/**
 * What a GitHub failure means, in the creator's language.
 *
 * Exactly the same principle as `lib/google-errors.ts`: GitHub answers in
 * terms that are meaningful to whoever wrote the API and to nobody else —
 * `422 Unprocessable Entity`, `403`, `name already exists on this account`.
 * A creator reading "GitHub API error 422" learns nothing and can do nothing.
 *
 * The technical reason is never thrown away. It is logged server-side, where
 * a failure is actually diagnosed, and it travels through the code as the
 * status this module translates. What changes is only what a person is shown.
 *
 * This module is deliberately in `lib/` rather than `server/`: it contains no
 * credential, no client and no network call, so the publishing screen can
 * import the type without pulling a server module into the browser bundle.
 */

export type GitHubFailure = {
  /** One sentence saying what happened, with no jargon. */
  message: string;
  /** What the person can actually do next. Empty when there is nothing. */
  advice: string;
  /** Whether trying again could plausibly give a different answer. */
  retryable: boolean;
  /** Whether reconnecting the GitHub account is the fix. */
  reauth: boolean;
};

/**
 * Translate an API failure by status and by what was being attempted.
 *
 * The same status means different things at different steps — a 403 creating
 * a repository is a permissions problem, a 403 with a rate-limit header is a
 * "come back later" — so the step is part of the translation rather than a
 * detail left for the reader to infer.
 */
export function githubApiFailure(
  status: number,
  step: "auth" | "repo" | "upload" | "pages" | "domain" = "repo",
  hint = "",
): GitHubFailure {
  if (status === 401) {
    return {
      message: "GitHub no longer accepts this connection.",
      advice: "Connect GitHub again to carry on publishing.",
      retryable: true,
      reauth: true,
    };
  }

  if (status === 429 || /rate limit/i.test(hint)) {
    return {
      message: "GitHub is rate-limiting this account.",
      advice: "Wait a few minutes and publish again. Nothing was left half-done.",
      retryable: true,
      reauth: false,
    };
  }

  if (status === 403) {
    const advice: Record<string, string> = {
      repo: "Check that the connected GitHub account has permission to create private repositories.",
      upload: "Check that the connected GitHub account can write to this repository.",
      pages: "Check that the connected account can enable GitHub Pages on this repository. On a free plan, Pages for a private repository requires GitHub Pro or an organisation plan.",
      domain: "Check that the connected account can change this repository's Pages settings.",
      auth: "Re-connect GitHub and approve the permissions it asks for.",
    };
    return {
      message: "GitHub refused that request.",
      advice: advice[step] ?? advice.repo,
      retryable: false,
      reauth: false,
    };
  }

  if (status === 404) {
    return {
      message: "GitHub could not find that repository.",
      advice:
        "It may have been renamed or deleted on GitHub, or the connected account may no longer have access to it. Publishing again will create it fresh.",
      retryable: true,
      reauth: false,
    };
  }

  if (status === 422) {
    const advice: Record<string, string> = {
      repo: "A repository with that name already exists on the connected account and is not one this project owns. Rename the project, or rename the repository on GitHub.",
      pages: "GitHub could not switch Pages on for this repository. Check the repository still exists and the plan allows Pages for private repositories.",
      domain: "GitHub rejected that domain name. Check it is spelled correctly and is not already in use by another GitHub Pages site.",
      upload: "GitHub rejected the upload.",
      auth: "GitHub rejected the sign-in.",
    };
    return {
      message: "GitHub could not do that with the details it was given.",
      advice: advice[step] ?? advice.repo,
      retryable: false,
      reauth: false,
    };
  }

  if (status >= 500) {
    return {
      message: "GitHub is having trouble right now.",
      advice: "This is GitHub's end, not yours. Try publishing again shortly.",
      retryable: true,
      reauth: false,
    };
  }

  if (status === 0) {
    return {
      message: "GitHub could not be reached.",
      advice: "Check the internet connection and try again.",
      retryable: true,
      reauth: false,
    };
  }

  return {
    message: "GitHub returned something this application did not expect.",
    advice: "Try publishing again. If it keeps happening, check GitHub's status page.",
    retryable: true,
    reauth: false,
  };
}

/** The one-line form, for a deployment's `error` field. */
export function githubErrorLine(status: number, step: Parameters<typeof githubApiFailure>[1], hint = ""): string {
  const failure = githubApiFailure(status, step, hint);
  return failure.advice ? `${failure.message} ${failure.advice}` : failure.message;
}
