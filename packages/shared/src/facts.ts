// Learned facts — the part of the user ontology the text-chat agent grows over
// time. The onboarding quiz and voice calls populate the structured profile
// fields (preferred_tags, city, voice_ontology, …); this is where the chat
// agent records durable things it hears in conversation so they persist across
// sessions and feed recommendations.

/** Where a learned fact came from. */
export type LearnedFactSource = "conversation" | "quiz" | "registration";

/**
 * Controlled predicate vocabulary — keeping it small keeps the ontology
 * queryable. `note` is the free-form escape hatch.
 */
export const FACT_PREDICATES = [
  "prefers_tag", // object is a static tag / topic the user likes
  "avoids_tag", // object is something the user dislikes / wants to avoid
  "interest", // free-text topic the user cares about
  "preferred_day", // e.g. "weekends", "saturday evenings"
  "preferred_city", // object is a city / area
  "travels_with", // e.g. "kids", "service dog", "elderly parent"
  "budget", // e.g. "free_only", "under $20"
  "note", // anything else worth remembering
] as const;

export type FactPredicate = (typeof FACT_PREDICATES)[number];

export interface LearnedFact {
  predicate: FactPredicate;
  object: string;
  source: LearnedFactSource;
  /** 0–1; explicit user statements are high, inferences lower. */
  confidence: number;
  /** ISO timestamp of when the fact was last (re)affirmed. */
  updated_at: string;
}

/** What the agent supplies when asking to remember something. */
export interface LearnedFactInput {
  predicate: FactPredicate;
  object: string;
  source?: LearnedFactSource;
  confidence?: number;
}

export function isFactPredicate(v: unknown): v is FactPredicate {
  return (
    typeof v === "string" && (FACT_PREDICATES as readonly string[]).includes(v)
  );
}

const factKey = (predicate: string, object: string) =>
  `${predicate}::${object.trim().toLowerCase()}`;

/**
 * Merge incoming facts into an existing list: dedupe by (predicate, object),
 * keep the most recent occurrence, and cap the total. Pure — safe to reuse in
 * the data layer.
 */
export function mergeLearnedFacts(
  existing: LearnedFact[],
  incoming: LearnedFact[],
  cap = 50,
): LearnedFact[] {
  const byKey = new Map<string, LearnedFact>();
  for (const f of existing) byKey.set(factKey(f.predicate, f.object), f);
  for (const f of incoming) byKey.set(factKey(f.predicate, f.object), f);
  // Most-recently-updated first, then cap.
  return [...byKey.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, cap);
}
