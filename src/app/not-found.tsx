import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="flex min-h-[100svh] flex-col items-center justify-center safe-x text-center"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <main id="main" className="max-w-xs">
        <p aria-hidden="true" className="mb-4 text-5xl">
          🔍
        </p>
        <h1 className="text-xl font-bold">Not found</h1>
        <p className="mt-2 text-sm text-muted">
          That page does not exist, or it belongs to another account.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-[var(--spacing-touch-lg)] items-center justify-center rounded-xl bg-brand px-6 font-semibold text-on-brand"
        >
          Back to projects
        </Link>
      </main>
    </div>
  );
}
