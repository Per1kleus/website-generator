import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Served by the service worker when a navigation fails with no connection. */
export default function OfflinePage() {
  return (
    <div
      className="flex min-h-[100svh] flex-col items-center justify-center safe-x text-center"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <main id="main" className="max-w-xs">
        <p aria-hidden="true" className="mb-4 text-5xl">
          📡
        </p>
        <h1 className="text-xl font-bold">You are offline</h1>
        <p className="mt-2 text-sm text-muted">
          Anything already generating keeps running on the server. Reconnect and
          this will catch up on its own.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center rounded-xl bg-brand px-6 font-semibold text-on-brand"
        >
          Try again
        </a>
      </main>
    </div>
  );
}
