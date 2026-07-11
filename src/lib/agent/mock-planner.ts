import { executeTool } from "@/lib/agent/tools";
import type { ChatMessage, UiAction } from "@/lib/agent/types";
import {
  EVENT_CATEGORIES,
  type EventCategory,
} from "@/lib/types/events";
import type { AgentProfile } from "@/lib/types/profile";

// A deterministic, no-LLM fallback so the app is fully demoable without an
// OpenAI key. It does lightweight intent detection + entity extraction and then
// calls the SAME tools the real orchestrator uses.

interface Plan {
  message: string;
  actions: UiAction[];
}

const CATEGORY_KEYWORDS: Record<EventCategory, string[]> = {
  food_bank: ["food bank", "food banks", "groceries", "pantry", "meal"],
  fundraiser: ["fundraiser", "fundraising", "gala", "donation drive", "charity"],
  health: ["health", "wellness", "clinic", "mental health", "screening"],
  education: ["education", "class", "workshop", "tutoring", "literacy"],
  youth: ["youth", "teen", "teens", "kids", "children", "child"],
  seniors: ["senior", "seniors", "elderly", "older adults"],
  community: ["community", "neighbourhood", "neighborhood", "social"],
  arts: ["art", "arts", "music", "theatre", "theater", "craft"],
  employment: ["job", "jobs", "employment", "career", "resume"],
  housing: ["housing", "shelter", "rent", "homeless"],
  other: [],
};

const KNOWN_CITIES = [
  "Markham",
  "Toronto",
  "Scarborough",
  "Mississauga",
  "Vaughan",
  "Richmond Hill",
  "Kitchener",
  "Waterloo",
  "Hamilton",
  "Brampton",
  "Ottawa",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export async function planWithoutLLM(
  history: ChatMessage[],
  profile?: AgentProfile | null,
): Promise<Plan> {
  const last = [...history].reverse().find((m) => m.role === "user");
  const text = (last?.content ?? "").toLowerCase();

  if (isCreateIntent(text)) return planCreate(last?.content ?? "");
  if (isRecommendIntent(text)) return planRecommend(text, profile);
  return planSearch(text);
}

// --- intent detection ------------------------------------------------------

function isCreateIntent(t: string): boolean {
  return /\b(create|add|publish|post|host|list|new)\b.*\bevent\b/.test(t) ||
    /\bevent\b.*\b(create|add|publish|post|host|list)\b/.test(t) ||
    /\b(i want to|i'd like to|help me) (create|add|publish|host|post)\b/.test(t);
}

function isRecommendIntent(t: string): boolean {
  return /\b(recommend|suggest|suggestion|ideas?|what should|anything good|surprise me)\b/.test(
    t,
  );
}

// --- planners --------------------------------------------------------------

async function planSearch(text: string): Promise<Plan> {
  const city = extractCity(text);
  const category = extractCategory(text);
  const isFree = text.includes("free") ? true : undefined;
  const query = extractQuery(text, category);

  const outcome = await executeTool("search_events", {
    query,
    city,
    category,
    is_free: isFree,
    limit: 8,
  });

  const count = countFromActions(outcome.actions);
  const where = city ? ` in ${city}` : "";
  const what = category ? ` ${category.replace("_", " ")}` : "";
  const message =
    count > 0
      ? `I found ${count}${what} event${count === 1 ? "" : "s"}${where}. Here ${count === 1 ? "it is" : "they are"} below — tell me if you'd like to narrow by date, cost, or audience.`
      : `I couldn't find any matching events${where} yet. Try a different area or category, or I can recommend some upcoming events.`;

  return { message, actions: outcome.actions };
}

async function planRecommend(
  text: string,
  profile?: AgentProfile | null,
): Promise<Plan> {
  const city = extractCity(text) ?? profile?.city ?? undefined;
  const isFree =
    text.includes("free") || profile?.free_only ? true : undefined;
  const tags = [
    ...new Set([
      ...extractTags(text),
      ...(profile?.preferred_tags ?? []),
      ...(profile?.accessibility_needs ?? []),
    ]),
  ];

  // Mirror the two-step flow the real agent uses: broad top-k retrieval, then
  // curate the best few into cards.
  const top = await executeTool("get_top_events", {
    tags,
    k: 6,
    city,
    free_only: isFree,
  });

  let candidateIds: string[] = [];
  try {
    const parsed = JSON.parse(top.forModel) as { events?: { id: string }[] };
    candidateIds = (parsed.events ?? []).map((e) => e.id);
  } catch {
    candidateIds = [];
  }

  const outcome = await executeTool("show_events", {
    ids: candidateIds.slice(0, 3),
    title: "Recommended for you",
  });

  const count = countFromActions(outcome.actions);
  const message =
    count > 0
      ? `Here are ${count} upcoming event${count === 1 ? "" : "s"} I think you'll like. Want more like these, or something on a specific day?`
      : `I don't have recommendations to show yet, but new events are added often. Try telling me a city or the kind of activity you enjoy.`;

  return { message, actions: outcome.actions };
}

async function planCreate(original: string): Promise<Plan> {
  const text = original.toLowerCase();
  const category = extractCategory(text);
  const city = extractCity(original);
  const startIso = extractDate(text);
  const address = extractAddress(original);
  const title = extractTitle(original, category);

  const draftArgs: Record<string, unknown> = {
    category: category ?? undefined,
    city,
    address,
    title,
    is_free: /\bfree\b/.test(text) ? true : undefined,
  };
  if (startIso) draftArgs.start_time = startIso;

  const outcome = await executeTool("draft_event", draftArgs);

  const filled = Object.keys(draftArgs).filter(
    (k) => draftArgs[k] !== undefined,
  ).length;
  const message =
    `I've started an event listing${filled ? " with the details you gave" : ""}. ` +
    `Review and complete the form below — add anything I missed (date, cost, audience, accessibility), then submit to publish.`;

  return { message, actions: outcome.actions };
}

// --- extraction helpers ----------------------------------------------------

function extractCity(text: string): string | undefined {
  for (const city of KNOWN_CITIES) {
    if (text.toLowerCase().includes(city.toLowerCase())) return city;
  }
  const m = text.match(/\bin ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/);
  return m ? m[1] : undefined;
}

// Category → topic tag in the static vocabulary (src/lib/tags.ts).
const CATEGORY_TAG: Partial<Record<EventCategory, string>> = {
  food_bank: "food",
  health: "health",
  education: "education",
  arts: "arts",
  employment: "employment",
  housing: "housing",
  community: "social",
  fundraiser: "volunteering",
  youth: "teens",
  seniors: "seniors",
};

/** Rough static-tag extraction for the no-LLM path. */
function extractTags(text: string): string[] {
  const tags = new Set<string>();
  const category = extractCategory(text);
  const catTag = category ? CATEGORY_TAG[category] : undefined;
  if (catTag) tags.add(catTag);
  if (/\bfree\b/.test(text)) tags.add("free");
  if (/\bkids?|children\b/.test(text)) tags.add("kids");
  if (/\bteens?|youth\b/.test(text)) tags.add("teens");
  if (/\bseniors?\b/.test(text)) tags.add("seniors");
  if (/\bfamil(y|ies)\b/.test(text)) tags.add("families");
  if (/\bonline|virtual\b/.test(text)) tags.add("online");
  if (/\bwheelchair|accessible\b/.test(text)) tags.add("wheelchair");
  if (/\bquiet|sensory|not too loud\b/.test(text)) tags.add("quiet_space");
  return [...tags];
}

function extractCategory(text: string): EventCategory | undefined {
  for (const cat of EVENT_CATEGORIES) {
    if (cat === "other") continue;
    if (CATEGORY_KEYWORDS[cat].some((kw) => text.includes(kw))) return cat;
  }
  return undefined;
}

function extractQuery(text: string, category?: EventCategory): string | undefined {
  if (category) return undefined; // category filter is more precise
  // Strip common filler and city/date words to leave keywords.
  const cleaned = text
    .replace(
      /\b(find|show|me|all|any|some|events?|event|for|in|near|the|please|looking|i'm|i am|want|to|attend|free|on|this|next)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

/** Parse "june 20", "june 20th", "on 6/20" → ISO date-time (defaults 18:00). */
function extractDate(text: string): string | undefined {
  const monthDay = text.match(
    new RegExp(`\\b(${MONTHS.join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?`),
  );
  if (monthDay) {
    const month = MONTHS.indexOf(monthDay[1]);
    const day = parseInt(monthDay[2], 10);
    return buildDate(month, day);
  }
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (numeric) {
    const month = parseInt(numeric[1], 10) - 1;
    const day = parseInt(numeric[2], 10);
    if (month >= 0 && month <= 11) return buildDate(month, day);
  }
  return undefined;
}

function buildDate(month: number, day: number): string {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day, 18, 0, 0, 0);
  // If the date already passed this year, assume next year.
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    year += 1;
  }
  return new Date(year, month, day, 18, 0, 0, 0).toISOString();
}

/** Grab a street-ish address like "cherry st" / "123 Main Street". */
function extractAddress(text: string): string | undefined {
  const m = text.match(
    /\b(\d{1,5}\s+)?[A-Za-z][A-Za-z]+ (st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|way|cres|crescent)\b\.?/i,
  );
  return m ? m[0].replace(/\.$/, "") : undefined;
}

function extractTitle(
  original: string,
  category?: EventCategory,
): string | undefined {
  // "create an event for a charity fundraiser ..." → "Charity Fundraiser"
  const m = original.match(/event (?:for|about|:)\s+(?:a |an |the )?([^,.]+?)(?:\s+on\b|\s+at\b|\s+in\b|[,.]|$)/i);
  if (m && m[1].trim().length > 2) {
    return titleCase(m[1].trim());
  }
  if (category) return titleCase(category.replace("_", " ")) + " Event";
  return undefined;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function countFromActions(actions: UiAction[]): number {
  const a = actions.find((x) => x.type === "events");
  return a && a.type === "events" ? a.events.length : 0;
}
