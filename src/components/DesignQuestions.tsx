"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, BottomSheet, Button, Card } from "./ui";
import { IconSparkles } from "./icons";

export type DesignQuestion = { id: string; question: string; options: string[] };

/**
 * Surfaces the design questions the identity analysis could not settle
 * (requirement 7).
 *
 * Shown only when there are questions — no busywork when the business
 * information was already sufficient. Answering re-runs the design stage
 * alone, so copy and translations survive untouched.
 */
export function DesignQuestions({
  projectId,
  questions,
}: {
  projectId: string;
  questions: DesignQuestion[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!questions.length) return null;

  const answered = questions.filter((q) => answers[q.question]).length;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/design-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not update the design.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="my-4 border-brand/40">
        <h2 className="flex items-center gap-2 font-bold text-brand">
          <IconSparkles size={18} />
          {questions.length} question{questions.length === 1 ? "" : "s"} about the design
        </h2>
        <p className="mt-1.5 text-sm text-muted">
          A few design decisions could not be settled from the business alone.
          Answering sharpens the look — your text and translations are kept
          exactly as they are.
        </p>
        <Button block className="mt-3" onClick={() => setOpen(true)}>
          Answer {questions.length} question{questions.length === 1 ? "" : "s"}
        </Button>
      </Card>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Design questions"
        footer={
          <Button size="lg" block loading={busy} disabled={answered === 0} onClick={submit}>
            {answered === 0
              ? "Pick at least one answer"
              : `Apply ${answered} answer${answered === 1 ? "" : "s"}`}
          </Button>
        }
      >
        {error && <Banner tone="error">{error}</Banner>}
        <p className="mb-4 text-sm text-muted">
          Only the design changes. Your copy, images and every language stay put.
        </p>

        <div className="space-y-5 pb-2">
          {questions.map((q) => (
            <fieldset key={q.id}>
              <legend className="mb-2 text-sm font-semibold">{q.question}</legend>
              <div role="radiogroup" aria-label={q.question} className="grid gap-2">
                {q.options.map((option) => {
                  const active = answers[q.question] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAnswers((a) => ({ ...a, [q.question]: option }))}
                      className={`min-h-[var(--spacing-touch-lg)] rounded-card border px-4 text-left text-sm font-medium ${
                        active ? "border-brand bg-brand-soft text-brand" : "border-line bg-surface"
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
