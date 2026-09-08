"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet, Banner } from "./ui";
import { IconSend, IconSparkles } from "./icons";
import type { Site } from "@/lib/site";

/**
 * The mobile AI editor (requirement 9).
 *
 * A bottom sheet with an autogrowing textarea and a send button, i.e. the
 * shape every phone user already knows from messaging. Suggested commands are
 * a horizontal chip rail so they cost one line of vertical space, not eight.
 */

const SUGGESTIONS = [
  "Make it more luxurious",
  "Make it more minimal",
  "Change the colors",
  "Improve the mobile layout",
  "Add a gallery",
  "Remove this section",
  "Make the menu easier to navigate",
  "Shorten the text for phones",
  "Make the buttons stand out",
];

export function AiSheet({
  open,
  projectId,
  focusSectionId,
  onClose,
  onApplied,
}: {
  open: boolean;
  projectId: string;
  focusSectionId?: string;
  onClose: () => void;
  onApplied: (site: Site, summary: string) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      setNote("");
      setError("");
    }
  }, [open]);

  // Grow with the text instead of scrolling inside a 2-line box.
  function autosize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  async function send(instruction: string) {
    const text = instruction.trim();
    if (!text || busy) return;

    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/projects/${projectId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, sectionId: focusSectionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That did not work. Try rephrasing it.");
        return;
      }
      if (data.changed) {
        onApplied(data.site as Site, data.summary as string);
        setValue("");
        onClose();
      } else {
        setNote(data.summary as string);
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const composer = (
    <>
      <div className="mb-2 flex items-end gap-2 rounded-card border border-line bg-surface p-2">
        <span aria-hidden="true" className="mb-2.5 ml-1 text-brand">
          <IconSparkles size={20} />
        </span>
        <textarea
          ref={(el) => {
            inputRef.current = el;
            autosize(el);
          }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            // Enter sends on a hardware keyboard; on a phone the send button
            // is the path, and Shift+Enter always makes a new line.
            if (e.key === "Enter" && !e.shiftKey && !busy) {
              e.preventDefault();
              void send(value);
            }
          }}
          rows={1}
          disabled={busy}
          aria-label="Describe the change you want"
          placeholder="Ask AI to edit…"
          enterKeyHint="send"
          autoCapitalize="sentences"
          className="max-h-40 min-h-[var(--spacing-touch)] flex-1 resize-none bg-transparent py-2.5 text-ink outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => send(value)}
          disabled={busy || !value.trim()}
          aria-label="Send"
          className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand active:scale-95 disabled:opacity-40"
        >
          {busy ? (
            <span
              aria-hidden="true"
              className="size-4 rounded-full border-2 border-current border-t-transparent"
              style={{ animation: "spin .7s linear infinite" }}
            />
          ) : (
            <IconSend size={18} />
          )}
        </button>
      </div>
      <p aria-live="polite" className="text-xs text-muted">
        {busy
          ? "Working on it — this can take a moment."
          : "Your website is saved before each change, so you can always go back in Versions."}
      </p>
    </>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title="Ask AI to edit" footer={composer}>
      {error && <Banner tone="error">{error}</Banner>}
      {note && <Banner tone="info">{note}</Banner>}

      {/* Chip rail — swipeable, each chip is a full 44px target. */}
      <div className="snap-rail no-scrollbar -mx-4 mb-2 px-4 pb-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => {
              setValue(s);
              inputRef.current?.focus();
            }}
            className="flex min-h-[var(--spacing-touch)] items-center whitespace-nowrap rounded-full border border-line bg-surface px-4 text-sm font-medium active:bg-elevated disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <p className="pb-2 text-xs text-muted">
        Tap a suggestion, or describe the change in your own words.
      </p>
    </BottomSheet>
  );
}
