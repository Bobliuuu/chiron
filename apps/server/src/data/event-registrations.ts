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

export async function registrationsByProfile(
  profileId: string,
): Promise<EventRegistration[]> {
  const db = getSupabaseAdmin();
  if (!db) {
    return [...mockRegistrations.values()]
      .filter((r) => r.profile_id === profileId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`registrationsByProfile failed: ${error.message}`);
  return (data ?? []) as EventRegistration[];
}

export async function getEventRegistration(
  id: string,
): Promise<EventRegistration | null> {
  const db = getSupabaseAdmin();
  if (!db) {
    return (
      [...mockRegistrations.values()].find((r) => r.id === id) ?? null
    );
  }

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getEventRegistration failed: ${error.message}`);
  return (data as EventRegistration | null) ?? null;
}

/** Editable subset of a registration (everything identity-ish stays fixed). */
export type EventRegistrationPatch = Partial<
  Pick<
    EventRegistration,
    | "status"
    | "attendee_name"
    | "contact_email"
    | "contact_phone"
    | "accessibility_requests"
    | "notes"
    | "form_response"
  >
>;

export async function updateEventRegistration(
  id: string,
  patch: EventRegistrationPatch,
): Promise<EventRegistration> {
  const db = getSupabaseAdmin();
  if (!db) {
    const existing = [...mockRegistrations.entries()].find(
      ([, r]) => r.id === id,
    );
    if (!existing) throw new Error(`updateEventRegistration failed: ${id} not found`);
    const [key, reg] = existing;
    const next: EventRegistration = {
      ...reg,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    mockRegistrations.set(key, next);
    return next;
  }

  const { data, error } = await db
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(`updateEventRegistration failed: ${error.message}`);
  return data as EventRegistration;
}

export async function deleteEventRegistration(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) {
    for (const [key, r] of mockRegistrations.entries()) {
      if (r.id === id) mockRegistrations.delete(key);
    }
    return;
  }

  const { error } = await db.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(`deleteEventRegistration failed: ${error.message}`);
}
