// User profile domain types. Keep the ui_mode values in sync with the
// `ui_mode` enum in supabase/migrations/0001_init.sql.

/**
 * Which presentation the user gets everywhere in the app:
 * - "quick": short sentences, one thing at a time, fewer choices, icons.
 * - "elaborate": the full experience.
 */
export type UiMode = "quick" | "elaborate";

/** A persisted user profile, as stored in Supabase. */
export interface Profile {
  id: string;
  ui_mode: UiMode;
  /** Static vocabulary accessibility tags (see src/lib/tags.ts). */
  accessibility_needs: string[];
  /** Static vocabulary tags the user is interested in. */
  preferred_tags: string[];
  city: string | null;
  free_only: boolean;
  /** Scale up all text in the app (low-vision support). */
  large_text: boolean;
  /** Raw quiz answers by question id, so prefs can be re-derived later. */
  quiz_answers: Record<string, boolean>;
  /**
   * Privacy: when true, this profile's quiz-derived tags may be aggregated
   * into audience summaries shown to event creators. Flipped off in
   * Settings → Preferences → Privacy.
   */
  share_in_analytics: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileInput {
  id: string;
  ui_mode: UiMode;
  accessibility_needs: string[];
  preferred_tags: string[];
  city?: string | null;
  free_only: boolean;
  large_text?: boolean;
  quiz_answers: Record<string, boolean>;
  share_in_analytics?: boolean;
}

/** The slice of the profile the chat agent needs for personalization. */
export interface AgentProfile {
  ui_mode: UiMode;
  accessibility_needs: string[];
  preferred_tags: string[];
  city?: string | null;
  free_only?: boolean;
}
