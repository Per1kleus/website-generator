/**
 * Host-shell helpers.
 *
 * The same UI runs in three places: a browser, the Tauri desktop window, and
 * the Capacitor Android app. These helpers ask "which am I in?" so a screen
 * can do the right thing without forking into three implementations.
 */

type TauriGlobal = {
  __TAURI__?: {
    opener?: { openUrl?: (url: string) => Promise<void> };
    core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  };
  Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> };
};

function host(): TauriGlobal {
  return (typeof window === "undefined" ? {} : window) as unknown as TauriGlobal;
}

export function isTauri(): boolean {
  return Boolean(host().__TAURI__);
}

export function isCapacitor(): boolean {
  return Boolean(host().Capacitor?.isNativePlatform?.());
}

/** True in any packaged shell, as opposed to an ordinary browser tab. */
export function isPackaged(): boolean {
  return isTauri() || isCapacitor();
}

/**
 * Opens a URL outside the application window.
 *
 * Google refuses OAuth inside an embedded webview, so consent has to happen in
 * the user's own browser. Each shell has its own way of doing that; a browser
 * just opens a tab.
 */
export async function openExternal(url: string): Promise<boolean> {
  const w = host();
  try {
    if (w.__TAURI__?.opener?.openUrl) {
      await w.__TAURI__.opener.openUrl(url);
      return true;
    }
    const browser = w.Capacitor?.Plugins?.Browser as
      | { open?: (opts: { url: string }) => Promise<void> }
      | undefined;
    if (browser?.open) {
      await browser.open({ url });
      return true;
    }
  } catch {
    // Fall through to a normal window open.
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}
