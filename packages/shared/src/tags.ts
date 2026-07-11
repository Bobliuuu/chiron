// The static tag vocabulary and its tagging rubric.
//
// These tags are the primary way events are filtered and matched: the tagging
// pipeline applies them to events (events.tags), and the onboarding quiz maps
// user answers onto the same vocabulary (profiles.preferred_tags /
// accessibility_needs). Matching is then a plain array overlap.
//
// Tags are grouped into facets so the tagging model reasons about one
// dimension at a time. Each tag carries a rubric line — the inclusion
// criterion the model must satisfy before applying it. The rubric doubles as
// documentation.
//
// Free-form "secret" tags (events.internal_tags) are NOT defined here: the
// agent invents those per-event. They only influence ranking and are never
// shown to users.

export interface TagDef {
  /** Human label, used in UI chips and quiz copy. */
  label: string;
  /** Inclusion criterion the tagging model must satisfy to apply the tag. */
  rubric: string;
}

export type TagFacet = "audience" | "accessibility" | "format" | "topic" | "cost";

export const TAG_FACETS: Record<TagFacet, Record<string, TagDef>> = {
  audience: {
    kids: {
      label: "Kids",
      rubric: "Programming aimed at children 12 and under, or explicitly family/child friendly.",
    },
    teens: {
      label: "Teens",
      rubric: "Aimed at ages 13–18, or the listing says teens/youth/high-schoolers.",
    },
    adults: {
      label: "Adults",
      rubric: "Aimed at adults generally. Do not apply just because adults may attend a kids event.",
    },
    seniors: {
      label: "Seniors",
      rubric: "Aimed at older adults (55+), or the listing says seniors/elderly.",
    },
    families: {
      label: "Families",
      rubric: "Designed for parents and children attending together.",
    },
    newcomers: {
      label: "Newcomers",
      rubric: "Aimed at immigrants, refugees, or people new to Canada; includes settlement services.",
    },
  },
  accessibility: {
    wheelchair: {
      label: "Wheelchair accessible",
      rubric:
        "The venue or listing states wheelchair or step-free access anywhere in the text — including phrases like 'wheelchair accessible throughout', 'elevator available', 'accessible entrance'.",
    },
    asl: {
      label: "ASL interpretation",
      rubric: "Sign-language interpretation is explicitly provided.",
    },
    quiet_space: {
      label: "Quiet / low-sensory",
      rubric: "The listing mentions low noise, sensory-friendly hours, or a calm environment.",
    },
    plain_language: {
      label: "Plain language",
      rubric: "Materials or programming explicitly use simple language or easy-read formats.",
    },
    large_print: {
      label: "Large print",
      rubric: "Large-print or vision-accessible materials are explicitly mentioned.",
    },
    support_person: {
      label: "Support person welcome",
      rubric: "The listing welcomes support workers/caregivers, or admits them free.",
    },
  },
  format: {
    online: {
      label: "Online",
      rubric: "The event happens fully or partly over the internet.",
    },
    in_person: {
      label: "In person",
      rubric: "The event happens at a physical location.",
    },
    outdoor: {
      label: "Outdoor",
      rubric:
        "The activity itself happens outdoors (park, trail, street, garden). Never apply to events inside a building — a museum, science centre, library, or hall is NOT outdoor.",
    },
    drop_in: {
      label: "Drop-in",
      rubric:
        "People can show up without arranging anything in advance. Trigger phrases: 'drop in', 'walk in', 'just show up', 'no appointment needed', 'first come first served'.",
    },
    registration_needed: {
      label: "Registration needed",
      rubric:
        "Attendees must sign up, buy a ticket, book, or reserve IN ADVANCE. Signing up at the door does not count.",
    },
    recurring: {
      label: "Recurring",
      rubric:
        "The event repeats on a schedule. Trigger phrases: 'weekly', 'monthly', 'every Wednesday', 'every second Sunday', 'first Saturday of every month'.",
    },
    one_on_one: {
      label: "One-on-one help",
      rubric:
        "Individual help or appointments rather than a group session. Trigger phrases: 'one-on-one', '1:1', 'individual appointments', 'personal assistance', 'book a slot'.",
    },
  },
  topic: {
    food: {
      label: "Food",
      rubric: "Food banks, community meals, cooking, nutrition, or food distribution.",
    },
    health: {
      label: "Health & wellness",
      rubric: "Physical or mental health: clinics, screenings, exercise, counselling, wellness.",
    },
    arts: {
      label: "Arts & culture",
      rubric: "Music, theatre, crafts, visual arts, dance, or cultural celebrations.",
    },
    sports: {
      label: "Sports & recreation",
      rubric: "Physical activity or games: sports leagues, swimming, hikes, fitness.",
    },
    education: {
      label: "Learning",
      rubric: "Classes, workshops, tutoring, literacy, or skills training.",
    },
    employment: {
      label: "Jobs & careers",
      rubric: "Job fairs, resume help, interview prep, or career counselling.",
    },
    housing: {
      label: "Housing",
      rubric: "Housing support, shelters, tenant services, or rent assistance.",
    },
    social: {
      label: "Social & community",
      rubric: "Primarily about meeting people: socials, clubs, community gatherings.",
    },
    volunteering: {
      label: "Volunteering",
      rubric: "The attendee comes to help or give (volunteer shifts, donation drives, fundraisers).",
    },
  },
  cost: {
    free: {
      label: "Free",
      rubric: "No cost to attend. Apply when is_free is true.",
    },
    low_cost: {
      label: "Low cost",
      rubric: "Under roughly $20, or pay-what-you-can / suggested donation.",
    },
  },
};

/** Every valid static tag, across all facets. */
export const STATIC_TAGS: string[] = Object.values(TAG_FACETS).flatMap((facet) =>
  Object.keys(facet),
);

const STATIC_TAG_SET = new Set(STATIC_TAGS);

export function isStaticTag(tag: string): boolean {
  return STATIC_TAG_SET.has(tag);
}

/** Human label for a static tag (falls back to the raw tag). */
export function tagLabel(tag: string): string {
  for (const facet of Object.values(TAG_FACETS)) {
    if (facet[tag]) return facet[tag].label;
  }
  return tag.replace(/_/g, " ");
}

/**
 * Normalize model output into vocabulary form: lowercase snake_case, and only
 * tags that exist in the static vocabulary.
 */
export function sanitizeStaticTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    const tag = normalizeTagText(item);
    if (tag && STATIC_TAG_SET.has(tag)) out.add(tag);
  }
  return [...out];
}

/** Normalize free-form internal tags: snake_case, deduped, capped. */
export function sanitizeInternalTags(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const item of raw) {
    const tag = normalizeTagText(item);
    // Internal tags must not shadow the static vocabulary.
    if (tag && tag.length <= 40 && !STATIC_TAG_SET.has(tag)) out.add(tag);
    if (out.size >= max) break;
  }
  return [...out];
}

function normalizeTagText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const tag = v
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  return tag.length > 0 ? tag : null;
}

/** The rubric, rendered for the tagging prompt. */
export function rubricText(): string {
  return (Object.entries(TAG_FACETS) as [TagFacet, Record<string, TagDef>][])
    .map(([facet, tags]) => {
      const lines = Object.entries(tags)
        .map(([tag, def]) => `  - ${tag}: ${def.rubric}`)
        .join("\n");
      return `${facet.toUpperCase()}\n${lines}`;
    })
    .join("\n\n");
}
