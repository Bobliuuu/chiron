"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  EVENT_REGISTRATION_FIELDS,
  fieldSpec,
  type EventRegistration,
  type EventRegistrationFormSchema,
  type EventRegistrationInput,
  type JsonObject,
  type PublicEvent,
  type RegistrationFormField,
} from "@chiron/shared";
import { formatDateTime } from "@/lib/format";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Built-in field copy comes from the shared EVENT_REGISTRATION_FIELDS template.
const rf = (id: string) => fieldSpec(EVENT_REGISTRATION_FIELDS, id);
const rLabel = (id: string) => rf(id)?.label ?? id;
const rPlaceholder = (id: string) => rf(id)?.placeholder ?? undefined;

interface RegistrationFormState {
  attendee_name: string;
  contact_email: string;
  contact_phone: string;
  accessibility_requests: string;
  notes: string;
}

const DEFAULT_SCHEMA: EventRegistrationFormSchema = {
  fields: [],
  stripe: { enabled: false, currency: "cad", price_cents: null },
};

export function EventRegistrationForm({
  event,
  profileId,
  onSaved,
}: {
  event: PublicEvent;
  profileId: string;
  onSaved?: (registration: EventRegistration) => void;
}) {
  const { authFetch, user } = useAuth();
  const [form, setForm] = useState<RegistrationFormState>({
    attendee_name: "",
    contact_email: "",
    contact_phone: "",
    accessibility_requests: "",
    notes: "",
  });
  const prefilledRef = useRef(false);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] =
    useState<EventRegistrationFormSchema>(DEFAULT_SCHEMA);
  const [registrationFormId, setRegistrationFormId] = useState<string | null>(
    null,
  );
  const [formResponse, setFormResponse] = useState<JsonObject>({});
  const interestSavedRef = useRef(false);

  useEffect(() => {
    if (interestSavedRef.current) return;
    interestSavedRef.current = true;

    const payload: EventRegistrationInput = {
      event_id: event.id,
      profile_id: profileId,
      status: "interested",
      event_snapshot: event,
    };

    void authFetch(apiUrl("/api/event-registrations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [authFetch, event, profileId]);

  useEffect(() => {
    let cancelled = false;

    async function loadForm() {
      try {
        const res = await fetch(
          apiUrl(`/api/events/${event.id}/registration-form`),
        );
        const data = await res.json();
        if (!cancelled && res.ok && data.form?.schema) {
          setRegistrationFormId(
            typeof data.form.id === "string" ? data.form.id : null,
          );
          setSchema(data.form.schema as EventRegistrationFormSchema);
        }
      } catch {
        if (!cancelled) setSchema(DEFAULT_SCHEMA);
      }
    }

    void loadForm();
    return () => {
      cancelled = true;
    };
  }, [event.id]);

  // Prefill from what Chiron already knows about this user — their name and
  // phone from the profile ontology, plus the signed-in email. This is the
  // "reuse across events" behavior: any event's form opens pre-filled, and
  // whatever the user types is remembered (server-side) for the next event.
  useEffect(() => {
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    const email = user?.email ?? "";

    async function prefill() {
      let fullName = "";
      let phone = "";
      try {
        const res = await authFetch(apiUrl(`/api/profile?id=${profileId}`));
        if (res.ok) {
          const data = await res.json();
          fullName = (data.profile?.full_name as string | null) ?? "";
          phone = (data.profile?.contact_phone as string | null) ?? "";
        }
      } catch {
        // No profile / offline — fall back to the signed-in email only.
      }
      setForm((f) => ({
        ...f,
        attendee_name: f.attendee_name || fullName,
        contact_email: f.contact_email || email,
        contact_phone: f.contact_phone || phone,
      }));
    }

    void prefill();
  }, [authFetch, user?.email, profileId]);

  const set = <K extends keyof RegistrationFormState>(
    key: K,
    value: RegistrationFormState[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setError(null);

    const payload: EventRegistrationInput = {
      event_id: event.id,
      profile_id: profileId,
      registration_form_id: registrationFormId,
      status: "registered",
      attendee_name: form.attendee_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      accessibility_requests: form.accessibility_requests || null,
      notes: form.notes || null,
      form_response: formResponse,
      event_snapshot: event,
    };

    try {
      const res = await authFetch(apiUrl("/api/event-registrations"), {
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
      onSaved?.(data.registration as EventRegistration);
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        Registration saved for {event.title}.
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3 dark:border-brand-900 dark:bg-slate-800/70"
      aria-label={`Register for ${event.title}`}
    >
      <div>
        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Register for this event
        </h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {formatDateTime(event.start_time)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={rLabel("attendee_name")} required>
          <input
            className={inputCls}
            value={form.attendee_name}
            onChange={(e) => set("attendee_name", e.target.value)}
            autoComplete="name"
            required
          />
        </Field>
        <Field label={rLabel("contact_email")} required>
          <input
            type="email"
            className={inputCls}
            value={form.contact_email}
            onChange={(e) => set("contact_email", e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
      </div>

      <Field label={rLabel("contact_phone")}>
        <input
          type="tel"
          className={inputCls}
          value={form.contact_phone}
          onChange={(e) => set("contact_phone", e.target.value)}
          autoComplete="tel"
        />
      </Field>

      <Field label={rLabel("accessibility_requests")}>
        <input
          className={inputCls}
          value={form.accessibility_requests}
          onChange={(e) => set("accessibility_requests", e.target.value)}
          placeholder={rPlaceholder("accessibility_requests")}
        />
      </Field>

      <Field label={rLabel("notes")}>
        <textarea
          className={inputCls}
          rows={2}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      {schema.fields.length > 0 && (
        <div className="space-y-3 border-t border-brand-100 pt-3 dark:border-brand-900">
          {schema.fields.map((field) => (
            <CustomField
              key={field.id}
              field={field}
              value={formResponse[field.id]}
              onChange={(value) =>
                setFormResponse((prev) => ({ ...prev, [field.id]: value }))
              }
            />
          ))}
        </div>
      )}

      {schema.stripe?.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Payment collection is marked for this event, but Stripe checkout is not
          wired up yet.
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === "saving" ? "Saving..." : "Save registration"}
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
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

function CustomField({
  field,
  value,
  onChange,
}: {
  field: RegistrationFormField;
  value: unknown;
  onChange: (value: string | boolean) => void;
}) {
  if (field.type === "checkbox") {
    return (
      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          required={field.required}
          className="mt-0.5"
        />
        <span>
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </span>
      </label>
    );
  }

  return (
    <Field label={field.label} required={field.required}>
      {field.type === "textarea" ? (
        <textarea
          className={inputCls}
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          required={field.required}
        />
      ) : field.type === "select" ? (
        <select
          className={inputCls}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        >
          <option value="">Select...</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={inputCls}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          required={field.required}
        />
      )}
    </Field>
  );
}
