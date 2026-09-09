import "server-only";

/**
 * How this process is running, and what may be shipped to a client.
 *
 * The application is a Node server: 44 of its 44 routes are server-rendered,
 * it uses native modules (better-sqlite3, sharp) and a Python subprocess.
 * There is no static build to drop into a webview, so packaging means one of
 * two shapes:
 *
 *   local   the desktop app boots this same server on a loopback port and
 *           talks to it. The user's own machine is the backend, so the user
 *           is the operator: their API keys live in their OS profile, exactly
 *           as any desktop app stores its configuration.
 *
 *   remote  a thin client (Android, or a desktop pointed at a shared server)
 *           talks to a hosted deployment. Nothing sensitive ships in the app.
 *
 * In neither case are secrets embedded in an installer or an APK.
 */

export type RuntimeMode = "server" | "desktop";

/** Set by the desktop sidecar launcher; absent for a normal web deployment. */
export function mode(): RuntimeMode {
  return process.env.WG_RUNTIME === "desktop" ? "desktop" : "server";
}

export function isDesktop(): boolean {
  return mode() === "desktop";
}

/**
 * The origin this server is reachable at.
 *
 * Desktop runs on an ephemeral loopback port, so it cannot be hardcoded; the
 * launcher passes it through. A hosted deployment may set WG_PUBLIC_URL for
 * canonical URLs and OAuth redirects.
 */
export function selfOrigin(fallback: string): string {
  return (process.env.WG_PUBLIC_URL || process.env.WG_SELF_ORIGIN || fallback).replace(/\/+$/, "");
}

/**
 * Public configuration — safe to hand to any client.
 *
 * This is the allowlist. Anything not named here never leaves the server, so
 * a new secret cannot leak by being added to the environment.
 */
export type PublicConfig = {
  mode: RuntimeMode;
  version: string;
  /** Whether the operator configured Google at all. Never the credentials. */
  googleConfigured: boolean;
  /** Whether a hosted model is available. Never the key. */
  aiConfigured: boolean;
  /** Desktop OAuth needs the system browser rather than the app's webview. */
  oauthFlow: "web-redirect" | "system-browser";
};

export function publicConfig(): PublicConfig {
  return {
    mode: mode(),
    version: process.env.WG_VERSION || "0.0.0",
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID),
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    oauthFlow: isDesktop() ? "system-browser" : "web-redirect",
  };
}

/**
 * The Python interpreter for the vendored design catalogue.
 *
 * A packaged desktop build ships an embedded interpreter and points at it, so
 * the catalogue keeps working without the user installing Python. Everywhere
 * else this is plain `python3`, and the catalogue degrades gracefully when it
 * is missing.
 */
export function pythonBin(): string {
  return process.env.WG_PYTHON || "python3";
}
