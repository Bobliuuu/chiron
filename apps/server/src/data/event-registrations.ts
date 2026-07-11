import { getSupabaseAdmin } from "./client";
import { randomUUID } from "node:crypto";
import type {
  EventRegistration,
  EventRegistrationInput,
} from "@chiron/shared";

const TABLE = "event_registrations";

const mockRegistrations = new Map<string, EventRegistration>();

export async function upsertEventRegistration(
  input: EventRegistrationInput,
): Promise<EventRegistration> {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  if (!db) {
    const key = `${input.event_id}:${input.profile_id}`;
    const existing = mockRegistrations.get(key);
    const registration: EventRegistration = {
      id: existing?.id ?? randomUUID(),
      event_id: input.event_id,
      profile_id: input.profile_id,
      registration_form_id: input.registration_form_id ?? null,
      status: input.status ?? "interested",
      attendee_name: input.attendee_name ?? null,
      contact_email: input.contact_email ?? null,
      contact_phone: input.contact_phone ?? null,
      accessibility_requests: input.accessibility_requests ?? null,
      notes: input.notes ?? null,
      form_response: input.form_response ?? {},
      event_snapshot: input.event_snapshot ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    mockRegistrations.set(key, registration);
    return registration;
  }

  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        event_id: input.event_id,
        profile_id: input.profile_id,
        registration_form_id: input.registration_form_id ?? null,
        status: input.status ?? "interested",
        attendee_name: input.attendee_name ?? null,
        contact_email: input.contact_email ?? null,
        contact_phone: input.contact_phone ?? null,
        accessibility_requests: input.accessibility_requests ?? null,
        notes: input.notes ?? null,
        form_response: input.form_response ?? {},
        event_snapshot: input.event_snapshot ?? null,
      },
      { onConflict: "event_id,profile_id" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`upsertEventRegistration failed: ${error.message}`);
  }
  return data as EventRegistration;
}
