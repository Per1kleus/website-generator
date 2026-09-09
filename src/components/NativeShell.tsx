"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Native-shell behaviour for the Android build.
 *
 * Deliberately talks to the Capacitor runtime through its window global rather
 * than importing its packages: the web bundle every other user downloads gains
 * nothing, and this file is inert in a browser and in the desktop shell.
 *
 * Handles the two things Android users notice immediately if they are missing:
 * the hardware back button, and the app resuming after being backgrounded.
 */

type CapacitorPlugins = {
  App?: {
    addListener: (
      event: string,
      handler: (payload: never) => void,
    ) => Promise<{ remove: () => void }>;
    exitApp: () => void;
  };
  Browser?: { close?: () => Promise<void> };
};

export function NativeShell() {
  const router = useRouter();

  useEffect(() => {
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: CapacitorPlugins };
    }).Capacitor;

    if (!cap?.isNativePlatform?.()) return;
    const App = cap.Plugins?.App;
    if (!App) return;

    const subscriptions: { remove: () => void }[] = [];

    // Hardware back: navigate back through the app's own history, and only
    // leave the app from a top-level screen. Anything else feels broken on
    // Android — the button is expected to undo the last navigation.
    void App.addListener("backButton", () => {
      const atRoot = ["/", "/login", "/signup", "/account"].includes(window.location.pathname);
      if (!atRoot && window.history.length > 1) {
        router.back();
      } else {
        App.exitApp();
      }
    }).then((handle) => subscriptions.push(handle));

    // Returning from the browser after Google consent, or from any background
    // pause: re-read server state rather than showing a stale screen.
    void App.addListener("appStateChange", (state: never) => {
      if ((state as unknown as { isActive?: boolean }).isActive) router.refresh();
    }).then((handle) => subscriptions.push(handle));

    // Deep link back from the OAuth browser tab.
    void App.addListener("appUrlOpen", (event: never) => {
      const url = (event as unknown as { url?: string }).url ?? "";
      if (!url.includes("oauth")) return;
      void cap.Plugins?.Browser?.close?.();
      router.refresh();
    }).then((handle) => subscriptions.push(handle));

    return () => {
      for (const s of subscriptions) s.remove();
    };
  }, [router]);

  return null;
}
