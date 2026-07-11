"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";

export function AuthScreen() {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);

    const authError =
      mode === "signin"
        ? await signIn(email, password)
        : await signUp(email, password);

    if (authError) {
      setError(authError);
      setStatus("idle");
      return;
    }

    setStatus(mode === "signup" ? "sent" : "idle");
  }

  if (!configured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">
            Supabase auth is not configured
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Add `NEXT_PUBLIC_SUPABASE_URL` and
            `NEXT_PUBLIC_SUPABASE_ANON_KEY` to your web environment, then
            restart the Next.js dev server.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            {mode === "signin" ? "Sign in to Chiron" : "Create your Chiron account"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Use your account to save your profile, registrations, and event
            publishing work.
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Email
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className={inputCls}
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            required
            className={inputCls}
          />
        </label>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {error}
          </p>
        )}

        {status === "sent" && (
          <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            Check your email to confirm your account, then sign in.
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === "submitting"
            ? "Working..."
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
            setStatus("idle");
          }}
          className="mt-4 w-full text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500";
