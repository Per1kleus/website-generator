"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AppShell } from "./AppShell";
import { AppBar, Banner, Button, Field, TextArea, TextInput } from "./ui";
import { IconCheck, IconImage, IconTrash } from "./icons";
import { LOCALES, localeInfo, type Locale } from "@/lib/locales";
import { SITE_KINDS, type SiteKind } from "@/lib/site";
import { STYLE_OPTIONS } from "@/lib/styles";
import { isProbablyMapsUrl, parseMapsUrl } from "@/lib/maps";

/**
 * Project creation as a stepped flow (requirement 4).
 *
 * One question per screen: a phone keyboard covers half the viewport, so a
 * single long form means the creator never sees where they are. Each step
 * validates on its own and every error is recoverable in place.
 */

type Step = 0 | 1 | 2 | 3 | 4;
const STEP_TITLES = ["Your business", "Location", "What to build", "Languages", "Style"];

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
  designNotes: string;
  defaultLocale: Locale;
  locales: Locale[];
};

export function CreateWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<{ id: string; url: string; name: string } | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

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
    designNotes: "",
    defaultLocale: "en",
    locales: ["en"],
  });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Clear the error as soon as the creator starts fixing it.
    setErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
  };

  function validateStep(s: Step): boolean {
    const next: Record<string, string> = {};
    if (s === 0 && form.businessName.trim().length < 2) {
      next.businessName = "Enter the name of the business.";
    }
    if (s === 1) {
      if (form.mapsUrl.trim() && !isProbablyMapsUrl(form.mapsUrl)) {
        next.mapsUrl = "That does not look like a Google Maps link. You can also leave it empty.";
      }
      // Requirement 1: a Maps link OR a written description is enough.
      if (!form.mapsUrl.trim() && !form.location.trim() && !form.description.trim()) {
        next.location = "Add a Google Maps link, or a town, or describe the business on the previous step.";
      }
      if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        next.email = "Enter a valid email address.";
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goto(s: Step) {
    setStep(s);
    // A phone keeps the previous scroll position, which would start the new
    // question off-screen.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }

  function next() {
    if (!validateStep(step)) return;
    goto(Math.min(4, step + 1) as Step);
  }

  function back() {
    if (step === 0) {
      router.push("/");
      return;
    }
    goto(Math.max(0, step - 1) as Step);
  }

  /**
   * The logo is uploaded before the project exists, so it is staged against a
   * scratch project id and adopted on create. That keeps the upload where the
   * requirement asks for it — directly under the business name.
   */
  async function uploadLogo(file: File | null | undefined) {
    if (!file) return;
    setLogoBusy(true);
    setFormError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("role", "logo");
      body.append("alt", form.businessName || file.name);
      const res = await fetch("/api/staging/logo", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "That logo could not be uploaded.");
        return;
      }
      setLogo({ id: data.asset.id, url: `/api/assets/${data.asset.id}?w=240`, name: file.name });
    } catch {
      setFormError("Could not upload the logo. Check your connection and try again.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function submit() {
    if (!validateStep(0) || !validateStep(1)) {
      goto(0);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, logoAssetId: logo?.id ?? "" }),
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
      <AppBar title={STEP_TITLES[step]} subtitle={`Step ${step + 1} of 5`} back={true} />

      <div
        className="mt-2 mb-5 flex gap-1.5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={step + 1}
        aria-label={`Step ${step + 1} of 5: ${STEP_TITLES[step]}`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-brand" : "bg-elevated"}`} />
        ))}
      </div>

      {formError && <Banner tone="error">{formError}</Banner>}

      {step === 0 && (
        <section aria-labelledby="step-0">
          <h2 id="step-0" className="sr-only">Your business</h2>

          <Field label="Business name" error={errors.businessName}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id} aria-describedby={describedBy} invalid={invalid}
                value={form.businessName}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder="Caffè Verde" autoCapitalize="words" enterKeyHint="next" autoFocus
              />
            )}
          </Field>

          {/* Requirement 20: logo upload sits directly below the business name. */}
          <fieldset className="mb-4">
            <legend className="mb-1.5 text-sm font-semibold">Logo</legend>
            <p className="mb-2 text-xs text-muted">
              Optional. PNG, JPG, WebP or SVG. It shapes the colours and personality
              of the design, and becomes your favicon.
            </p>
            <input
              ref={logoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
              className="hidden"
              onChange={(e) => {
                void uploadLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {logo ? (
              <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logo.url} alt={`${form.businessName || "Business"} logo`}
                  className="h-12 w-12 shrink-0 object-contain" />
                <span className="min-w-0 flex-1 truncate text-sm">{logo.name}</span>
                <button
                  type="button"
                  onClick={() => setLogo(null)}
                  aria-label="Remove logo"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-danger active:bg-elevated"
                >
                  <IconTrash size={18} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={logoBusy}
                onClick={() => logoInput.current?.click()}
                className="flex min-h-[var(--spacing-touch-lg)] w-full items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm font-semibold text-brand active:bg-elevated disabled:opacity-50"
              >
                <IconImage size={18} /> {logoBusy ? "Uploading…" : "Add a logo"}
              </button>
            )}
          </fieldset>

          <Field label="What kind of business is it?" hint="For example: coffee shop, barber, dentist, bakery.">
            {({ id }) => (
              <TextInput id={id} value={form.businessType}
                onChange={(e) => set("businessType", e.target.value)}
                placeholder="Coffee shop" autoCapitalize="sentences" enterKeyHint="next" />
            )}
          </Field>

          <Field
            label="Describe the business"
            hint="A sentence or two in your own words. Used alongside research to write the copy."
          >
            {({ id }) => (
              <TextArea id={id} rows={5} value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Small independent coffee shop near the station. We roast our own beans and bake everything in-house."
                autoCapitalize="sentences" enterKeyHint="done" />
            )}
          </Field>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="step-1">
          <h2 id="step-1" className="sr-only">Location and contact</h2>

          <Field
            label="Google Maps link"
            hint="Open Google Maps, tap Share, then paste the link. We research the business from it."
            error={errors.mapsUrl}
          >
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
                type="url" inputMode="url" value={form.mapsUrl}
                onChange={(e) => set("mapsUrl", e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
            )}
          </Field>

          {maps.valid && (
            <p className="-mt-2 mb-4 flex items-start gap-1.5 text-xs font-medium text-success">
              <IconCheck size={16} />
              <span>{maps.placeName ? `Recognised: ${maps.placeName}` : "Google Maps link recognised."}</span>
            </p>
          )}

          <Field label="Town or city" error={errors.location}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
                value={form.location} onChange={(e) => set("location", e.target.value)}
                placeholder="Thessaloniki" autoCapitalize="words" enterKeyHint="next" />
            )}
          </Field>

          <Field label="Phone" hint="Used for the tap-to-call button.">
            {({ id }) => (
              <TextInput id={id} type="tel" inputMode="tel" value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+30 231 000 0000" autoComplete="tel" enterKeyHint="next" />
            )}
          </Field>

          <Field label="Email" error={errors.email}>
            {({ id, describedBy, invalid }) => (
              <TextInput id={id} aria-describedby={describedBy} invalid={invalid}
                type="email" inputMode="email" value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="hello@business.com" autoComplete="email"
                autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" />
            )}
          </Field>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="step-2">
          <h2 id="step-2" className="mb-3 text-sm font-semibold">What should we build?</h2>
          <div role="radiogroup" aria-labelledby="step-2" className="grid gap-2.5">
            {SITE_KINDS.map((k) => {
              const active = form.siteKind === k.id;
              return (
                <button
                  key={k.id} type="button" role="radio" aria-checked={active}
                  onClick={() => set("siteKind", k.id)}
                  className={`flex min-h-[var(--spacing-touch-lg)] items-center gap-3 rounded-card border p-4 text-left active:scale-[0.99] ${
                    active ? "border-brand bg-brand-soft" : "border-line bg-surface"
                  }`}
                >
                  <span aria-hidden="true" className="text-2xl">{k.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{k.label}</span>
                    <span className="block text-sm text-muted">{k.blurb}</span>
                  </span>
                  {active && <span className="text-brand"><IconCheck size={20} /></span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="step-3">
          <h2 id="step-3" className="mb-1.5 text-sm font-semibold">Languages</h2>
          <p className="mb-4 text-sm text-muted">
            Pick the main language your website is written in. Add more and
            visitors get a language switcher on the site itself. You can change
            this at any time later.
          </p>

          <Field label="Main language">
            {({ id }) => (
              <div id={id} role="radiogroup" aria-label="Main language" className="snap-rail no-scrollbar -mx-4 px-4 pb-1">
                {LOCALES.slice(0, 8).map((l) => {
                  const active = form.defaultLocale === l.code;
                  return (
                    <button
                      key={l.code} type="button" role="radio" aria-checked={active}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          defaultLocale: l.code,
                          locales: [l.code, ...f.locales.filter((x) => x !== l.code)],
                        }))
                      }
                      className={`flex min-h-[var(--spacing-touch)] items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
                        active ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface text-muted"
                      }`}
                    >
                      <span aria-hidden="true">{l.flag}</span> {l.english}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <fieldset className="mb-4">
            <legend className="mb-1.5 text-sm font-semibold">Also translate into</legend>
            <p className="mb-2 text-xs text-muted">Optional. Each one adds a language to the switcher.</p>
            <div className="grid grid-cols-2 gap-2">
              {LOCALES.filter((l) => l.code !== form.defaultLocale)
                .slice(0, 8)
                .map((l) => {
                  const on = form.locales.includes(l.code);
                  return (
                    <button
                      key={l.code} type="button" role="checkbox" aria-checked={on}
                      onClick={() =>
                        set(
                          "locales",
                          on
                            ? form.locales.filter((x) => x !== l.code)
                            : [...form.locales, l.code],
                        )
                      }
                      className={`flex min-h-[var(--spacing-touch)] items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium ${
                        on ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface"
                      }`}
                    >
                      <span aria-hidden="true">{l.flag}</span>
                      <span className="min-w-0 flex-1 truncate">{l.english}</span>
                      {on && <IconCheck size={16} />}
                    </button>
                  );
                })}
            </div>
          </fieldset>

          <p className="rounded-xl bg-elevated px-3 py-2 text-xs text-muted">
            {form.locales.length > 1
              ? `${form.locales.length} languages. Visitors will see a switcher; the design stays identical in each.`
              : `One language — no switcher will be shown. You can add languages later without regenerating the site.`}
          </p>
        </section>
      )}

      {step === 4 && (
        <section aria-labelledby="step-4">
          <h2 id="step-4" className="mb-1.5 text-sm font-semibold">Pick a starting look</h2>
          <p className="mb-4 text-sm text-muted">
            A starting point only. Your business is researched and the design is
            chosen to suit it — you can change everything afterwards.
          </p>
          <div role="radiogroup" aria-labelledby="step-4" className="grid grid-cols-2 gap-2.5">
            {STYLE_OPTIONS.map((s) => {
              const active = form.style === s.id;
              return (
                <button
                  key={s.id} type="button" role="radio" aria-checked={active}
                  onClick={() => set("style", s.id)}
                  className={`min-h-[var(--spacing-touch-lg)] rounded-card border p-3 text-left active:scale-[0.99] ${
                    active ? "border-brand bg-brand-soft" : "border-line bg-surface"
                  }`}
                >
                  <span className="mb-2 flex gap-1" aria-hidden="true">
                    {s.swatches.map((c) => (
                      <span key={c} className="size-4 rounded-full border border-black/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="block font-semibold">{s.label}</span>
                  <span className="block text-xs text-muted">{s.hint}</span>
                </button>
              );
            })}
          </div>

          <Field
            label="Anything specific you want?"
            hint="Optional. For example: “stone and olive tones”, “feels like a family taverna”, “no photos of people”."
          >
            {({ id }) => (
              <TextArea id={id} rows={3} className="mt-4" value={form.designNotes}
                onChange={(e) => set("designNotes", e.target.value)}
                autoCapitalize="sentences" enterKeyHint="done" />
            )}
          </Field>
        </section>
      )}

      {/* Sticky action bar: the primary action is always under the thumb and
          always clear of the home indicator and the bottom tab bar. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 px-4 pt-3 backdrop-blur-lg md:pl-60"
        style={{ paddingBottom: "calc(0.75rem + var(--safe-bottom) + var(--bottomnav-h))" }}
      >
        <div className="mx-auto flex max-w-3xl gap-3 lg:max-w-5xl">
          <Button variant="secondary" size="lg" onClick={back} className="flex-1">
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < 4 ? (
            <Button size="lg" onClick={next} className="flex-[2]">Continue</Button>
          ) : (
            <Button size="lg" onClick={submit} loading={busy} className="flex-[2]">
              Generate website
            </Button>
          )}
        </div>
      </div>
      <div aria-hidden="true" className="h-32" />
    </AppShell>
  );
}
