import { executeTool } from "./tools";
import {
  EVENT_CATEGORIES,
  type AgentProfile,
  type ChannelCapabilities,
  type ChatMessage,
  type EventCategory,
  type PublicEvent,
  type UiAction,
} from "@chiron/shared";

// A deterministic, no-LLM fallback so the app is fully demoable without an
// OpenAI key. It does lightweight intent detection + entity extraction and then
// calls the SAME tools the real orchestrator uses.
//
// It is channel-aware, mirroring the real orchestrator: on rich-UI channels
// (web) it drafts the creation form and renders event cards; on prose-only
// channels (voice/whatsapp/email) it asks a follow-up question to create and
// describes search results in words, with no UI actions.

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
  caps: ChannelCapabilities,
  profile?: AgentProfile | null,
  userId?: string | null,
): Promise<Plan> {
  const userMessages = history.filter((m) => m.role === "user");
  const last = userMessages[userMessages.length - 1];
  const text = (last?.content ?? "").toLowerCase();
  const combinedUser = userMessages.map((m) => m.content).join(" ").toLowerCase();

  const inCreateFlow =
    isCreateIntent(combinedUser) ||
    (isConfirmIntent(text) &&
      userMessages.some((m) => isCreateIntent(m.content.toLowerCase())));

  if (inCreateFlow) return planCreate(last?.content ?? "", caps, history);
  if (isOrganizerCallIntent(text)) return planOrganizerCall(history, caps, profile);
  if (isRememberIntent(text)) return planRemember(last?.content ?? "", userId);
  if (isRegisterIntent(text)) return planRegister(text, caps, profile);
  if (isRecommendIntent(text)) return planRecommend(text, caps, profile);
  return planSearch(text, caps);
}

// --- intent detection ------------------------------------------------------

function isCreateIntent(t: string): boolean {
  return (
    /\b(create|add|publish|post|host|list|new)\b.*\bevent\b/.test(t) ||
    /\bevent\b.*\b(create|add|publish|post|host|list)\b/.test(t) ||
    /\b(i want to|i'd like to|help me) (create|add|publish|host|post)\b/.test(t) ||
    /\b(create|publish|post|list|host)\b.*\b(fundraiser|food bank|workshop|class|gala)\b/.test(
      t,
    )
  );
}

function isRecommendIntent(t: string): boolean {
  return /\b(recommend|suggest|suggestion|ideas?|what should|anything good|surprise me)\b/.test(
    t,
  );
}

function isConfirmIntent(t: string): boolean {
  return /\b(yes|yeah|yep|correct|publish|go ahead|sounds good|do it|please do|that's right|that is right)\b/.test(
    t,
  );
}

function isOrganizerCallIntent(t: string): boolean {
  return (
    /\b(ask|contact|call|reach|phone)\b.*\b(organizer|organisers?|host)\b/.test(
      t,
    ) ||
    /\b(organizer|organisers?|host)\b.*\b(ask|contact|call|reach|questions?)\b/.test(
      t,
    )
  );
}

function isRegisterIntent(t: string): boolean {
  return (
    /\b(register|sign ?up|rsvp|reserve|book)\b/.test(t) ||
    /\b(i want to|i'd like to|can i|how do i|help me)\b.*\b(attend|join|go to|come to)\b/.test(
      t,
    )
  );
}

function isRememberIntent(t: string): boolean {
  return /\b(remember|keep in mind|note that|from now on|for future|don'?t forget)\b/.test(
    t,
  );
}

// --- planners --------------------------------------------------------------

async function planSearch(
  text: string,
  caps: ChannelCapabilities,
): Promise<Plan> {
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

  const events = eventsFromActions(outcome.actions);
  const count = events.length;
  const where = city ? ` in ${city}` : "";
  const what = category ? ` ${category.replace("_", " ")}` : "";

  if (count === 0) {
    return {
      message: `I couldn't find any matching events${where} yet. Try a different area or category, or I can recommend some upcoming events.`,
      actions: [],
    };
  }

  // Prose-only channels get the results read out; rich channels get cards.
  if (!caps.richUi) {
    return {
      message: `I found ${count}${what} event${count === 1 ? "" : "s"}${where}. ${describeEvents(events)} Want me to narrow it down by date, cost, or audience?`,
      actions: [],
    };
  }
  return {
    message: `I found ${count}${what} event${count === 1 ? "" : "s"}${where}. Here ${count === 1 ? "it is" : "they are"} below — tell me if you'd like to narrow by date, cost, or audience.`,
    actions: outcome.actions,
  };
}

async function planRecommend(
  text: string,
  caps: ChannelCapabilities,
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
  // curate the best few.
  const top = await executeTool("get_top_events", {
    tags,
    k: 6,
    city,
    free_only: isFree,
  });

  let candidates: { id: string }[] = [];
  try {
    const parsed = JSON.parse(top.forModel) as { events?: { id: string }[] };
    candidates = parsed.events ?? [];
  } catch {
    candidates = [];
  }

  const outcome = await executeTool("show_events", {
    ids: candidates.slice(0, 3).map((e) => e.id),
    title: "Recommended for you",
  });

  const events = eventsFromActions(outcome.actions);
  const count = events.length;

  if (count === 0) {
    return {
      message: `I don't have recommendations to show yet, but new events are added often. Try telling me a city or the kind of activity you enjoy.`,
      actions: [],
    };
  }

  if (!caps.richUi) {
    return {
      message: `Here ${count === 1 ? "is" : "are"} ${count} upcoming event${count === 1 ? "" : "s"} you might like. ${describeEvents(events)} Want more like these, or something on a specific day?`,
      actions: [],
    };
  }
  return {
    message: `Here are ${count} upcoming event${count === 1 ? "" : "s"} I think you'll like. Want more like these, or something on a specific day?`,
    actions: outcome.actions,
  };
}

async function planRegister(
  text: string,
  caps: ChannelCapabilities,
  profile?: AgentProfile | null,
): Promise<Plan> {
  // The no-LLM path has no memory of previously shown event ids, so find the
  // best candidate from the request text, then register for it.
  const city = extractCity(text) ?? profile?.city ?? undefined;
  const category = extractCategory(text);
  const query = extractQuery(text, category);

  const search = await executeTool("search_events", {
    query,
    city,
    category,
    limit: 1,
  });
  const target = eventsFromActions(search.actions)[0];

  if (!target) {
    return {
      message: `I can help you register. Which event would you like to sign up for? Tell me its name, or ask me to find one first.`,
      actions: [],
    };
  }

  const outcome = await executeTool("register_event", { event_id: target.id });

  // Prose-only: relay how to sign up. Rich UI: surface the registration form.
  if (!caps.richUi) {
    const how = target.registration_url
      ? `You can sign up here: ${target.registration_url}.`
      : target.registration_instructions
        ? target.registration_instructions
        : `I've noted your interest and the organizer will follow up.`;
    const where = target.city ? ` in ${target.city}` : "";
    return {
      message: `Great — for "${target.title}"${where}: ${how} Anything else?`,
      actions: [],
    };
  }
  return {
    message: `Here's the registration form for "${target.title}" — fill it in below and submit to confirm your spot.`,
    actions: outcome.actions,
  };
}

async function planRemember(
  original: string,
  userId?: string | null,
): Promise<Plan> {
  const fact = extractFact(original);
  const outcome = await executeTool("remember_user_fact", fact, {
    profileId: userId,
  });
  let persisted = false;
  try {
    persisted = Boolean(
      (JSON.parse(outcome.forModel) as { persisted?: boolean }).persisted,
    );
  } catch {
    persisted = false;
  }
  return {
    message: persisted
      ? `Got it — I'll remember that and use it when I recommend events.`
      : `Got it — I'll keep that in mind for now.`,
    actions: [],
  };
}

/** Rough fact extraction for the no-LLM path (the real agent does this better). */
function extractFact(original: string): Record<string, unknown> {
  const t = original.toLowerCase();
  let object = original
    .replace(
      /^.*?\b(remember|keep in mind|note that|from now on|for future(?: reference)?|don'?t forget)\b[:,]?\s*/i,
      "",
    )
    .replace(/\b(that|to|i|please|you should|my|am|really)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let predicate = "note";
  const category = extractCategory(t);
  if (/\b(weekend|weekday|evening|morning|afternoon|saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/.test(t)) {
    predicate = "preferred_day";
  } else if (category) {
    predicate = "prefers_tag";
    object = CATEGORY_TAG[category] ?? category;
  } else if (/\bfree\b/.test(t)) {
    predicate = "budget";
    object = "free_only";
  } else if (/\b(kids?|children|famil(?:y|ies))\b/.test(t)) {
    predicate = "travels_with";
    object = "kids";
  }

  return { predicate, object: object || original.trim(), confidence: 0.85 };
}

async function planCreate(
  original: string,
  caps: ChannelCapabilities,
  history: ChatMessage[],
): Promise<Plan> {
  const userTexts = history.filter((m) => m.role === "user").map((m) => m.content);
  const combined = userTexts.join(" ");
  const text = original.toLowerCase();
  const category = extractCategory(combined.toLowerCase()) ?? extractCategory(text);
  const city = extractCity(combined) ?? extractCity(original);
  const startIso = extractDate(combined.toLowerCase()) ?? extractDate(text);
  const address = extractAddress(combined) ?? extractAddress(original);
  const title = extractTitle(combined, category) ?? extractTitle(original, category);
  const confirmed = isConfirmIntent(text);

  // Prose-only: publish when enough details + explicit confirmation.
  if (!caps.richUi) {
    const summary =
      title && category
        ? `${titleCase(category.replace("_", " "))} event hosted by the community.`
        : title
          ? `${title} — community event.`
          : undefined;

    if (confirmed && title && startIso && summary) {
      const outcome = await executeTool("create_event", {
        confirmed: true,
        title,
        summary,
        category: category ?? undefined,
        city,
        address,
        start_time: startIso,
        is_free: /\bfree\b/.test(text) ? true : undefined,
      });
      const parsed = JSON.parse(outcome.forModel) as {
        created?: boolean;
        event?: { title: string; start_time: string; city?: string | null };
        error?: string;
      };
      if (parsed.created && parsed.event) {
        const when = new Date(parsed.event.start_time).toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
        const where = parsed.event.city ? ` in ${parsed.event.city}` : "";
        return {
          message: `Done — I've published "${parsed.event.title}" for ${when}${where}. Is there anything else I can help with?`,
          actions: [],
        };
      }
      return {
        message: `I couldn't publish that yet: ${parsed.error ?? "something went wrong"}. Want to try again?`,
        actions: [],
      };
    }

    const known: string[] = [];
    if (title) known.push(`"${title}"`);
    if (startIso) known.push(`on ${new Date(startIso).toLocaleDateString()}`);
    if (city) known.push(`in ${city}`);
    const lead = known.length
      ? `Great — an event ${known.join(" ")}. `
      : `Happy to help you publish an event. `;

    if (title && startIso && summary) {
      const when = new Date(startIso).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
      const where = city ? ` in ${city}` : "";
      return {
        message: `${lead}Here's what I have: "${title}" on ${when}${where}. Should I publish this now?`,
        actions: [],
      };
    }

    return {
      message: `${lead}To set it up, can you tell me the event's name, the date and time, and where it's happening? I'll also want to know if it's free and who it's for.`,
      actions: [],
    };
  }

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

async function planOrganizerCall(
  history: ChatMessage[],
  caps: ChannelCapabilities,
  profile?: AgentProfile | null,
): Promise<Plan> {
  if (!caps.voiceTelephony) {
    return {
      message:
        "I can only place organizer calls over the phone right now. Call the Chiron voice line and ask me to contact the organizer.",
      actions: [],
    };
  }

  const userTexts = history.filter((m) => m.role === "user").map((m) => m.content);
  const combined = userTexts.join(" ").toLowerCase();
  const city = extractCity(combined);
  const category = extractCategory(combined);

  const search = await executeTool("search_events", {
    query: category ? undefined : extractQuery(combined, category),
    city,
    category,
    limit: 3,
  });

  let events: { id: string; title: string }[] = [];
  try {
    const parsed = JSON.parse(search.forModel) as {
      events?: { id: string; title: string }[];
    };
    events = parsed.events ?? [];
  } catch {
    events = [];
  }

  if (events.length === 0) {
    return {
      message:
        "I can call an event organizer for you, but I need to know which event. What event are you asking about?",
      actions: [],
    };
  }

  const event = events[0];
  const questions = extractQuestions(userTexts.at(-1) ?? "");
  if (questions.length === 0) {
    return {
      message: `I can call the organizer for "${event.title}". What would you like me to ask them?`,
      actions: [],
    };
  }

  if (!profile?.full_name) {
    return {
      message:
        "Before I call the organizer, what's your full name? I use it to identify you in our community directory.",
      actions: [],
    };
  }

  const outcome = await executeTool("call_event_organizer", {
    event_id: event.id,
    questions,
    caller_name: profile.full_name,
  });
  const parsed = JSON.parse(outcome.forModel) as {
    placed?: boolean;
    organizer?: string;
    mock?: boolean;
    error?: string;
  };

  if (!parsed.placed) {
    return {
      message: `I couldn't place that call: ${parsed.error ?? "something went wrong"}.`,
      actions: [],
    };
  }

  const mode = parsed.mock ? " (demo mode — no real call placed)" : "";
  return {
    message: `I'm calling ${parsed.organizer ?? "the organizer"} now to ask your questions about "${event.title}"${mode}. I'll let you know what they say.`,
    actions: [],
  };
}

function extractQuestions(text: string): string[] {
  const questions: string[] = [];
  const askMatch = text.match(
    /(?:ask|find out|whether|if)\s+(?:them\s+|the organizer\s+)?(.+?)(?:\.|$)/i,
  );
  if (askMatch?.[1]) questions.push(askMatch[1].trim());
  if (/\bwheelchair\b/i.test(text))
    questions.push("Is the venue wheelchair accessible?");
  if (/\bregistration\b/i.test(text))
    questions.push("How do people register for this event?");
  return [...new Set(questions.filter((q) => q.length > 5))];
}

// --- extraction helpers ----------------------------------------------------

function extractCity(text: string): string | undefined {
  for (const city of KNOWN_CITIES) {
    if (text.toLowerCase().includes(city.toLowerCase())) return city;
  }
  const m = text.match(/\bin ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/);
  return m ? m[1] : undefined;
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

// Category → topic tag in the static vocabulary (packages/shared/src/tags.ts).
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

function eventsFromActions(actions: UiAction[]): PublicEvent[] {
  const a = actions.find((x) => x.type === "events");
  return a && a.type === "events" ? a.events : [];
}

/** A short spoken/text-friendly summary of the top few events (no UI cards). */
function describeEvents(events: PublicEvent[]): string {
  return events
    .slice(0, 3)
    .map((e) => {
      const when = new Date(e.start_time).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const where = e.city ? ` in ${e.city}` : "";
      const cost = e.is_free ? "free" : e.cost_note || "paid";
      return `${e.title} (${when}${where}, ${cost})`;
    })
    .join("; ") + ".";
}
