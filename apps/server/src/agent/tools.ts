import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { createEvent, getEvent, searchEvents, topEvents } from "../data/events";
import { appendLearnedFacts } from "../data/profiles";
import { tagEvent } from "../pipeline/tag-event";
import { callEventOrganizer } from "../vapi/outbound";
import {
  EVENT_CATEGORIES,
  EVENT_CREATE_FIELDS,
  FACT_PREDICATES,
  STATIC_TAGS,
  aiFillableFieldIds,
  buildToolParameters,
  isFactPredicate,
  sanitizeStaticTags,
  toPublicEvent,
  type ChannelCapabilities,
  type EventCategory,
  type EventDraft,
  type EventInput,
  type EventRecord,
  type FactPredicate,
  type UiAction,
} from "@chiron/shared";

// The agent's toolbox. Each tool has (1) a JSON-schema definition advertised to
// the model and (2) an executor that performs the work and returns both a
// compact result for the model to reason over AND the UiActions to render.

export interface ToolOutcome {
  /** Compact JSON string fed back to the model as the tool result. */
  forModel: string;
  /** Cards to render in the chat UI. */
  actions: UiAction[];
}

// create_event advertises the same fields as the create form (from
// EVENT_CREATE_FIELDS) plus a `confirmed` publish gate.
const CREATE_EVENT_PARAMS = {
  type: "object" as const,
  properties: {
    confirmed: {
      type: "boolean",
      description:
        "Must be true — only set after the user explicitly agrees to publish.",
    },
    ...buildToolParameters(EVENT_CREATE_FIELDS).properties,
  },
  required: ["confirmed", "title", "summary", "start_time"],
};

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_events",
      description:
        "Find existing community events matching concrete filters. Use for queries like 'food bank events in Markham' or 'free things this weekend'. Prefer the tags filter over free-text when the need maps onto the tag vocabulary.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text keywords (e.g. 'food bank', 'coding').",
          },
          tags: {
            type: "array",
            items: { type: "string", enum: STATIC_TAGS },
            description:
              "Static vocabulary tags; matches events having at least one.",
          },
          city: { type: "string", description: "City name, e.g. 'Markham'." },
          category: {
            type: "string",
            enum: EVENT_CATEGORIES as unknown as string[],
            description: "Event cause/category.",
          },
          from: {
            type: "string",
            description: "ISO date-time lower bound (inclusive).",
          },
          to: {
            type: "string",
            description: "ISO date-time upper bound (inclusive).",
          },
          is_free: { type: "boolean", description: "Restrict to free events." },
          audience: {
            type: "string",
            description: "Audience keyword, e.g. 'teens', 'seniors'.",
          },
          limit: { type: "number", description: "Max results (default 8)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_events",
      description:
        "Retrieve the top-k upcoming events ranked by tag match + date proximity. Use when the user describes a need or asks for suggestions. Returns MORE candidates than you should show: review the results (including their tags) and present only the few that genuinely fit the user's full context.",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string", enum: STATIC_TAGS },
            description:
              "Tags describing what the user wants — translate their words and profile into this vocabulary. The primary ranking signal.",
          },
          k: {
            type: "number",
            description: "How many candidates to retrieve (default 10).",
          },
          city: { type: "string" },
          from: { type: "string", description: "ISO date-time lower bound." },
          to: { type: "string", description: "ISO date-time upper bound." },
          free_only: {
            type: "boolean",
            description: "Hard-restrict to free events.",
          },
        },
        required: ["tags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_events",
      description:
        "Render chosen events as cards for the user. Call after get_top_events with the ids of the few candidates (usually 3) that best fit, in the order to display.",
      parameters: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Event ids to display, best match first.",
          },
          title: {
            type: "string",
            description: "Short heading for the list, e.g. 'Picked for you'.",
          },
        },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_event",
      description:
        "Register / RSVP a community member for an event they've chosen. Pass the id of an event from a prior search or recommendation. On the web this surfaces a prefilled registration form the user completes and submits; on voice/text it returns how to sign up (external link or instructions) for you to relay. Call this when the user says they want to attend, join, sign up for, or register for a specific event.",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description:
              "Id of the event to register for (from search/recommendation results).",
          },
        },
        required: ["event_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_user_fact",
      description:
        "Persist a durable fact about THIS user to their long-term profile so it improves future recommendations and is not re-asked in later sessions. Call this whenever the user reveals a lasting preference, constraint, interest, or context — e.g. 'I prefer weekend events', 'I always bring my kids', 'I can't do loud places', 'I'm into gardening'. Do NOT use it for one-off, in-the-moment requests (e.g. 'find something this Friday'). Record one clear fact per call.",
      parameters: {
        type: "object",
        properties: {
          predicate: {
            type: "string",
            enum: FACT_PREDICATES as unknown as string[],
            description:
              "The kind of fact: prefers_tag/avoids_tag (topics), interest, preferred_day, preferred_city, travels_with, budget, or note for anything else.",
          },
          object: {
            type: "string",
            description:
              "The value, in a few words (e.g. 'weekends', 'kids', 'gardening', 'Scarborough').",
          },
          confidence: {
            type: "number",
            description:
              "0–1. Use ~0.9 when the user stated it explicitly, lower when inferred.",
          },
        },
        required: ["predicate", "object"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_event",
      description:
        "Prepare a prefilled event-creation form from what the user described. Does NOT publish — it surfaces a draft the nonprofit reviews and submits. Fill only the fields the user actually provided.",
      // Generated from EVENT_CREATE_FIELDS so the agent's draft can never drift
      // from the real EventCreateForm the nonprofit fills in.
      parameters: buildToolParameters(EVENT_CREATE_FIELDS),
    },
  },
  {
    type: "function",
    function: {
      name: "call_event_organizer",
      description:
        "Place an outbound phone call to an event organizer to ask questions on the caller's behalf. Use when the caller wants to contact or ask questions to event organizers. Requires the event id and a list of questions. The caller must be identified first (ask for their full name if not authenticated).",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description: "Id of the event whose organizer should be called.",
          },
          questions: {
            type: "array",
            items: { type: "string" },
            description: "Questions to ask the organizer, in order.",
          },
          caller_name: {
            type: "string",
            description:
              "Authenticated caller's full name, if known from the voice session.",
          },
        },
        required: ["event_id", "questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description:
        "Publish a new community event to the database. ONLY call after reading back all details and receiving explicit verbal confirmation from the user. Requires title, summary, and start_time.",
      parameters: CREATE_EVENT_PARAMS,
    },
  },
];

/**
 * Rich-UI channels get draft_event (prefilled form). Prose-only channels get
 * create_event (publish after verbal confirmation). Voice gets organizer calls.
 */
export function toolsFor(caps: ChannelCapabilities): ChatCompletionTool[] {
  const excluded = new Set<string>();
  if (caps.richUi) excluded.add("create_event");
  else excluded.add("draft_event");
  if (!caps.voiceTelephony) excluded.add("call_event_organizer");
  if (!caps.richUi) excluded.add("show_events");
  return toolDefinitions.filter((t) => !excluded.has(t.function.name));
}

/** Per-request context available to tool executors (e.g. who is calling). */
export interface ToolContext {
  /** The authenticated user's profile id, when known — required to persist memory. */
  profileId?: string | null;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  switch (name) {
    case "search_events":
      return runSearch(args);
    case "get_top_events":
      return runTopEvents(args);
    case "show_events":
      return runShowEvents(args);
    case "register_event":
      return runRegister(args);
    case "remember_user_fact":
      return runRemember(args, ctx);
    case "draft_event":
      return runDraft(args);
    case "create_event":
      return runCreate(args, ctx);
    case "call_event_organizer":
      return runCallOrganizer(args);
    default:
      return { forModel: JSON.stringify({ error: `unknown tool ${name}` }), actions: [] };
  }
}

async function runSearch(args: Record<string, unknown>): Promise<ToolOutcome> {
  const events = await searchEvents({
    query: str(args.query),
    tags: sanitizeStaticTags(args.tags),
    city: str(args.city),
    category: str(args.category) as EventCategory | undefined,
    from: str(args.from),
    to: str(args.to),
    isFree: bool(args.is_free),
    audience: str(args.audience),
    limit: num(args.limit) ?? 8,
  });
  const title = str(args.query)
    ? `Results for "${str(args.query)}"`
    : "Matching events";
  return {
    forModel: JSON.stringify({
      count: events.length,
      events: events.map(brief),
    }),
    actions: [{ type: "events", title, events: events.map(toPublicEvent) }],
  };
}

async function runTopEvents(args: Record<string, unknown>): Promise<ToolOutcome> {
  const events = await topEvents({
    tags: sanitizeStaticTags(args.tags),
    k: num(args.k) ?? 10,
    city: str(args.city),
    from: str(args.from),
    to: str(args.to),
    freeOnly: bool(args.free_only),
    preferFree: bool(args.free_only),
  });

  // The model sees the full candidate list (including internal_tags, which are
  // backend-only ranking hints) so it can curate; the UI action is what the
  // user sees, so the orchestrator only renders the events the model picks —
  // no action is emitted here.
  return {
    forModel: JSON.stringify({
      count: events.length,
      note: "Candidates ranked by tag match. Curate: call show_events with the ids of the few (usually 3) that best fit the user, in your preferred order.",
      events: events.map((e) => ({ ...brief(e), internal_tags: e.internal_tags })),
    }),
    actions: [],
  };
}

async function runRegister(args: Record<string, unknown>): Promise<ToolOutcome> {
  const eventId = str(args.event_id);
  if (!eventId) {
    return {
      forModel: JSON.stringify({
        ok: false,
        error:
          "event_id is required. First find the event (search/recommend), then register with its id.",
      }),
      actions: [],
    };
  }

  const event = await getEvent(eventId);
  if (!event) {
    return {
      forModel: JSON.stringify({ ok: false, error: "Event not found." }),
      actions: [],
    };
  }

  // Rich UI: surface the prefilled registration form (the client submits it
  // with its own auth + profile id, mirroring the draft_event flow). Prose
  // channels drop the action in finalize(), so the model relays the signup
  // details from `forModel` instead.
  const pub = toPublicEvent(event);
  return {
    forModel: JSON.stringify({
      ok: true,
      event: {
        id: pub.id,
        title: pub.title,
        start_time: pub.start_time,
        city: pub.city,
        is_free: pub.is_free,
        cost_note: pub.cost_note,
        registration_url: pub.registration_url,
        registration_instructions: pub.registration_instructions,
      },
      note: "On web the registration form is now shown below for the user to complete — tell them it's ready. On voice/text there is no form: read out registration_url or registration_instructions if present; otherwise say you've noted their interest and someone will follow up.",
    }),
    actions: [{ type: "event_registration", event: pub }],
  };
}

async function runRemember(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const predicate = isFactPredicate(args.predicate)
    ? (args.predicate as FactPredicate)
    : null;
  const object = str(args.object);
  if (!predicate || !object) {
    return {
      forModel: JSON.stringify({
        remembered: false,
        error:
          "Provide a valid predicate (from the allowed set) and a non-empty object.",
      }),
      actions: [],
    };
  }

  const confidence = num(args.confidence);
  if (!ctx.profileId) {
    // No signed-in profile to attach memory to (e.g. an unauthenticated
    // channel). Acknowledge so the model can still use it this turn.
    return {
      forModel: JSON.stringify({
        remembered: false,
        persisted: false,
        note: "No user profile on this session, so I can't store it long-term — I'll keep it in mind for now.",
      }),
      actions: [],
    };
  }

  try {
    const updated = await appendLearnedFacts(ctx.profileId, [
      {
        predicate,
        object,
        source: "conversation",
        confidence:
          typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.9,
      },
    ]);
    return {
      forModel: JSON.stringify({
        remembered: Boolean(updated),
        persisted: Boolean(updated),
        fact: { predicate, object },
      }),
      actions: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remember.";
    return {
      forModel: JSON.stringify({ remembered: false, error: message }),
      actions: [],
    };
  }
}

async function runDraft(args: Record<string, unknown>): Promise<ToolOutcome> {
  // Pass through only recognized fields — the allow-list is the create-form
  // template, so a field added to the form flows here automatically.
  const draft: EventDraft = {};
  const keys = aiFillableFieldIds(EVENT_CREATE_FIELDS).filter(
    (k) => k !== "accessibility",
  );
  for (const k of keys) {
    if (args[k] !== undefined && args[k] !== null && args[k] !== "") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (draft as any)[k] = args[k];
    }
  }
  if (Array.isArray(args.accessibility)) {
    draft.accessibility = (args.accessibility as unknown[]).map(String);
  }

  return {
    forModel: JSON.stringify({ drafted: true, fields: Object.keys(draft) }),
    actions: [{ type: "event_draft", draft }],
  };
}

async function runShowEvents(args: Record<string, unknown>): Promise<ToolOutcome> {
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
  const found = await Promise.all(ids.map((id) => getEvent(id)));
  const events = found.filter((e): e is EventRecord => e !== null);

  return {
    forModel: JSON.stringify({ shown: events.length }),
    actions:
      events.length > 0
        ? [
            {
              type: "events",
              title: str(args.title) ?? "Picked for you",
              events: events.map(toPublicEvent),
            },
          ]
        : [],
  };
}

async function runCreate(
  args: Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolOutcome> {
  if (args.confirmed !== true) {
    return {
      forModel: JSON.stringify({
        created: false,
        error:
          "User has not confirmed yet. Read back the details and ask if you should publish now.",
      }),
      actions: [],
    };
  }

  const built = buildEventInput(args);
  if ("error" in built) {
    return {
      forModel: JSON.stringify({ created: false, error: built.error }),
      actions: [],
    };
  }

  try {
    // Same tagging pipeline as the web publish path, so voice/WhatsApp-created
    // events are equally discoverable by tag.
    const { tags, internal_tags } = await tagEvent(built.input);
    const event = await createEvent({
      ...built.input,
      tags,
      internal_tags,
      created_by: ctx.profileId ?? null,
    });
    return {
      forModel: JSON.stringify({
        created: true,
        event: {
          id: event.id,
          title: event.title,
          start_time: event.start_time,
          city: event.city,
        },
      }),
      actions: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event.";
    return {
      forModel: JSON.stringify({ created: false, error: message }),
      actions: [],
    };
  }
}

async function runCallOrganizer(
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const eventId = str(args.event_id);
  const questions = Array.isArray(args.questions)
    ? args.questions.map(String).filter((q) => q.trim())
    : [];

  if (!eventId) {
    return {
      forModel: JSON.stringify({ placed: false, error: "event_id is required." }),
      actions: [],
    };
  }
  if (questions.length === 0) {
    return {
      forModel: JSON.stringify({
        placed: false,
        error: "At least one question is required.",
      }),
      actions: [],
    };
  }

  const event = await getEvent(eventId);
  if (!event) {
    return {
      forModel: JSON.stringify({ placed: false, error: "Event not found." }),
      actions: [],
    };
  }

  const organizerName = event.organizer_name ?? event.host_organization;
  const organizerPhone = event.organizer_phone;
  if (!organizerName || !organizerPhone) {
    return {
      forModel: JSON.stringify({
        placed: false,
        error: "This event has no organizer phone number on file.",
      }),
      actions: [],
    };
  }

  const result = await callEventOrganizer({
    organizerName,
    organizerPhone,
    eventTitle: event.title,
    questions,
    callerName: str(args.caller_name),
  });

  return {
    forModel: JSON.stringify({
      placed: result.placed,
      call_id: result.callId,
      mock: result.mock ?? false,
      organizer: organizerName,
      event_title: event.title,
      error: result.error,
    }),
    actions: [],
  };
}

function buildEventInput(
  args: Record<string, unknown>,
): { input: EventInput } | { error: string } {
  const title = str(args.title);
  const summary = str(args.summary);
  const startTime = str(args.start_time);

  if (!title) return { error: "A title is required." };
  if (!summary) return { error: "A short summary is required." };
  if (!startTime) return { error: "A start date/time is required." };
  if (Number.isNaN(Date.parse(startTime))) {
    return { error: "start_time must be a valid date-time." };
  }

  const input: EventInput = {
    title,
    summary,
    start_time: new Date(startTime).toISOString(),
    description: str(args.description) ?? null,
    category: asCategory(str(args.category)),
    end_time: str(args.end_time)
      ? new Date(str(args.end_time)!).toISOString()
      : null,
    is_online: bool(args.is_online) ?? false,
    online_url: str(args.online_url) ?? null,
    location_name: str(args.location_name) ?? null,
    address: str(args.address) ?? null,
    city: str(args.city) ?? null,
    is_free: bool(args.is_free) ?? true,
    cost_note: str(args.cost_note) ?? null,
    audience: str(args.audience) ?? null,
    accessibility: Array.isArray(args.accessibility)
      ? (args.accessibility as unknown[]).map(String)
      : [],
    transportation: str(args.transportation) ?? null,
    registration_url: str(args.registration_url) ?? null,
    registration_instructions: str(args.registration_instructions) ?? null,
    host_organization: str(args.host_organization) ?? null,
  };

  return { input };
}

function asCategory(v: string | undefined): EventCategory {
  return v && (EVENT_CATEGORIES as readonly string[]).includes(v)
    ? (v as EventCategory)
    : "other";
}

// --- brief + coercion helpers ---------------------------------------------

function brief(e: EventRecord) {
  return {
    id: e.id,
    title: e.title,
    summary: e.summary,
    category: e.category,
    tags: e.tags,
    start_time: e.start_time,
    city: e.city,
    is_free: e.is_free,
    accessibility: e.accessibility,
    organizer_name: e.organizer_name,
    organizer_phone: e.organizer_phone ? "(on file)" : null,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
