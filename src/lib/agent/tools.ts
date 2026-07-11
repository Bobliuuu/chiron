import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { searchEvents, upcomingEvents } from "@/lib/supabase/events";
import {
  EVENT_CATEGORIES,
  type EventCategory,
  type EventDraft,
} from "@/lib/types/events";
import type { UiAction } from "@/lib/agent/types";

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
        "Find existing community events matching concrete filters. Use for queries like 'food bank events in Markham' or 'free things this weekend'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text keywords (e.g. 'food bank', 'coding').",
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
      name: "recommend_events",
      description:
        "Recommend a small, curated set of upcoming events. Use when the user asks for suggestions or gives a profile/need rather than exact filters.",
      parameters: {
        type: "object",
        properties: {
          interests: {
            type: "string",
            description: "What the user is interested in, in their words.",
          },
          city: { type: "string" },
          audience: { type: "string" },
          is_free: { type: "boolean" },
          limit: { type: "number", description: "Max recommendations (default 3)." },
        },
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
];

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (name) {
    case "search_events":
      return runSearch(args);
    case "recommend_events":
      return runRecommend(args);
    case "draft_event":
      return runDraft(args);
    default:
      return { forModel: JSON.stringify({ error: `unknown tool ${name}` }), actions: [] };
  }
}

async function runSearch(args: Record<string, unknown>): Promise<ToolOutcome> {
  const events = await searchEvents({
    query: str(args.query),
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
    actions: [{ type: "events", title, events }],
  };
}

async function runRecommend(args: Record<string, unknown>): Promise<ToolOutcome> {
  const limit = num(args.limit) ?? 3;
  // Try to honor stated interests, but always fall back to upcoming events so
  // the user never gets an empty recommendation.
  let events = await searchEvents({
    query: str(args.interests),
    city: str(args.city),
    audience: str(args.audience),
    isFree: bool(args.is_free),
    limit,
  });
  if (events.length === 0) events = await upcomingEvents(limit);

  return {
    forModel: JSON.stringify({
      count: events.length,
      events: events.map(brief),
    }),
    actions: [{ type: "events", title: "Recommended for you", events }],
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

// --- brief + coercion helpers ---------------------------------------------

function brief(e: {
  id: string;
  title: string;
  summary: string;
  category: string;
  start_time: string;
  city: string | null;
  is_free: boolean;
}) {
  return {
    id: e.id,
    title: e.title,
    summary: e.summary,
    category: e.category,
    start_time: e.start_time,
    city: e.city,
    is_free: e.is_free,
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
