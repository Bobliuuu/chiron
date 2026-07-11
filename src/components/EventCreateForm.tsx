"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  type EventCategory,
  type EventDraft,
  type EventRecord,
} from "@/lib/types/events";
import { toDatetimeLocal } from "@/lib/format";

// The event-creation "page" surfaced inline in chat, prefilled from the agent's
// draft. The nonprofit reviews, edits, and submits — keeping a human in control
// of what gets published.

interface FormState {
  title: string;
  summary: string;
  description: string;
  category: EventCategory;
  start_time: string; // datetime-local
  end_time: string;
  is_online: boolean;
  online_url: string;
  location_name: string;
  address: string;
  city: string;
  is_free: boolean;
  cost_note: string;
  audience: string;
  accessibility: string;
  transportation: string;
  registration_url: string;
  registration_instructions: string;
  host_organization: string;
}

function fromDraft(d: EventDraft): FormState {
  return {
    title: d.title ?? "",
    summary: d.summary ?? "",
    description: d.description ?? "",
    category: (d.category as EventCategory) ?? "other",
    start_time: toDatetimeLocal(d.start_time),
    end_time: toDatetimeLocal(d.end_time),
    is_online: d.is_online ?? false,
    online_url: d.online_url ?? "",
    location_name: d.location_name ?? "",
    address: d.address ?? "",
    city: d.city ?? "",
    is_free: d.is_free ?? true,
    cost_note: d.cost_note ?? "",
    audience: d.audience ?? "",
    accessibility: (d.accessibility ?? []).join(", "),
    transportation: d.transportation ?? "",
    registration_url: d.registration_url ?? "",
    registration_instructions: d.registration_instructions ?? "",
    host_organization: d.host_organization ?? "",
  };
}

export function EventCreateForm({
  draft,
  onCreated,
}: {
  draft: EventDraft;
  onCreated: (event: EventRecord) => void;
}) {
  const [form, setForm] = useState<FormState>(() => fromDraft(draft));
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    const payload = {
      ...form,
      start_time: form.start_time
        ? new Date(form.start_time).toISOString()
        : "",
      end_time: form.end_time ? new Date(form.end_time).toISOString() : null,
      accessibility: form.accessibility
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data?.error ?? "Something went wrong.");
        return;
      }
      setStatus("done");
      onCreated(data.event as EventRecord);
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        ✓ Published “{form.title || "your event"}”. It now appears in the
        upcoming events list and can be recommended to the community.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm"
      aria-label="Create event"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">
          Review &amp; publish event
        </h3>
        <span className="text-xs text-slate-400">Prefilled by Chiron</span>
      </div>

      <Field label="Title" required>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Charity Fundraiser Gala"
          required
        />
      </Field>

      <Field label="Short summary" required hint="One plain-language sentence.">
        <input
          className={inputCls}
          value={form.summary}
          onChange={(e) => set("summary", e.target.value)}
          placeholder="What is this event, in one line?"
          required
        />
      </Field>

      <Field label="Description">
        <textarea
          className={inputCls}
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            className={inputCls}
            value={form.category}
            onChange={(e) => set("category", e.target.value as EventCategory)}
          >
            {EVENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hosting organization">
          <input
            className={inputCls}
            value={form.host_organization}
            onChange={(e) => set("host_organization", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" required>
          <input
            type="datetime-local"
            className={inputCls}
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            required
          />
        </Field>
        <Field label="Ends">
          <input
            type="datetime-local"
            className={inputCls}
            value={form.end_time}
            onChange={(e) => set("end_time", e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={form.is_online}
          onChange={(e) => set("is_online", e.target.checked)}
        />
        This is an online event
      </label>

      {form.is_online ? (
        <Field label="Online link">
          <input
            className={inputCls}
            value={form.online_url}
            onChange={(e) => set("online_url", e.target.value)}
            placeholder="https://…"
          />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location name">
            <input
              className={inputCls}
              value={form.location_name}
              onChange={(e) => set("location_name", e.target.value)}
            />
          </Field>
          <Field label="City">
            <input
              className={inputCls}
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <Field label="Address" className="col-span-2">
            <input
              className={inputCls}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.is_free}
            onChange={(e) => set("is_free", e.target.checked)}
          />
          Free to attend
        </label>
        {!form.is_free && (
          <input
            className={`${inputCls} flex-1`}
            value={form.cost_note}
            onChange={(e) => set("cost_note", e.target.value)}
            placeholder="e.g. $10 suggested donation"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Audience">
          <input
            className={inputCls}
            value={form.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder="e.g. families, seniors 55+"
          />
        </Field>
        <Field label="Accessibility" hint="Comma-separated">
          <input
            className={inputCls}
            value={form.accessibility}
            onChange={(e) => set("accessibility", e.target.value)}
            placeholder="wheelchair, asl"
          />
        </Field>
      </div>

      <Field label="Transportation notes">
        <input
          className={inputCls}
          value={form.transportation}
          onChange={(e) => set("transportation", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Registration link">
          <input
            className={inputCls}
            value={form.registration_url}
            onChange={(e) => set("registration_url", e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="Registration instructions">
          <input
            className={inputCls}
            value={form.registration_instructions}
            onChange={(e) => set("registration_instructions", e.target.value)}
          />
        </Field>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === "saving" ? "Publishing…" : "Publish event"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500";

function Field({
  label,
  children,
  required,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
        {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
