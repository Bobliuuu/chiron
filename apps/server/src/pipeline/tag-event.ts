import { getLlmClient } from "../agent/llm";
import {
  rubricText,
  sanitizeInternalTags,
  sanitizeStaticTags,
} from "@chiron/shared";
import type { EventCategory, EventInput } from "@chiron/shared";

// The event tagging pipeline. Runs server-side when a nonprofit publishes an
// event (POST /api/events), before the row is written.
//
// Two layers of output:
//   tags          — static vocabulary, applied per the rubric in src/lib/tags.ts.
//                   These are user-facing and are the primary discovery filter.
//   internal_tags — free-form "secret" tags the model invents (e.g.
//                   "evening_only", "loud_music", "long_walk_from_transit").
//                   Backend-only ranking hints; never shown to users.
//
// When no model is configured the pipeline falls back to a deterministic
// heuristic pass so mock mode still produces useful static tags.

export interface TagResult {
  tags: string[];
  internal_tags: string[];
}

export async function tagEvent(input: EventInput): Promise<TagResult> {
  // Structural tags are derivable without a model; always apply them.
  const structural = structuralTags(input);

  const llm = getLlmClient();
  if (!llm) {
    return {
      tags: merge(structural, heuristicTags(input)),
      internal_tags: [],
    };
  }

  try {
    const completion = await llm.client.chat.completions.create({
      model: llm.model,
      messages: [
        { role: "system", content: taggingPrompt() },
        { role: "user", content: JSON.stringify(listingForModel(input)) },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      tags: merge(structural, sanitizeStaticTags(parsed.tags)),
      internal_tags: sanitizeInternalTags(parsed.internal_tags),
    };
  } catch (err) {
    console.error("[tag-event] model tagging failed, using heuristics:", err);
    return {
      tags: merge(structural, heuristicTags(input)),
      internal_tags: [],
    };
  }
}

function taggingPrompt(): string {
  return `You tag community event listings for a discovery system.

You will receive one event listing as JSON. Respond with JSON only:
{"tags": [...], "internal_tags": [...]}

"tags" — choose ONLY from the vocabulary below. Apply a tag ONLY when the
listing satisfies its rubric line. When unsure, leave the tag out; missing
tags are better than wrong tags. Tag every facet that clearly applies.
Before finishing, re-scan the full listing text (including the description)
against every rubric line — details like accessibility or scheduling are
often buried mid-description.

${rubricText()}

"internal_tags" — invent up to 8 short snake_case tags capturing anything a
recommender should know that the vocabulary above cannot express (e.g.
"evening_only", "loud_music", "food_provided", "long_walk_from_transit",
"beginner_friendly"). These are internal ranking hints and are never shown to
users, so favor being informative over being polite — but never speculate
beyond what the listing says. NEVER use an internal tag for a concept the
vocabulary already covers (e.g. do not invent "wheelchair_accessible" — that
belongs in "tags" as "wheelchair").`;
}

/** The subset of the listing the tagging model sees. */
function listingForModel(input: EventInput) {
  return {
    title: input.title,
    summary: input.summary,
    description: input.description ?? undefined,
    category: input.category ?? undefined,
    start_time: input.start_time,
    end_time: input.end_time ?? undefined,
    is_online: input.is_online ?? false,
    city: input.city ?? undefined,
    is_free: input.is_free ?? true,
    cost_note: input.cost_note ?? undefined,
    audience: input.audience ?? undefined,
    accessibility: input.accessibility ?? [],
    transportation: input.transportation ?? undefined,
    registration_url: input.registration_url ?? undefined,
    registration_instructions: input.registration_instructions ?? undefined,
  };
}

// --- deterministic layers ---------------------------------------------------

/** Tags that follow directly from structured fields — no judgment involved. */
function structuralTags(input: EventInput): string[] {
  const tags: string[] = [];

  tags.push(input.is_online ? "online" : "in_person");
  if (input.is_free ?? true) tags.push("free");
  if (input.registration_url) tags.push("registration_needed");

  for (const item of input.accessibility ?? []) {
    const t = item.toLowerCase().replace(/[\s-]+/g, "_");
    if (["wheelchair", "asl", "quiet_space", "plain_language", "large_print", "support_person"].includes(t)) {
      tags.push(t);
    }
  }

  return tags;
}

const CATEGORY_TOPIC: Partial<Record<EventCategory, string>> = {
  food_bank: "food",
  health: "health",
  education: "education",
  arts: "arts",
  employment: "employment",
  housing: "housing",
  community: "social",
  fundraiser: "volunteering",
};

const KEYWORD_TAGS: [RegExp, string][] = [
  [/\b(kids?|children)\b/i, "kids"],
  [/\b(teens?|youth|high.?school)\b/i, "teens"],
  [/\bseniors?|55\+|elderly\b/i, "seniors"],
  [/\bfamil(y|ies)\b/i, "families"],
  [/\b(newcomers?|immigrants?|refugees?|settlement)\b/i, "newcomers"],
  [/\bdrop.?in|walk.?in|no appointment\b/i, "drop_in"],
  [/\b(weekly|monthly|every (week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i, "recurring"],
  [/\b(outdoor|park|trail|garden)\b/i, "outdoor"],
  [/\b(sports?|swim|hike|fitness|yoga|exercise|soccer|basketball)\b/i, "sports"],
  [/\b(volunteer|donation drive|fundrais)\b/i, "volunteering"],
  [/\b(meal|groceries|pantry|food bank|cooking|nutrition)\b/i, "food"],
  [/\bpay.?what.?you.?can|suggested donation\b/i, "low_cost"],
];

/** Keyword fallback used when no model is available or the model call fails. */
function heuristicTags(input: EventInput): string[] {
  const tags: string[] = [];

  const topic = input.category ? CATEGORY_TOPIC[input.category] : undefined;
  if (topic) tags.push(topic);

  const haystack = [
    input.title,
    input.summary,
    input.description ?? "",
    input.audience ?? "",
    input.cost_note ?? "",
    input.registration_instructions ?? "",
  ].join(" ");

  for (const [pattern, tag] of KEYWORD_TAGS) {
    if (pattern.test(haystack)) tags.push(tag);
  }

  return tags;
}

function merge(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}
