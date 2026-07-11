// User profile domain types. Keep the ui_mode values in sync with the
// `ui_mode` enum in supabase/migrations/0001_init.sql.

import type { VoiceOntology } from "./ontology";
import type { LearnedFact } from "./facts";

/**
 * Which presentation the user gets everywhere in the app:
 * - "quick": short sentences, one thing at a time, fewer choices, icons.
 * - "elaborate": the full experience.
 */
export type UiMode = "quick" | "elaborate";

/** A persisted user profile, as stored in Supabase. */
export interface Profile {
  id: string;
  /** Full name used for simple voice auth (demo: match by name only). */
  full_name: string | null;
  /** E.164 phone for outbound check-in calls (demo). */
  contact_phone: string | null;
  ui_mode: UiMode;
  /** Static vocabulary accessibility tags (see src/lib/tags.ts). */
  accessibility_needs: string[];
  /** Static vocabulary tags the user is interested in. */
  preferred_tags: string[];
  city: string | null;
  free_only: boolean;
  /** Raw quiz answers by question id, so prefs can be re-derived later. */
  quiz_answers: Record<string, boolean>;
  /** Learned goals and motivations from voice conversations. */
  voice_ontology: VoiceOntology;
  /** Durable facts the text-chat agent has learned about the user. */
  learned_facts: LearnedFact[];
  created_at: string;
  updated_at: string;
}

export interface ProfileInput {
  id: string;
  full_name?: string | null;
  contact_phone?: string | null;
  ui_mode: UiMode;
  accessibility_needs: string[];
  preferred_tags: string[];
  city?: string | null;
  free_only: boolean;
  quiz_answers: Record<string, boolean>;
  voice_ontology?: VoiceOntology;
  learned_facts?: LearnedFact[];
}

/** The slice of the profile the chat agent needs for personalization. */
export interface AgentProfile {
  full_name?: string | null;
  ui_mode: UiMode;
  accessibility_needs: string[];
  preferred_tags: string[];
  city?: string | null;
  free_only?: boolean;
  voice_ontology?: VoiceOntology;
  learned_facts?: LearnedFact[];
}
