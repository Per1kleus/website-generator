/**
 * What a Google failure means, in the creator's language.
 *
 * The OAuth and Sheets APIs fail in terms that are meaningful to whoever wrote
 * them and to nobody else: `access_denied`, `invalid_grant`, `403`. A creator
 * reading "OAuth error 403" learns nothing and can do nothing. Each reason
 * here is paired with the one thing the person can actually do next.
 *
 * The technical reason is never thrown away — it is logged server-side where a
 * failure is diagnosed, and it travels through the flow as the machine-readable
 * code this module translates. What changes is only what a person is shown.
 */

export type GoogleFailure = {
  /** One sentence saying what happened, with no jargon. */
  message: string;
  /** What to do about it. Empty when there is nothing useful to suggest. */
  advice: string;
  /** Whether offering a retry makes sense — some failures will not change. */
  retryable: boolean;
};

/** Reason codes the OAuth callback attaches to its return URL. */
const REASONS: Record<string, GoogleFailure> = {
  denied: {
    message: "Google was not connected, because the permission request was declined.",
    advice:
      "Nothing was changed. Try again and choose Allow on the Google screen to let the app read your spreadsheets.",
    retryable: true,
  },
  state: {
    message: "That sign-in could not be completed safely, so it was stopped.",
    advice: "This usually means it was left open too long. Start the connection again.",
    retryable: true,
  },
  partial: {
    message: "Google was connected, but not every permission was approved.",
    advice:
      "Connect again and leave both permissions ticked — the app needs to read your spreadsheets and the images they refer to.",
    retryable: true,
  },
  unconfigured: {
    message: "This copy of the application has no Google credentials configured.",
    advice: "Add a Google client ID in settings, or ask whoever set this up to add one.",
    retryable: false,
  },
  failed: {
    message: "Google connection could not be completed.",
    advice: "Check that the required permissions were approved, then try again.",
    retryable: true,
  },
};

/** Translate a reason code. Anything unrecognised reads as a generic failure. */
export function googleFailure(reason: string): GoogleFailure {
  return REASONS[reason] ?? REASONS.failed;
}

/**
 * Translate an API failure by its HTTP status.
 *
 * Used for the calls made after connecting — listing spreadsheets, reading a
 * tab, fetching a Drive image — where the status is the only thing that
 * reliably distinguishes "reconnect" from "wait" from "that file is gone".
 */
export function googleApiFailure(status: number, reauth = false): GoogleFailure {
  if (reauth || status === 401) {
    return {
      message: "Your Google connection has expired.",
      advice: "Connect Google again to carry on.",
      retryable: true,
    };
  }
  if (status === 403) {
    return {
      message: "Google refused that request.",
      advice:
        "The connected account may not have approved the permissions the app needs, or may not have access to that file.",
      retryable: true,
    };
  }
  if (status === 404) {
    return {
      message: "That spreadsheet could not be found.",
      advice: "It may have been deleted, renamed, or belong to a different Google account.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      message: "Google is temporarily rate limiting this account.",
      advice: "Wait a moment and try again.",
      retryable: true,
    };
  }
  return {
    message: "Could not reach Google.",
    advice: "Check your internet connection and try again.",
    retryable: true,
  };
}
