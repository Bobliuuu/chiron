import { getSupabaseAdmin } from "./client";
import { randomUUID } from "node:crypto";
import type {
  EventRegistrationForm,
  EventRegistrationFormInput,
  EventRegistrationFormSchema,
  RegistrationFormField,
} from "@chiron/shared";

const TABLE = "event_registration_forms";

const DEFAULT_SCHEMA: EventRegistrationFormSchema = {
  fields: [],
  stripe: { enabled: false, currency: "cad", price_cents: null },
};

const mockForms = new Map<string, EventRegistrationForm>();

export function defaultRegistrationFormSchema(): EventRegistrationFormSchema {
  return DEFAULT_SCHEMA;
}

export async function getEventRegistrationForm(
  eventId: string,
): Promise<EventRegistrationForm | null> {
  const db = getSupabaseAdmin();

  if (!db) return mockForms.get(eventId) ?? null;

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) throw new Error(`getEventRegistrationForm failed: ${error.message}`);
  return (data as EventRegistrationForm | null) ?? null;
}

export async function upsertEventRegistrationForm(
  input: EventRegistrationFormInput,
): Promise<EventRegistrationForm> {
  const schema = sanitizeRegistrationFormSchema(input.schema);
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (!db) {
    const existing = mockForms.get(input.event_id);
    const form: EventRegistrationForm = {
      id: existing?.id ?? randomUUID(),
      event_id: input.event_id,
      schema,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    mockForms.set(input.event_id, form);
    return form;
  }

  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        event_id: input.event_id,
        schema,
      },
      { onConflict: "event_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`upsertEventRegistrationForm failed: ${error.message}`);
  }
  return data as EventRegistrationForm;
}

export function sanitizeRegistrationFormSchema(
  raw: unknown,
): EventRegistrationFormSchema {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SCHEMA;
  const input = raw as Record<string, unknown>;
  const fields = Array.isArray(input.fields)
    ? input.fields.map(sanitizeField).filter((f): f is RegistrationFormField => !!f)
    : [];
  const stripe =
    typeof input.stripe === "object" && input.stripe !== null
      ? input.stripe as Record<string, unknown>
      : {};

  return {
    fields: fields.slice(0, 20),
    stripe: {
      enabled: stripe.enabled === true,
      price_cents:
        typeof stripe.price_cents === "number" &&
        Number.isInteger(stripe.price_cents) &&
        stripe.price_cents > 0
          ? stripe.price_cents
          : null,
      currency:
        typeof stripe.currency === "string" && stripe.currency.trim()
          ? stripe.currency.trim().toLowerCase()
          : "cad",
      price_label:
        typeof stripe.price_label === "string" && stripe.price_label.trim()
          ? stripe.price_label.trim()
          : null,
    },
  };
}

function sanitizeField(raw: unknown): RegistrationFormField | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;
  const id = typeof f.id === "string" ? f.id.trim() : "";
  const label = typeof f.label === "string" ? f.label.trim() : "";
  const type = f.type;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !label) return null;
  if (
    type !== "text" &&
    type !== "textarea" &&
    type !== "select" &&
    type !== "checkbox"
  ) {
    return null;
  }

  return {
    id,
    label,
    type,
    required: f.required === true,
    options: Array.isArray(f.options)
      ? f.options.map(String).map((o) => o.trim()).filter(Boolean).slice(0, 20)
      : undefined,
    placeholder:
      typeof f.placeholder === "string" && f.placeholder.trim()
        ? f.placeholder.trim()
        : null,
  };
}
