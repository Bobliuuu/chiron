import { TAG_FACETS, tagLabel } from "@chiron/shared";

// Server-side analytics aggregation. Given the registered profiles for an
// event (already filtered to opted-in users), produce counts per static tag
// and a short natural-language audience summary the event creator can read at
// a glance. Everything here is derivable from public static tags — no PII is
// ever surfaced (no names, no emails, no free-text fields).

export interface AudienceMix {
  /** Map of tag → count of opted-in attendees who carry it. */
  preferred_tags: Record<string, number>;
  accessibility_needs: Record<string, number>;
  /** Number of opted-in attendees folded into the mix. */
  opted_in: number;
  /** Number of attendees that declined sharing — surfaced so the creator knows
   *  the mix is partial. */
  opted_out: number;
}

export function summarizeAudience(
  profiles: { preferred_tags: string[]; accessibility_needs: string[] }[],
  totalAttendees: number,
): AudienceMix {
  const tagCounts: Record<string, number> = {};
  const needCounts: Record<string, number> = {};
  for (const p of profiles) {
    for (const t of p.preferred_tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    for (const t of p.accessibility_needs) needCounts[t] = (needCounts[t] ?? 0) + 1;
  }
  return {
    preferred_tags: tagCounts,
    accessibility_needs: needCounts,
    opted_in: profiles.length,
    opted_out: Math.max(totalAttendees - profiles.length, 0),
  };
}

/**
 * Build a short human-readable summary of the audience mix for an event
 * creator. Picks the top preferred_tags (audience / topic) and any accessibility
 * signals strong enough to call out. Falls back gracefully when the pool is
 * empty or the data is too thin to be meaningful.
 */
export function describeAudience(mix: AudienceMix): string {
  if (mix.opted_in === 0) {
    if (mix.opted_out === 0) {
      return "No one has registered yet.";
    }
    return "Registered attendees haven't shared their preferences yet.";
  }

  // Only audience/topic tags give the "who is going here" feel; cost/format
  // tags mostly mirror the event's own metadata.
  const audiencePicks = topTags(mix.preferred_tags, ["audience", "topic"], 3);
  const accessPicks = topTags(mix.accessibility_needs, ["accessibility"], 4);

  const parts: string[] = [];
  if (audiencePicks.length > 0) {
    parts.push(
      `Mostly ${audiencePicks.map((p) => pluralizeLabel(p.label, p.count)).join(", ")}.`,
    );
  } else {
    parts.push("Attendees are a mix of interests.");
  }
  if (accessPicks.length > 0) {
    parts.push(
      `Accessibility signals: ${accessPicks.map((p) => pluralizeLabel(p.label, p.count)).join(", ")}.`,
    );
  }
  if (mix.opted_out > 0) {
    parts.push(`${mix.opted_out} attendee${mix.opted_out === 1 ? " has" : "s have"} opted out of sharing.`);
  }
  return parts.join(" ");
}

interface TagPick {
  label: string;
  count: number;
}

function topTags(
  counts: Record<string, number>,
  facets: ("audience" | "topic" | "accessibility" | "format" | "cost")[],
  limit: number,
): TagPick[] {
  const allowed = new Set<string>();
  for (const facet of facets) {
    for (const tag of Object.keys(TAG_FACETS[facet] ?? {})) allowed.add(tag);
  }
  return Object.entries(counts)
    .filter(([tag, count]) => allowed.has(tag) && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ label: tagLabel(tag), count }));
}

function pluralizeLabel(label: string, count: number): string {
  // Light pluralization: most labels here are already mass nouns ("Kids",
  // "Teens"). We only append "s" for "Family" → "Families" so it reads OK.
  if (count <= 1) return label.toLowerCase();
  if (/y$/i.test(label) && !/[aeiou]y$/i.test(label)) {
    return `${label.slice(0, -1).toLowerCase()}ies`;
  }
  return `${label.toLowerCase()}s`;
}