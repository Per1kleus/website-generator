"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Field, TextArea, TextInput } from "./ui";
import { IconCheck } from "./icons";
import { SITE_KINDS, type SiteKind } from "@/lib/site";
import { STYLE_OPTIONS } from "@/lib/styles";
import { isProbablyMapsUrl, parseMapsUrl } from "@/lib/maps";

/**
 * Project creation as a stepped flow (requirement 4).
 *
 * One question per screen. A phone keyboard covers half the viewport, so a
 * single long scrolling form would mean the user never sees where they are.
 * Each step keeps its own validation and every error is recoverable in place.
 */

type Step = 0 | 1 | 2 | 3;
const STEP_TITLES = ["Your business", "Location", "What to build", "Style"];

type Form = {
  businessName: string;
  businessType: string;
  mapsUrl: string;
  location: string;
  phone: string;
  email: string;
  description: string;
  siteKind: SiteKind;
  style: string;
};

export function CreateWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Form>({
    businessName: "",
    businessType: "",
    mapsUrl: "",
    location: "",
    phone: "",
    email: "",
    description: "",
    siteKind: "business",
    style: "classic",
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear the error the moment the user starts fixing it — error recovery
    // should never require re-submitting to find out if it worked.
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };

  function validateStep(s: Step): boolean {
    const next: Record<string, string> = {};
    if (s === 0) {
      if (form.businessName.trim().length < 2) {
        next.businessName = "Enter the name of the business.";
      }
    }
    if (s === 1) {
      if (form.mapsUrl.trim() && !isProbablyMapsUrl(form.mapsUrl)) {
        next.mapsUrl = "That does not look like a Google Maps link. You can also leave it empty.";
      }
      if (!form.mapsUrl.trim() && !form.location.trim()) {
        next.location = "Add a Google Maps link or type the town or city.";
      }
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        next.email = "Enter a valid email address.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(3, s + 1) as Step);
    // Return the user to the top of the new step; otherwise a phone keeps the
    // previous scroll position and the new question starts off-screen.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function back() {
    if (step === 0) {
      router.push("/");
      return;
    }
    setStep((s) => Math.max(0, s - 1) as Step);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  async function submit() {
    if (!validateStep(0) || !validateStep(1)) {
      setStep(0);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Could not create the project.");
        return;
      }
      router.push(`/projects/${data.project.id}/generate`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const maps = parseMapsUrl(form.mapsUrl);

  return (
    <AppShell>
      <AppBar
        title={STEP_TITLES[step]}
        subtitle={`Step ${step + 1} of 4`}
        back={true}
      />

      {/* Progress: a plain bar, readable at 320px, with a real accessible value. */}
      <div
        className="mt-2 mb-5 flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={step + 1}
        aria-label={`Step ${step + 1} of 4: ${STEP_TITLES[step]}`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= step ? "bg-brand" : "bg-elevated"
            }`}
          />
        ))}
      </div>

      {formError && <Banner tone="error">{formError}</Banner>}

      {step === 0 && (
        <section aria-labelledby="step-0">
          <h2 id="step-0" className="sr-only">
            Your business
          </h2>
          <Field label="Business name" error={errors.businessName}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.businessName}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder="Caffè Verde"
                autoCapitalize="words"
                enterKeyHint="next"
                autoFocus
              />
            )}
          </Field>

          <Field
            label="What kind of business is it?"
            hint="For example: coffee shop, barber, dentist, bakery."
          >
            {({ id }) => (
              <TextInput
                id={id}
                value={form.businessType}
                onChange={(e) => set("businessType", e.target.value)}
                placeholder="Coffee shop"
                autoCapitalize="sentences"
                enterKeyHint="next"
              />
            )}
          </Field>

          <Field
            label="Describe the business"
            hint="A sentence or two in your own words. This is what the copy is written from."
          >
            {({ id }) => (
              <TextArea
                id={id}
                rows={5}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Small independent coffee shop near the station. We roast our own beans and bake everything in-house."
                autoCapitalize="sentences"
                enterKeyHint="done"
              />
            )}
          </Field>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="step-1">
          <h2 id="step-1" className="sr-only">
            Location and contact
          </h2>

          <Field
            label="Google Maps link"
            hint="Open Google Maps, tap Share, then paste the link here."
            error={errors.mapsUrl}
          >
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="url"
                inputMode="url"
                value={form.mapsUrl}
                onChange={(e) => set("mapsUrl", e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
              />
            )}
          </Field>

          {maps.valid && (
            <p className="-mt-2 mb-4 flex items-start gap-1.5 text-xs font-medium text-success">
              <IconCheck size={16} />
              <span>
                {maps.placeName
                  ? `Recognised: ${maps.placeName}`
                  : "Google Maps link recognised."}
              </span>
            </p>
          )}

          <Field label="Town or city" error={errors.location}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Thessaloniki"
                autoCapitalize="words"
                enterKeyHint="next"
              />
            )}
          </Field>

          <Field label="Phone" hint="Used for the tap-to-call button.">
            {({ id }) => (
              <TextInput
                id={id}
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+30 231 000 0000"
                autoComplete="tel"
                enterKeyHint="next"
              />
            )}
          </Field>

          <Field label="Email" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="hello@business.com"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
              />
            )}
          </Field>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="step-2">
          <h2 id="step-2" className="mb-3 text-sm font-semibold">
            What should we build?
          </h2>
          <div role="radiogroup" aria-labelledby="step-2" className="grid gap-2.5">
            {SITE_KINDS.map((k) => {
              const active = form.siteKind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("siteKind", k.id)}
                  className={`flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border p-4 text-left active:scale-[0.99] ${
                    active
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface"
                  }`}
                >
                  <span aria-hidden="true" className="text-2xl">
                    {k.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{k.label}</span>
                    <span className="block text-sm text-muted">{k.blurb}</span>
                  </span>
                  {active && (
                    <span className="text-brand">
                      <IconCheck size={20} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="step-3">
          <h2 id="step-3" className="mb-3 text-sm font-semibold">
            Pick a look
          </h2>
          <p className="mb-4 text-sm text-muted">
            You can change colours, fonts and spacing at any time after it is built.
          </p>
          <div role="radiogroup" aria-labelledby="step-3" className="grid grid-cols-2 gap-2.5">
            {STYLE_OPTIONS.map((s) => {
              const active = form.style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set("style", s.id)}
                  className={`min-h-[var(--spacing-touch-lg)] rounded-card border p-3 text-left active:scale-[0.99] ${
                    active
                      ? "border-brand bg-brand-soft"
                      : "border-line bg-surface"
                  }`}
                >
                  <span className="mb-2 flex gap-1" aria-hidden="true">
                    {s.swatches.map((c) => (
                      <span
                        key={c}
                        className="size-4 rounded-full border border-black/10"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted">{s.hint}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky action bar: the primary action is always under the thumb and
          always clear of the home indicator and the bottom tab bar. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 px-4 pt-3 backdrop-blur-lg md:pl-60"
        style={{
          paddingBottom:
            "calc(0.75rem + var(--safe-bottom) + var(--bottomnav-h))",
        }}
      >
        <div className="mx-auto flex max-w-3xl gap-3 lg:max-w-5xl">
          <Button variant="secondary" size="lg" onClick={back} className="flex-1">
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 3 ? (
            <Button size="lg" onClick={next} className="flex-[2]">
              Continue
            </Button>
          ) : (
            <Button size="lg" onClick={submit} loading={busy} className="flex-[2]">
              Generate website
            </Button>
          )}
        </div>
      </div>
      {/* Spacer so the last field is never hidden behind the sticky bar. */}
      <div aria-hidden="true" className="h-32" />
    </AppShell>
  );
}
