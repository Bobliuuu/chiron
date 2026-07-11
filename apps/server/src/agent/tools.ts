import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { createEvent, getEvent, searchEvents, topEvents } from "../data/events";
import { tagEvent } from "../pipeline/tag-event";
import {
  EVENT_CATEGORIES,
  STATIC_TAGS,
  sanitizeStaticTags,
  toPublicEvent,
  type ChannelCapabilities,
  type EventCategory,
  type EventDraft,
  type EventInput,
  type EventRecord,
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
      name: "draft_event",
      description:
        "Prepare a prefilled event-creation form from what the user described. Does NOT publish — it surfaces a draft the nonprofit reviews and submits. Fill only the fields the user actually provided.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string", description: "Plain-language one-liner." },
          description: { type: "string" },
          category: {
            type: "string",
            enum: EVENT_CATEGORIES as unknown as string[],
          },
          start_time: {
            type: "string",
            description: "ISO 8601 start date-time.",
          },
          end_time: { type: "string", description: "ISO 8601 end date-time." },
          is_online: { type: "boolean" },
          online_url: { type: "string" },
          location_name: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          is_free: { type: "boolean" },
          cost_note: { type: "string" },
          audience: { type: "string" },
          accessibility: { type: "array", items: { type: "string" } },
          transportation: { type: "string" },
          registration_url: { type: "string" },
          registration_instructions: { type: "string" },
          host_organization: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_event",
      description:
        "Publish a new community event to the database. ONLY call after reading back all details and receiving explicit verbal confirmation from the user. Requires title, summary, and start_time.",
      parameters: {
        type: "object",
        properties: {
          confirmed: {
            type: "boolean",
            description:
              "Must be true — only set after the user explicitly agrees to publish.",
          },
          title: { type: "string" },
          summary: { type: "string", description: "Plain-language one-liner." },
          description: { type: "string" },
          category: {
            type: "string",
            enum: EVENT_CATEGORIES as unknown as string[],
          },
          start_time: {
            type: "string",
            description: "ISO 8601 start date-time.",
          },
          end_time: { type: "string", description: "ISO 8601 end date-time." },
          is_online: { type: "boolean" },
          online_url: { type: "string" },
          location_name: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          is_free: { type: "boolean" },
          cost_note: { type: "string" },
          audience: { type: "string" },
          accessibility: { type: "array", items: { type: "string" } },
          transportation: { type: "string" },
          registration_url: { type: "string" },
          registration_instructions: { type: "string" },
          host_organization: { type: "string" },
        },
        required: ["confirmed", "title", "summary", "start_time"],
      },
    },
  },
];

/**
 * Rich-UI channels get draft_event (prefilled form). Prose-only channels get
 * create_event (publish after verbal confirmation) instead.
 */
export function toolsFor(caps: ChannelCapabilities): ChatCompletionTool[] {
  const excluded = caps.richUi ? "create_event" : "draft_event";
  return toolDefinitions.filter((t) => t.function.name !== excluded);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (name) {
    case "search_events":
      return runSearch(args);
    case "get_top_events":
      return runTopEvents(args);
    case "show_events":
      return runShowEvents(args);
    case "draft_event":
      return runDraft(args);
    case "create_event":
      return runCreate(args);
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

async function runDraft(args: Record<string, unknown>): Promise<ToolOutcome> {
  // Pass through only recognized fields.
  const draft: EventDraft = {};
  const keys: (keyof EventDraft)[] = [
    "title",
    "summary",
    "description",
    "category",
    "start_time",
    "end_time",
    "is_online",
    "online_url",
    "location_name",
    "address",
    "city",
    "is_free",
    "cost_note",
    "audience",
    "transportation",
    "registration_url",
    "registration_instructions",
    "host_organization",
  ];
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

async function runCreate(args: Record<string, unknown>): Promise<ToolOutcome> {
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
    const event = await createEvent({ ...built.input, tags, internal_tags });
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
