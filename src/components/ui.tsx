"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { IconBack, IconClose } from "./icons";

/* ------------------------------- App bar -------------------------------- */

/**
 * Contextual top bar. On a sub-page it shows a back affordance rather than a
 * hamburger — on a phone, "where am I and how do I get out" beats a menu.
 */
export function AppBar({
  title,
  back,
  action,
  subtitle,
}: {
  title: string;
  back?: string | true;
  action?: React.ReactNode;
  subtitle?: string;
}) {
  const router = useRouter();
  return (
    <header
      className="sticky top-0 z-30 -mx-4 mb-2 border-b border-line bg-canvas/90 px-4 backdrop-blur-lg"
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className="flex min-h-[var(--appbar-h)] items-center gap-2">
        {back ? (
          typeof back === "string" ? (
            <Link
              href={back}
              aria-label="Go back"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated active:bg-elevated"
            >
              <IconBack />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Go back"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-elevated active:bg-elevated"
            >
              <IconBack />
            </button>
          )
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold sm:text-lg">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}

/* ------------------------------- Buttons -------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  block?: boolean;
  loading?: boolean;
};

const VARIANTS = {
  primary: "bg-brand text-on-brand hover:brightness-105 active:brightness-110",
  secondary:
    "bg-surface text-ink border border-line hover:bg-elevated active:bg-elevated",
  ghost: "bg-transparent text-ink hover:bg-elevated active:bg-elevated",
  danger: "bg-danger text-white hover:brightness-105 active:brightness-110",
};

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[transform,filter] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
        size === "lg"
          ? "min-h-[var(--spacing-touch-lg)] px-6 text-base"
          : "min-h-[var(--spacing-touch)] px-4 text-sm"
      } ${block ? "w-full" : ""} ${VARIANTS[variant]} ${className}`}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-current border-t-transparent"
          style={{ animation: "spin 0.7s linear infinite" }}
        />
      )}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  block,
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: "md" | "lg";
  block?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentProps<typeof Link>, "href" | "className" | "children">) {
  return (
    <Link
      href={href}
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-transform active:scale-[0.98] ${
        size === "lg"
          ? "min-h-[var(--spacing-touch-lg)] px-6 text-base"
          : "min-h-[var(--spacing-touch)] px-4 text-sm"
      } ${block ? "w-full" : ""} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/* -------------------------------- Fields -------------------------------- */

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
};

/** Wraps a control with a real <label>, hint text, and an aria-linked error. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mb-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errId} role="alert" className="mt-1.5 flex items-start gap-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "w-full rounded-xl border bg-surface px-4 py-3 text-ink placeholder:text-muted min-h-[var(--spacing-touch-lg)]";

export function TextInput({
  invalid,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} ${invalid ? "border-danger" : "border-line"} ${className}`}
    />
  );
}

export function TextArea({
  invalid,
  className = "",
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} resize-y leading-relaxed ${invalid ? "border-danger" : "border-line"} ${className}`}
    />
  );
}

export function Select({
  invalid,
  className = "",
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...rest}
      aria-invalid={invalid || undefined}
      className={`${CONTROL} appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2362626e' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[right_1rem_center] bg-no-repeat pr-12 ${
        invalid ? "border-danger" : "border-line"
      } ${className}`}
    >
      {children}
    </select>
  );
}

/* ------------------------------ Bottom sheet ----------------------------- */

/**
 * The primary mobile disclosure pattern (requirements 9 and 11).
 * Rises from the bottom, is dismissible by tapping the scrim, traps focus,
 * closes on Escape, and locks background scroll while open.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the panel so a screen reader lands inside the sheet, not behind it.
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/45"
        style={{ animation: "fade-in .18s ease-out" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[88svh] w-full flex-col rounded-t-sheet bg-surface shadow-2xl outline-none sm:max-w-lg sm:rounded-sheet lg:max-w-2xl"
        style={{ animation: "sheet-in .22s cubic-bezier(.32,.72,0,1)" }}
      >
        {/* Grab handle: the visual cue that this panel is draggable/dismissible. */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <div className="flex items-center gap-2 px-4 py-3">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex size-11 items-center justify-center rounded-full text-muted hover:bg-elevated active:bg-elevated"
          >
            <IconClose size={20} />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4"
          style={{
            // Without a footer this is the last thing on screen, so it owns the
            // home-indicator clearance.
            paddingBottom: footer ? "0.5rem" : "calc(0.75rem + var(--safe-bottom))",
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            className="border-t border-line px-4 pt-3"
            style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom))" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Misc ---------------------------------- */

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-line bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "error" | "success" | "warning";
  children: React.ReactNode;
}) {
  const tones = {
    info: "bg-brand-soft text-brand",
    error: "bg-danger/12 text-danger",
    success: "bg-success/12 text-success",
    warning: "bg-warning/12 text-warning",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/** Announces async results to screen readers without stealing focus. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

export function useToast() {
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const node = toast ? (
    <div
      role="status"
      className="fixed inset-x-4 z-[80] mx-auto max-w-sm rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-canvas shadow-xl"
      style={{
        bottom: "calc(var(--safe-bottom) + 1.25rem)",
        animation: "fade-in .2s ease-out",
      }}
    >
      {toast}
    </div>
  ) : null;

  return { toast: setToast, toastNode: node };
}
