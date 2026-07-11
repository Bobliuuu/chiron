"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  EVENT_CREATE_FIELDS,
  fieldSpec,
  type EventCategory,
  type EventDraft,
  type PublicEvent,
} from "@chiron/shared";
import { toDatetimeLocal } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Field copy (labels/placeholders/hints/options) comes from the shared
// EVENT_CREATE_FIELDS template — the same spec the agent's draft_event tool is
// generated from — so this form and the AI's draft can never drift apart.
const cf = (id: string) => fieldSpec(EVENT_CREATE_FIELDS, id);
const cLabel = (id: string) => cf(id)?.label ?? id;
const cPlaceholder = (id: string) => cf(id)?.placeholder ?? undefined;
const cHint = (id: string) => cf(id)?.hint ?? undefined;
const CATEGORY_OPTS = cf("category")?.options ?? [];

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
  event,
}: {
  draft: EventDraft;
  onCreated: (event: PublicEvent) => void;
  /** When set, the form edits this existing event (PATCH) instead of creating. */
  event?: PublicEvent;
}) {
  const { authFetch } = useAuth();
  const isEdit = Boolean(event);
  const [form, setForm] = useState<FormState>(() =>
    fromDraft(event ? (event as EventDraft) : draft),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(
    event?.image_url ?? null,
  );
  const [imageStatus, setImageStatus] = useState<
    "none" | "uploading" | "done" | "error"
  >("none");

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    setImageStatus("uploading");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await authFetch(apiUrl("/api/upload"), { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error);
      setImageUrl(data.url as string);
      setImageStatus("done");
    } catch {
      setImageUrl(null);
      setImageStatus("error");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    const payload = {
      ...form,
      image_url: imageUrl,
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
      const res = await authFetch(
        apiUrl(isEdit ? `/api/events/${event!.id}` : "/api/events"),
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data?.error ?? "Something went wrong.");
        return;
      }
      setStatus("done");
      onCreated(data.event as PublicEvent);
    } catch {
      setStatus("error");
      setError("Network error — please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        {isEdit
          ? `✓ Saved changes to “${form.title || "your event"}”.`
          : `✓ Published “${form.title || "your event"}”. It now appears in the upcoming events list and can be recommended to the community.`}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-brand-100 bg-white p-4 shadow-sm dark:border-brand-900 dark:bg-slate-900"
      aria-label="Create event"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {isEdit ? "Edit event" : "Review & publish event"}
        </h3>
        {!isEdit && (
          <span className="text-xs text-slate-400 dark:text-slate-500">Prefilled by Chiron</span>
        )}
      </div>

      <Field label={cLabel("title")} required>
        <input
          className={inputCls}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={cPlaceholder("title")}
          required
        />
      </Field>

      <Field label={cLabel("summary")} required hint={cHint("summary")}>
        <input
          className={inputCls}
          value={form.summary}
          onChange={(e) => set("summary", e.target.value)}
          placeholder={cPlaceholder("summary")}
          required
        />
      </Field>

      <Field label={cLabel("description")}>
        <textarea
          className={inputCls}
          rows={3}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={cLabel("category")}>
          <select
            className={inputCls}
            value={form.category}
            onChange={(e) => set("category", e.target.value as EventCategory)}
          >
            {CATEGORY_OPTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={cLabel("host_organization")}>
          <input
            className={inputCls}
            value={form.host_organization}
            onChange={(e) => set("host_organization", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={cLabel("start_time")} required>
          <input
            type="datetime-local"
            className={inputCls}
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            required
          />
        </Field>
        <Field label={cLabel("end_time")}>
          <input
            type="datetime-local"
            className={inputCls}
            value={form.end_time}
            onChange={(e) => set("end_time", e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={form.is_online}
          onChange={(e) => set("is_online", e.target.checked)}
        />
        {cLabel("is_online")}
      </label>

      {form.is_online ? (
        <Field label={cLabel("online_url")}>
          <input
            className={inputCls}
            value={form.online_url}
            onChange={(e) => set("online_url", e.target.value)}
            placeholder={cPlaceholder("online_url")}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={cLabel("location_name")}>
            <input
              className={inputCls}
              value={form.location_name}
              onChange={(e) => set("location_name", e.target.value)}
            />
          </Field>
          <Field label={cLabel("city")}>
            <input
              className={inputCls}
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <Field label={cLabel("address")} className="col-span-2">
            <input
              className={inputCls}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={form.is_free}
            onChange={(e) => set("is_free", e.target.checked)}
          />
          {cLabel("is_free")}
        </label>
        {!form.is_free && (
          <input
            className={`${inputCls} flex-1`}
            value={form.cost_note}
            onChange={(e) => set("cost_note", e.target.value)}
            placeholder={cPlaceholder("cost_note")}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={cLabel("audience")}>
          <input
            className={inputCls}
            value={form.audience}
            onChange={(e) => set("audience", e.target.value)}
            placeholder={cPlaceholder("audience")}
          />
        </Field>
        <Field label={cLabel("accessibility")} hint={cHint("accessibility")}>
          <input
            className={inputCls}
            value={form.accessibility}
            onChange={(e) => set("accessibility", e.target.value)}
            placeholder={cPlaceholder("accessibility")}
          />
        </Field>
      </div>

      <Field
        label="Event image"
        hint="Optional — shown on the event card (max 5 MB)."
      >
        <input
          type="file"
          accept="image/*"
          className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-950 dark:file:text-brand-200"
          onChange={(e) => void uploadImage(e.target.files?.[0])}
        />
        {imageStatus === "uploading" && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Uploading…</p>
        )}
        {imageStatus === "error" && (
          <p className="mt-1 text-xs text-red-600">
            Upload failed — the event can still be published without an image.
          </p>
        )}
        {imageStatus === "done" && imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Preview of the uploaded event image"
            className="mt-2 h-28 rounded-lg object-cover"
          />
        )}
      </Field>

      <Field label={cLabel("transportation")}>
        <input
          className={inputCls}
          value={form.transportation}
          onChange={(e) => set("transportation", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={cLabel("registration_url")}>
          <input
            className={inputCls}
            value={form.registration_url}
            onChange={(e) => set("registration_url", e.target.value)}
            placeholder={cPlaceholder("registration_url")}
          />
        </Field>
        <Field label={cLabel("registration_instructions")}>
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
          {status === "saving"
            ? isEdit
              ? "Saving…"
              : "Publishing…"
            : isEdit
              ? "Save changes"
              : "Publish event"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500";

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
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
        {hint && <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
