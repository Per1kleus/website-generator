"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, BottomSheet, Button, Card, Field, TextArea, TextInput, useToast } from "./ui";
import { isProbablyMapsUrl } from "@/lib/maps";

type Fields = {
  business_name: string;
  business_type: string;
  maps_url: string;
  location: string;
  phone: string;
  email: string;
  description: string;
};

/** Project settings (requirement 1: "change project settings" must work on a phone). */
export function ProjectSettings({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Fields;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Fields>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { toast, toastNode } = useToast();

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: "" } : e));
  };

  async function save() {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (form.business_name.trim().length < 2) next.business_name = "Enter the name of the business.";
    if (form.maps_url.trim() && !isProbablyMapsUrl(form.maps_url)) {
      next.maps_url = "That does not look like a Google Maps link.";
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = "Enter a valid email address.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      toast("Settings saved");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not delete the project.");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <AppBar title="Settings" back={`/projects/${projectId}`} />

      {error && <Banner tone="error">{error}</Banner>}

      <div className="mt-4">
        <Field label="Business name" error={errors.business_name}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
              value={form.business_name} onChange={(e) => set("business_name", e.target.value)}
              autoCapitalize="words" />
          )}
        </Field>
        <Field label="Business type">
          {({ id }) => (
            <TextInput id={id} value={form.business_type}
              onChange={(e) => set("business_type", e.target.value)} autoCapitalize="sentences" />
          )}
        </Field>
        <Field label="Google Maps link" error={errors.maps_url}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
              type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={form.maps_url} onChange={(e) => set("maps_url", e.target.value)} />
          )}
        </Field>
        <Field label="Town or city">
          {({ id }) => (
            <TextInput id={id} value={form.location}
              onChange={(e) => set("location", e.target.value)} autoCapitalize="words" />
          )}
        </Field>
        <Field label="Phone">
          {({ id }) => (
            <TextInput id={id} type="tel" inputMode="tel" autoComplete="tel"
              value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
              type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={form.email} onChange={(e) => set("email", e.target.value)} />
          )}
        </Field>
        <Field label="Description">
          {({ id }) => (
            <TextArea id={id} rows={5} value={form.description}
              onChange={(e) => set("description", e.target.value)} autoCapitalize="sentences" />
          )}
        </Field>

        <Button size="lg" block loading={busy} onClick={save}>
          Save changes
        </Button>
      </div>

      <Card className="mt-8 border-danger/40">
        <h2 className="font-bold text-danger">Delete this project</h2>
        <p className="mt-1.5 text-sm text-muted">
          The website, versions and uploaded photos are all removed. This cannot
          be undone.
        </p>
        <Button variant="danger" block className="mt-3" onClick={() => setConfirmDelete(true)}>
          Delete project
        </Button>
      </Card>

      <BottomSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this project?"
        footer={
          <div className="flex gap-2.5">
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" size="lg" className="flex-1" loading={busy} onClick={remove}>
              Delete
            </Button>
          </div>
        }
      >
        <p className="pb-2 text-sm text-muted">
          “{form.business_name}” and everything in it will be permanently removed.
        </p>
      </BottomSheet>

      {toastNode}
    </AppShell>
  );
}
