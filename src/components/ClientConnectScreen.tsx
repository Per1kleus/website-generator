"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * What the client sees when they connect their own Google account.
 *
 * Like the preview screen, deliberately not built from the application's UI
 * kit: there is no navigation into the builder, no project name in a heading,
 * no version number and no mention of how the website was made. A business
 * owner being asked for access to their own Google account should see their own
 * business and a plain account of what is being asked for.
 *
 * Two things this screen is careful about.
 *
 * It never claims more than it knows. A service reads "Connected" only after
 * the server has actually read the thing that was chosen with the credentials
 * that were just granted; until then it says "Checking".
 *
 * It never touches a credential. Signing in happens on Google's own pages; this
 * page's only part in it is a link. Nothing here receives, stores or displays a
 * token, and there is no browser storage of any kind.
 */

type Service = "analytics" | "sheets" | "drive";

type Ask = { service: Service; label: string; why: string };

type ServiceState = {
  service: Service;
  status: string;
  resource: string;
  chosen: boolean;
  verifiedAt: number;
  error: string;
};

type Choice = { id: string; name: string; detail: string };

type View = {
  googleConnected: boolean;
  connectedEmail: string;
  status: string;
  services: ServiceState[];
};

const REASONS: Record<string, string> = {
  connected: "",
  denied:
    "Nothing was connected, because the permission request was declined. You can try again — nothing was changed.",
  partial:
    "Some of the permissions were not approved, so part of this cannot work yet. You can connect again and leave them all ticked.",
  state: "That sign-in could not be completed safely, so it was stopped. Please start again.",
  link: "This link is no longer valid. Please ask for a new one.",
  unconfigured:
    "This could not be started. Please let the person who sent you this link know.",
  failed: "The connection could not be completed. Please try again.",
};

const STATUS_WORDS: Record<string, { text: string; tone: string }> = {
  not_connected: { text: "Not connected", tone: "#63636e" },
  connecting: { text: "Checking", tone: "#8a6d1f" },
  connected: { text: "Connected", tone: "#0a7d3f" },
  partially_connected: { text: "Partly connected", tone: "#8a6d1f" },
  expired: { text: "Needs connecting again", tone: "#b00020" },
  revoked: { text: "Withdrawn", tone: "#63636e" },
  error: { text: "Needs attention", tone: "#b00020" },
};

export function ClientConnectScreen(props: {
  token: string;
  businessName: string;
  asks: Ask[];
  googleConnected: boolean;
  connectedEmail: string;
  status: string;
  services: ServiceState[];
}) {
  const { token, businessName, asks } = props;
  const [view, setView] = useState<View>({
    googleConnected: props.googleConnected,
    connectedEmail: props.connectedEmail,
    status: props.status,
    services: props.services,
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<Service | "">("");
  const [choices, setChoices] = useState<Choice[]>([]);
  const [sheetFile, setSheetFile] = useState<Choice | null>(null);
  const [tabs, setTabs] = useState<{ title: string; rows: number }[]>([]);

  // The reason the Google round trip came back with, read once and then taken
  // out of the address bar so a reload does not re-announce it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("google");
    if (!reason) return;
    setNotice(REASONS[reason] ?? REASONS.failed);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError("");
      try {
        const res = await fetch(`/api/connect/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          setError(String(data.error ?? "That did not work. Please try again."));
          return null;
        }
        if (data.services) {
          setView({
            googleConnected: Boolean(data.googleConnected),
            connectedEmail: String(data.connectedEmail ?? ""),
            status: String(data.status ?? ""),
            services: data.services as ServiceState[],
          });
        }
        return data;
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        return null;
      } finally {
        setBusy("");
      }
    },
    [token],
  );

  // Re-check on arrival back from Google: consent having succeeded says nothing
  // about whether the chosen spreadsheet can actually be read.
  useEffect(() => {
    if (!view.googleConnected) return;
    if (!view.services.some((s) => s.chosen && s.status === "connecting")) return;
    void post({ action: "verify" }, "verify");
    // Once, on mount. Later checks are the buttons below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPicker(service: Service) {
    setOpen(service);
    setChoices([]);
    setTabs([]);
    setSheetFile(null);
    const data = await post({ action: "resources", service }, `list-${service}`);
    if (data?.choices) setChoices(data.choices as Choice[]);
  }

  async function openTabs(file: Choice) {
    setSheetFile(file);
    const data = await post({ action: "resources", service: "sheets", id: file.id }, "list-tabs");
    if (data?.tabs) setTabs(data.tabs as { title: string; rows: number }[]);
  }

  async function choose(service: Service, choice: Choice, sheetTitle?: string) {
    const data = await post(
      { action: "select", service, id: choice.id, name: choice.name, sheetTitle },
      `select-${service}`,
    );
    if (data?.ok) {
      setOpen("");
      setChoices([]);
      setTabs([]);
      setSheetFile(null);
    }
  }

  const done = view.googleConnected && view.status === "connected";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f4f4f6",
        color: "#16161d",
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <header
        style={{
          padding: "1.25rem",
          background: "#fff",
          borderBottom: "1px solid #e4e4ea",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.0625rem", fontWeight: 700 }}>
          {businessName}
          <span
            style={{
              display: "block",
              fontWeight: 400,
              fontSize: "0.8125rem",
              color: "#63636e",
            }}
          >
            Connect your Google account
          </span>
        </h1>
      </header>

      <div style={{ maxWidth: "36rem", margin: "0 auto", padding: "1.25rem" }}>
        {notice && (
          <p data-connect-notice style={card({ borderColor: "#e0c98a", background: "#fdf7e7" })}>
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" data-connect-error style={card({ borderColor: "#e8b4b8", background: "#fdeced" })}>
            {error}
          </p>
        )}

        {!view.googleConnected ? (
          <section style={card()} data-connect-step="start">
            <h2 style={heading}>You are being asked for read-only access</h2>
            <p style={paragraph}>
              Sign in with your own Google account. You will never be asked for
              your Google password here — you enter it on Google&rsquo;s own
              pages, and whoever built your website never sees it.
            </p>
            <p style={paragraph}>
              These are the only permissions being asked for:
            </p>
            <ul style={{ margin: "0.75rem 0 0", padding: 0, listStyle: "none" }}>
              {asks.map((ask) => (
                <li key={ask.service} data-connect-ask={ask.service} style={{ marginTop: "0.75rem" }}>
                  <strong style={{ display: "block", fontSize: "0.9375rem" }}>{ask.label}</strong>
                  <span style={{ fontSize: "0.875rem", color: "#4b4b57" }}>{ask.why}</span>
                </li>
              ))}
            </ul>
            <a href={`/api/connect/${encodeURIComponent(token)}/start`} data-connect-start style={primaryLink}>
              Continue with Google
            </a>
            <p style={{ ...paragraph, marginTop: "0.875rem", fontSize: "0.8125rem" }}>
              You can withdraw this at any time from your Google account, and
              nothing in your Google account is ever changed, added or deleted.
            </p>
          </section>
        ) : (
          <>
            <section style={card()} data-connect-step="choose">
              <h2 style={heading}>
                {done ? "Everything is connected" : "Choose what to use"}
              </h2>
              <p style={paragraph} data-connect-account>
                Signed in as {view.connectedEmail || "your Google account"}.
              </p>
              {!done && (
                <p style={paragraph}>
                  Pick the right one for each item below. Nothing is published or
                  changed by choosing.
                </p>
              )}
            </section>

            {view.services.map((state) => {
              const ask = asks.find((a) => a.service === state.service);
              const word = STATUS_WORDS[state.status] ?? STATUS_WORDS.not_connected;
              return (
                <section
                  key={state.service}
                  style={card()}
                  data-connect-service={state.service}
                  data-connect-status={state.status}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                    <strong style={{ fontSize: "0.9375rem" }}>{ask?.label ?? state.service}</strong>
                    <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: word.tone }}>
                      {word.text}
                    </span>
                  </div>

                  {state.resource && (
                    <p style={{ ...paragraph, marginTop: "0.5rem" }} data-connect-resource>
                      {state.resource}
                    </p>
                  )}
                  {state.error && (
                    <p style={{ ...paragraph, marginTop: "0.5rem", color: "#b00020" }}>
                      {state.error}
                    </p>
                  )}

                  {open === state.service ? (
                    <div style={{ marginTop: "0.875rem" }}>
                      {state.service === "sheets" && sheetFile ? (
                        <>
                          <p style={{ ...paragraph, fontWeight: 600 }}>
                            Which sheet inside “{sheetFile.name}”?
                          </p>
                          {tabs.map((tab) => (
                            <button
                              key={tab.title}
                              type="button"
                              style={choiceButton}
                              data-connect-choice={tab.title}
                              onClick={() => void choose("sheets", sheetFile, tab.title)}
                            >
                              {tab.title}
                            </button>
                          ))}
                          <button type="button" style={quietButton} onClick={() => setSheetFile(null)}>
                            Back
                          </button>
                        </>
                      ) : (
                        <>
                          {busy.startsWith("list-") && <p style={paragraph}>Loading…</p>}
                          {!busy && choices.length === 0 && (
                            <p style={paragraph}>
                              Nothing was found in this Google account.
                            </p>
                          )}
                          {choices.map((choice) => (
                            <button
                              key={choice.id}
                              type="button"
                              style={choiceButton}
                              data-connect-choice={choice.id}
                              onClick={() =>
                                state.service === "sheets"
                                  ? void openTabs(choice)
                                  : void choose(state.service, choice)
                              }
                            >
                              {choice.name}
                              {choice.detail && (
                                <span style={{ display: "block", fontSize: "0.8125rem", color: "#63636e" }}>
                                  {choice.detail}
                                </span>
                              )}
                            </button>
                          ))}
                          <button type="button" style={quietButton} onClick={() => setOpen("")}>
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      style={secondaryButton}
                      data-connect-pick={state.service}
                      disabled={Boolean(busy)}
                      onClick={() => void openPicker(state.service)}
                    >
                      {state.chosen ? "Change" : "Choose"}
                    </button>
                  )}
                </section>
              );
            })}

            <section style={card()}>
              <button
                type="button"
                style={secondaryButton}
                data-connect-recheck
                disabled={Boolean(busy)}
                onClick={() => void post({ action: "verify" }, "verify")}
              >
                Check again
              </button>
              {done && (
                <p style={{ ...paragraph, marginTop: "0.75rem", color: "#0a7d3f", fontWeight: 600 }} data-connect-done>
                  ✓ All done — you can close this page.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function card(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    background: "#fff",
    border: "1px solid #e4e4ea",
    borderRadius: "0.875rem",
    padding: "1.125rem",
    marginBottom: "0.875rem",
    fontSize: "0.9375rem",
    lineHeight: 1.55,
    ...extra,
  };
}

const heading: React.CSSProperties = { margin: "0 0 0.5rem", fontSize: "1rem", fontWeight: 700 };
const paragraph: React.CSSProperties = { margin: 0, fontSize: "0.9375rem", color: "#4b4b57", lineHeight: 1.55 };

const primaryLink: React.CSSProperties = {
  display: "block",
  marginTop: "1.125rem",
  minHeight: "3rem",
  lineHeight: "3rem",
  borderRadius: "0.75rem",
  background: "#16161d",
  color: "#fff",
  textAlign: "center",
  fontWeight: 600,
  textDecoration: "none",
};

const secondaryButton: React.CSSProperties = {
  marginTop: "0.875rem",
  minHeight: "2.75rem",
  padding: "0 1.125rem",
  borderRadius: "0.625rem",
  border: "1px solid #d9d9e0",
  background: "#fff",
  color: "#16161d",
  fontSize: "0.9375rem",
  fontWeight: 600,
  cursor: "pointer",
};

const choiceButton: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  marginTop: "0.5rem",
  minHeight: "2.75rem",
  padding: "0.625rem 0.875rem",
  borderRadius: "0.625rem",
  border: "1px solid #d9d9e0",
  background: "#fff",
  color: "#16161d",
  fontSize: "0.9375rem",
  fontWeight: 600,
  cursor: "pointer",
};

const quietButton: React.CSSProperties = {
  ...secondaryButton,
  border: 0,
  padding: 0,
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "#63636e",
  textDecoration: "underline",
};
