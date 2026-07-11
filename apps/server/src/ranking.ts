import type { EventRecord } from "@chiron/shared";

// Pure scoring for top-k event retrieval, shared by the Supabase and mock
// backends so both rank identically. The repository fetches a broad candidate
// set; this module orders it. The agent then curates the returned top-k down
// to a few strong picks.

export interface RankingQuery {
  /** Static vocabulary tags the user wants (from quiz prefs + conversation). */
  tags: string[];
  /** Prefer free events (soft signal — a hard filter is applied separately). */
  preferFree?: boolean;
}

const STATIC_TAG_WEIGHT = 3; // per matching static tag
const INTERNAL_TAG_WEIGHT = 1; // per internal tag matching a wanted tag
const FREE_BONUS = 1;
const SOON_MAX_BONUS = 2; // decays to 0 over SOON_WINDOW_DAYS
const SOON_WINDOW_DAYS = 30;

export function scoreEvent(
  event: EventRecord,
  query: RankingQuery,
  now: Date = new Date(),
): number {
  const wanted = new Set(query.tags);
  let score = 0;

  for (const tag of event.tags) {
    if (wanted.has(tag)) score += STATIC_TAG_WEIGHT;
  }
  // Internal tags never hard-filter, but a lucky overlap with what the user
  // asked for is a useful nudge.
  for (const tag of event.internal_tags) {
    if (wanted.has(tag)) score += INTERNAL_TAG_WEIGHT;
  }

  if (query.preferFree && event.is_free) score += FREE_BONUS;

  // Sooner events rank higher, all else equal.
  const daysAway =
    (new Date(event.start_time).getTime() - now.getTime()) /
    (24 * 60 * 60 * 1000);
  if (daysAway >= 0 && daysAway <= SOON_WINDOW_DAYS) {
    score += SOON_MAX_BONUS * (1 - daysAway / SOON_WINDOW_DAYS);
  }

  return score;
}

/** Order candidates by score (desc), tie-broken by start time (asc). */
export function rankEvents(
  events: EventRecord[],
  query: RankingQuery,
  limit: number,
  now: Date = new Date(),
): EventRecord[] {
  return events
    .map((event) => ({ event, score: scoreEvent(event, query, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.event.start_time.localeCompare(b.event.start_time),
    )
    .slice(0, limit)
    .map(({ event }) => event);
}
