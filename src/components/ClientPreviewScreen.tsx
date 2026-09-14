"use client";

import { useRef, useState } from "react";
import { VIEWPORTS, type ViewportId } from "@/lib/viewports";

/**
 * What the client sees.
 *
 * Deliberately not built from the application's own UI kit. Everything on this
 * screen is the website and the two decisions the client has to make; there is
 * no navigation into the builder, no project name in a heading, no version
 * number, no score, no mention of how the site was made. A client reviewing
 * work for their business should see their business, not a tool.
 *
 * The website itself comes from the same renderer the creator previews and the
 * publisher ships, framed the same way — sandboxed, with no same-origin access
 * — so what the client approves is what will go live.
 */

type Device = Extract<ViewportId, "desktop" | "tablet" | "mobile">;

const DEVICES: { id: Device; label: string }[] = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" },
];

export function ClientPreviewScreen({
  token,
  businessName,
  locales,
  defaultLocale,
  alreadyAnswered,
}: {
  token: string;
  businessName: string;
  locales: string[];
  defaultLocale: string;
  /** "approved" | "changes" | "" — what this link has already been told. */
  alreadyAnswered: string;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [locale, setLocale] = useState(defaultLocale);
  const [answered, setAnswered] = useState(alreadyAnswered);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);

  const width = VIEWPORTS.find((v) => v.id === device)?.width ?? 1440;

  async function respond(kind: "approved" | "changes") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/p/${encodeURIComponent(token)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not send. Please try again.");
        return;
      }
      setAnswered(kind);
      setAsking(false);
    } catch {
      setError("Could not send that. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

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
          display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
          padding: "1rem 1.25rem", background: "#fff", borderBottom: "1px solid #e4e4ea",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, flex: "1 1 12rem" }}>
          {businessName}
          <span style={{ display: "block", fontWeight: 400, fontSize: "0.8125rem", color: "#63636e" }}>
            Website preview
          </span>
        </h1>

        <div role="group" aria-label="Preview size" style={{ display: "flex", gap: "0.25rem" }}>
          {DEVICES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDevice(d.id)}
              aria-pressed={device === d.id}
              data-client-device={d.id}
              style={{
                minHeight: "2.75rem", padding: "0 0.875rem", borderRadius: "0.625rem",
                border: "1px solid " + (device === d.id ? "#16161d" : "#e4e4ea"),
                background: device === d.id ? "#16161d" : "#fff",
                color: device === d.id ? "#fff" : "#16161d",
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
              }}
            >
              {d.label}
            </button>
          ))}
        </div>

        {locales.length > 1 && (
          <select
            aria-label="Language"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{
              minHeight: "2.75rem", padding: "0 0.75rem", borderRadius: "0.625rem",
              border: "1px solid #e4e4ea", background: "#fff", fontSize: "0.875rem",
            }}
          >
            {locales.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        )}
      </header>

      <div ref={stage} style={{ padding: "1.25rem", display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: "100%", maxWidth: `${width}px`,
            border: "1px solid #e4e4ea", borderRadius: "0.75rem", overflow: "hidden",
            background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <iframe
            key={`${locale}`}
            title={`${businessName} website preview`}
            src={`/api/p/${encodeURIComponent(token)}/render?locale=${encodeURIComponent(locale)}`}
            data-client-frame
            // No same-origin: the framed website cannot read this page, and
            // this page cannot read into it. The same isolation the builder
            // preview uses.
            sandbox="allow-scripts allow-popups"
            style={{ display: "block", width: "100%", height: "78vh", border: 0 }}
          />
        </div>
      </div>

      <section
        aria-label="Your decision"
        data-client-decision={answered || "none"}
        style={{
          position: "sticky", bottom: 0, background: "#fff",
          borderTop: "1px solid #e4e4ea", padding: "1rem 1.25rem",
        }}
      >
        <div style={{ maxWidth: "48rem", margin: "0 auto" }}>
          {error && (
            <p role="alert" style={{ margin: "0 0 0.75rem", color: "#b00020", fontSize: "0.875rem" }}>
              {error}
            </p>
          )}

          {answered === "approved" ? (
            <p style={{ margin: 0, fontWeight: 600, color: "#0a7d3f" }} data-client-approved>
              ✓ Thank you — you approved this website. The person who made it has been told.
            </p>
          ) : answered === "changes" ? (
            <p style={{ margin: 0, fontWeight: 600 }} data-client-changes-sent>
              Thank you — your notes have been sent. You will hear back about the changes.
            </p>
          ) : asking ? (
            <>
              <label
                htmlFor="client-feedback"
                style={{ display: "block", fontWeight: 600, marginBottom: "0.5rem" }}
              >
                What would you like changed?
              </label>
              <textarea
                id="client-feedback"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                data-client-feedback
                style={{
                  width: "100%", padding: "0.75rem", borderRadius: "0.625rem",
                  border: "1px solid #d9d9e0", fontSize: "1rem", fontFamily: "inherit",
                  resize: "vertical", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "0.625rem", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setAsking(false)}
                  style={secondary}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || !message.trim()}
                  onClick={() => void respond("changes")}
                  data-client-send-feedback
                  style={{ ...primary, opacity: busy || !message.trim() ? 0.5 : 1 }}
                >
                  Send feedback
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: "0.625rem", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond("approved")}
                data-client-approve
                style={primary}
              >
                Approve website
              </button>
              <button
                type="button"
                onClick={() => setAsking(true)}
                data-client-request-changes
                style={secondary}
              >
                Request changes
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const primary: React.CSSProperties = {
  minHeight: "3rem", padding: "0 1.5rem", borderRadius: "0.75rem", border: 0,
  background: "#16161d", color: "#fff", fontSize: "1rem", fontWeight: 600, cursor: "pointer",
};

const secondary: React.CSSProperties = {
  minHeight: "3rem", padding: "0 1.5rem", borderRadius: "0.75rem",
  border: "1px solid #d9d9e0", background: "#fff", color: "#16161d",
  fontSize: "1rem", fontWeight: 600, cursor: "pointer",
};
