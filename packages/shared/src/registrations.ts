import type { PublicEvent } from "./events";

export type EventRegistrationStatus = "interested" | "registered";

export type RegistrationFieldType = "text" | "textarea" | "select" | "checkbox";

export type JsonObject = Record<string, unknown>;

export interface RegistrationFormField {
  id: string;
  label: string;
  type: RegistrationFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string | null;
}

export interface RegistrationFormStripeConfig {
  enabled: boolean;
  price_cents?: number | null;
  currency?: string;
  price_label?: string | null;
}

export interface EventRegistrationFormSchema {
  fields: RegistrationFormField[];
  stripe?: RegistrationFormStripeConfig;
}

export interface EventRegistrationForm {
  id: string;
  event_id: string;
  schema: EventRegistrationFormSchema;
  created_at: string;
  updated_at: string;
}

export interface EventRegistrationFormInput {
  event_id: string;
  schema: EventRegistrationFormSchema;
}

/** A persisted event registration/interest row. */
export interface EventRegistration {
  id: string;
  event_id: string;
  profile_id: string;
  registration_form_id: string | null;
  status: EventRegistrationStatus;
  attendee_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  accessibility_requests: string | null;
  notes: string | null;
  form_response: JsonObject;
  event_snapshot: PublicEvent | null;
  created_at: string;
  updated_at: string;
}

/** Fields the web registration form may submit. */
export interface EventRegistrationInput {
  event_id: string;
  profile_id: string;
  registration_form_id?: string | null;
  status?: EventRegistrationStatus;
  attendee_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  accessibility_requests?: string | null;
  notes?: string | null;
  form_response?: JsonObject;
  event_snapshot?: PublicEvent | null;
}
