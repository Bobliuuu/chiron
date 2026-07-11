// Shared event domain types. Keep EventCategory in sync with the
// `event_category` enum in supabase/migrations/0001_init.sql.

export const EVENT_CATEGORIES = [
  "food_bank",
  "fundraiser",
  "health",
  "education",
  "youth",
  "seniors",
  "community",
  "arts",
  "employment",
  "housing",
  "other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  food_bank: "Food bank",
  fundraiser: "Fundraiser",
  health: "Health",
  education: "Education",
  youth: "Youth",
  seniors: "Seniors",
  community: "Community",
  arts: "Arts & culture",
  employment: "Employment",
  housing: "Housing",
  other: "Other",
};

/** A persisted event, as stored in Supabase. */
export interface EventRecord {
  id: string;
  title: string;
  summary: string;
  description: string | null;
  category: EventCategory;
  start_time: string; // ISO 8601
  end_time: string | null;
  is_online: boolean;
  online_url: string | null;
  location_name: string | null;
  address: string | null;
  city: string | null;
  is_free: boolean;
  cost_note: string | null;
  audience: string | null;
  accessibility: string[];
  transportation: string | null;
  registration_url: string | null;
  registration_instructions: string | null;
  host_organization: string | null;
  created_at: string;
  updated_at: string;
}

/** The fields a client may supply when creating an event. */
export interface EventInput {
  title: string;
  summary: string;
  description?: string | null;
  category?: EventCategory;
  start_time: string;
  end_time?: string | null;
  is_online?: boolean;
  online_url?: string | null;
  location_name?: string | null;
  address?: string | null;
  city?: string | null;
  is_free?: boolean;
  cost_note?: string | null;
  audience?: string | null;
  accessibility?: string[];
  transportation?: string | null;
  registration_url?: string | null;
  registration_instructions?: string | null;
  host_organization?: string | null;
}

/**
 * A partially-filled event used to prefill the creation form in the chat.
 * Every field is optional because the agent extracts whatever the user gave.
 */
export type EventDraft = Partial<EventInput>;

export interface EventSearchFilters {
  /** Free-text keyword match over title/summary/description/host. */
  query?: string;
  city?: string;
  category?: EventCategory;
  /** ISO date-time lower bound (inclusive). */
  from?: string;
  /** ISO date-time upper bound (inclusive). */
  to?: string;
  isFree?: boolean;
  /** Substring match against the audience field. */
  audience?: string;
  limit?: number;
}
