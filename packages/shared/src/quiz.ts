import type { ProfileInput, UiMode } from "./profile";

// The onboarding quiz: a short run of yes/no questions that builds the user's
// profile row. Answers map onto the same static tag vocabulary used to tag
// events (src/lib/tags.ts), so profile → event matching is a plain overlap.
//
// The quiz itself is already in "quick" form for everyone — one question per
// screen, concrete wording, two big buttons — because we don't yet know which
// mode the user needs. Questions about presentation are framed as preferences,
// never as diagnoses; the user can change the result at any time.

export interface QuizQuestion {
  id: string;
  /** Concrete, plain-language yes/no question. */
  text: string;
  /** Optional one-line clarification below the question. */
  detail?: string;
  /** Profile effects applied when the user answers yes. */
  onYes: QuizEffect;
}

export interface QuizEffect {
  /** Static tags added to profiles.preferred_tags. */
  preferred_tags?: string[];
  /** Static accessibility tags added to profiles.accessibility_needs. */
  accessibility_needs?: string[];
  /** Counts toward choosing the "quick" presentation. */
  quick_signal?: boolean;
  /** Restrict recommendations to free events. */
  free_only?: boolean;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "short_info",
    text: "Do you like short and simple information?",
    detail: "We can use fewer words and bigger buttons.",
    onYes: { quick_signal: true, accessibility_needs: ["plain_language"] },
  },
  {
    id: "few_choices",
    text: "Is it easier when you see only a few choices at a time?",
    onYes: { quick_signal: true },
  },
  {
    id: "wheelchair",
    text: "Do you use a wheelchair or find stairs hard?",
    onYes: { accessibility_needs: ["wheelchair"] },
  },
  {
    id: "quiet",
    text: "Do loud or busy places bother you?",
    onYes: { accessibility_needs: ["quiet_space"] },
  },
  {
    id: "free_only",
    text: "Do events need to be free for you?",
    onYes: { free_only: true, preferred_tags: ["free"] },
  },
  {
    id: "family",
    text: "Are you looking for things to do with kids or family?",
    onYes: { preferred_tags: ["families", "kids"] },
  },
  {
    id: "meet_people",
    text: "Do you want to meet new people?",
    onYes: { preferred_tags: ["social"] },
  },
];

/** How many quick signals flip the profile to "quick" presentation. */
const QUICK_THRESHOLD = 1;

export function deriveProfile(
  id: string,
  answers: Record<string, boolean>,
  city?: string | null,
): ProfileInput {
  const preferred = new Set<string>();
  const needs = new Set<string>();
  let quickSignals = 0;
  let freeOnly = false;

  for (const q of QUIZ_QUESTIONS) {
    if (!answers[q.id]) continue;
    for (const t of q.onYes.preferred_tags ?? []) preferred.add(t);
    for (const t of q.onYes.accessibility_needs ?? []) needs.add(t);
    if (q.onYes.quick_signal) quickSignals++;
    if (q.onYes.free_only) freeOnly = true;
  }

  const ui_mode: UiMode = quickSignals >= QUICK_THRESHOLD ? "quick" : "elaborate";

  return {
    id,
    ui_mode,
    accessibility_needs: [...needs],
    preferred_tags: [...preferred],
    city: city ?? null,
    free_only: freeOnly,
    quiz_answers: answers,
  };
}
