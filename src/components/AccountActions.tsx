"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card } from "./ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

/**
 * Sign-out plus the PWA install prompt. Installation is offered where the
 * browser supports it and never required (requirement 22).
 */
export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {installEvent && (
        <Card className="mt-4">
          <h2 className="font-bold">Install the app</h2>
          <p className="mt-1.5 text-sm text-muted">
            Add it to your home screen and it opens full-screen, like a native app.
          </p>
          <Button
            block
            className="mt-3"
            onClick={async () => {
              await installEvent.prompt();
              setInstallEvent(null);
            }}
          >
            Add to home screen
          </Button>
        </Card>
      )}

      <Button variant="secondary" size="lg" block className="mt-4" loading={busy} onClick={logout}>
        Sign out
      </Button>
    </>
  );
}
