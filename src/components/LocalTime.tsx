"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp written the way the reader's own device writes it.
 *
 * Every one of these is a hydration hazard, and two of them are real bugs
 * rather than theoretical ones. `toLocaleString` reads the time zone and
 * locale of whoever formats it: rendered on the server that is the machine's,
 * rendered in the browser it is the visitor's, and the two disagree the
 * moment the application is not running on the same computer as the person
 * using it. A relative time is worse still — "just now" on the server is "1
 * minute ago" a second later in the browser, whatever the time zone.
 *
 * So nothing time-shaped is rendered until the component has mounted. Before
 * that it renders the fallback, which the server and the first client render
 * both produce, so they always agree. The real time appears immediately
 * afterwards.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function formatRelative(ts: number, now: number): string {
  if (!ts) return "never";
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleString();
}

export function LocalTime({
  ts,
  mode = "absolute",
  options,
  fallback = "…",
}: {
  ts: number;
  mode?: "absolute" | "relative";
  options?: Intl.DateTimeFormatOptions;
  fallback?: string;
}) {
  const mounted = useMounted();
  if (!ts) return <>never</>;
  if (!mounted) return <>{fallback}</>;
  return (
    <>
      {mode === "relative"
        ? formatRelative(ts, Date.now())
        : options
          ? new Date(ts).toLocaleDateString(undefined, options)
          : new Date(ts).toLocaleString()}
    </>
  );
}
