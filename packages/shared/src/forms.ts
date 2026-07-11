// Single source of truth for the event forms.
//
// Both the frontend form components (apps/web) AND the agent's tool schemas
// (apps/server) derive their field lists from the specs here, so the AI's
// forms can never drift from the real forms the user fills in. Add a field
// once, in one place, and it flows to both.

import { EVENT_CATEGORIES, CATEGORY_LABELS } from "./events";

export type FormFieldType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "datetime"
  | "url"
  | "tags";

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldSpec {
  id: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  /** One-line clarification shown beside the label in the UI. */
  hint?: string;
  placeholder?: string;
  /** Choices for `select` fields. */
  options?: FormFieldOption[];
  /**
   * Description advertised to the LLM in the generated tool schema.
   * Falls back to `hint` then `label`.
   */
  aiDescription?: string;
  /**
   * Whether the agent may fill this field. `false` keeps it UI-only (never
   * advertised to the model). Defaults to true.
   */
  aiFillable?: boolean;
  /** HTML input type hint for the frontend (e.g. email/tel). */
  htmlType?: "text" | "email" | "tel";
  /** autocomplete token for the frontend input. */
  autoComplete?: string;
}

const CATEGORY_OPTIONS: FormFieldOption[] = EVENT_CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
}));

/**
 * The event-creation form. Mirrors EventCreateForm.tsx (apps/web). The image is
 * handled by a dedicated upload widget and is intentionally NOT part of this
 * spec (the agent can't supply one).
 */
export const EVENT_CREATE_FIELDS: FormFieldSpec[] = [
  {
    id: "title",
    label: "Title",
    type: "text",
    required: true,
    placeholder: "e.g. Charity Fundraiser Gala",
  },
  {
    id: "summary",
    label: "Short summary",
    type: "text",
    required: true,
    hint: "One plain-language sentence.",
    placeholder: "What is this event, in one line?",
    aiDescription: "Plain-language one-liner.",
  },
  { id: "description", label: "Description", type: "textarea" },
  {
    id: "category",
    label: "Category",
    type: "select",
    options: CATEGORY_OPTIONS,
  },
  { id: "host_organization", label: "Hosting organization", type: "text" },
  { id: "start_time", label: "Starts", type: "datetime", required: true },
  { id: "end_time", label: "Ends", type: "datetime" },
  { id: "is_online", label: "This is an online event", type: "checkbox" },
  { id: "online_url", label: "Online link", type: "url", placeholder: "https://…" },
  { id: "location_name", label: "Location name", type: "text" },
  { id: "city", label: "City", type: "text" },
  { id: "address", label: "Address", type: "text" },
  { id: "is_free", label: "Free to attend", type: "checkbox" },
  {
    id: "cost_note",
    label: "Cost note",
    type: "text",
    placeholder: "e.g. $10 suggested donation",
  },
  {
    id: "audience",
    label: "Audience",
    type: "text",
    placeholder: "e.g. families, seniors 55+",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    type: "tags",
    hint: "Comma-separated",
    placeholder: "wheelchair, asl",
  },
  { id: "transportation", label: "Transportation notes", type: "text" },
  {
    id: "registration_url",
    label: "Registration link",
    type: "url",
    placeholder: "https://…",
  },
  {
    id: "registration_instructions",
    label: "Registration instructions",
    type: "text",
  },
];

/**
 * The built-in fields of the event-registration form. Mirrors the fixed part of
 * EventRegistrationForm.tsx (apps/web); event-specific custom fields come from
 * the per-event registration-form schema (see registrations.ts) and are not
 * listed here.
 */
export const EVENT_REGISTRATION_FIELDS: FormFieldSpec[] = [
  {
    id: "attendee_name",
    label: "Name",
    type: "text",
    required: true,
    htmlType: "text",
    autoComplete: "name",
  },
  {
    id: "contact_email",
    label: "Email",
    type: "text",
    required: true,
    htmlType: "email",
    autoComplete: "email",
  },
  {
    id: "contact_phone",
    label: "Phone",
    type: "text",
    htmlType: "tel",
    autoComplete: "tel",
  },
  {
    id: "accessibility_requests",
    label: "Accessibility requests",
    type: "text",
    placeholder: "Anything that would help you attend",
  },
  { id: "notes", label: "Notes", type: "textarea" },
];

export interface ToolParameters {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  /** Index signature so this is assignable to OpenAI's FunctionParameters. */
  [key: string]: unknown;
}

/**
 * Build an OpenAI tool-call `parameters` object from a form spec. By default
 * only `aiFillable` fields are advertised to the model.
 */
export function buildToolParameters(
  fields: FormFieldSpec[],
  opts?: { required?: string[] },
): ToolParameters {
  const properties: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.aiFillable === false) continue;
    properties[f.id] = fieldToJsonSchema(f);
  }
  const params: ToolParameters = { type: "object", properties };
  if (opts?.required?.length) params.required = opts.required;
  return params;
}

function fieldToJsonSchema(f: FormFieldSpec): Record<string, unknown> {
  const description = f.aiDescription ?? f.hint ?? f.label;
  switch (f.type) {
    case "checkbox":
      return { type: "boolean", description };
    case "select":
      return {
        type: "string",
        enum: (f.options ?? []).map((o) => o.value),
        description,
      };
    case "tags":
      return { type: "array", items: { type: "string" }, description };
    case "datetime":
      return {
        type: "string",
        description: f.aiDescription ?? `ISO 8601 date-time — ${f.label}.`,
      };
    default:
      return { type: "string", description };
  }
}

/** Ids the agent is allowed to fill for a given form. */
export function aiFillableFieldIds(fields: FormFieldSpec[]): string[] {
  return fields.filter((f) => f.aiFillable !== false).map((f) => f.id);
}

/** Look up a single field spec by id. */
export function fieldSpec(
  fields: FormFieldSpec[],
  id: string,
): FormFieldSpec | undefined {
  return fields.find((f) => f.id === id);
}
