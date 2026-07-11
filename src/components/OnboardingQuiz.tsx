"use client";

import { useState } from "react";
import { QUIZ_QUESTIONS } from "@/lib/quiz";
import type { Profile } from "@/lib/types/profile";

// The onboarding quiz: one yes/no question per screen with two big buttons.
// Deliberately already in "quick" form — we don't yet know which presentation
// the user needs, so the quiz itself must work for everyone.

interface Props {
  onDone: (profile: Profile | null) => void;
}

export function OnboardingQuiz({ onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = QUIZ_QUESTIONS[index];
  const total = QUIZ_QUESTIONS.length;

  async function answer(value: boolean) {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    if (index + 1 < total) {
      setIndex(index + 1);
      return;
    }
    await submit(next);
  }

  async function submit(finalAnswers: Record<string, boolean>) {
    setSaving(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, answers: finalAnswers }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) {
        throw new Error(data.error ?? "Could not save.");
      }
      onDone(data.profile as Profile);
    } catch {
      setError("Something went wrong. You can try again or skip for now.");
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-question"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <p className="mb-6 text-sm font-medium text-slate-400">
          Question {index + 1} of {total}
        </p>

        <h2
          id="quiz-question"
          className="text-2xl font-semibold leading-snug text-slate-900"
        >
          {question.text}
        </h2>
        {question.detail && (
          <p className="mt-2 text-base text-slate-600">{question.detail}</p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-4">
          <button
            onClick={() => void answer(true)}
            disabled={saving}
            className="rounded-xl bg-brand-600 px-6 py-5 text-xl font-semibold text-white hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-300 disabled:opacity-50"
          >
            Yes
          </button>
          <button
            onClick={() => void answer(false)}
            disabled={saving}
            className="rounded-xl border-2 border-slate-300 bg-white px-6 py-5 text-xl font-semibold text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-4 focus:ring-slate-300 disabled:opacity-50"
          >
            No
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          onClick={() => onDone(null)}
          disabled={saving}
          className="mt-6 text-sm text-slate-400 underline hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
