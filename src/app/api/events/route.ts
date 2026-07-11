import { createEvent, upcomingEvents } from "@/lib/supabase/events";
import { tagEvent } from "@/lib/pipeline/tag-event";
import {
  EVENT_CATEGORIES,
  toPublicEvent,
  type EventCategory,
  type EventInput,
} from "@/lib/types/events";

export const runtime = "nodejs";

// GET /api/events -> upcoming events (for the results/calendar panel)
export async function GET(): Promise<Response> {
  try {
    const events = await upcomingEvents(50);
    return Response.json({ events: events.map(toPublicEvent) });
  } catch (err) {
    console.error("[/api/events GET] error:", err);
    return Response.json({ error: "Failed to load events." }, { status: 500 });
  }
}

// POST /api/events -> create an event (nonprofit form submit)
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = validate(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  try {
    // Tagging pipeline: derive static tags (per the rubric) and internal
    // ranking tags before the row is written, so the event is immediately
    // discoverable by tag.
    const { tags, internal_tags } = await tagEvent(parsed.input);
    const event = await createEvent({ ...parsed.input, tags, internal_tags });
    return Response.json({ event: toPublicEvent(event) }, { status: 201 });
  } catch (err) {
    console.error("[/api/events POST] error:", err);
    return Response.json({ error: "Failed to create event." }, { status: 500 });
  }
}

function validate(
  body: unknown,
): { input: EventInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const title = asString(b.title);
  const summary = asString(b.summary);
  const startTime = asString(b.start_time);

  if (!title) return { error: "A title is required." };
  if (!summary) return { error: "A short summary is required." };
  if (!startTime) return { error: "A start date/time is required." };
  if (Number.isNaN(Date.parse(startTime)))
    return { error: "start_time must be a valid date-time." };

  const category = asCategory(b.category);

  const input: EventInput = {
    title,
    summary,
    start_time: new Date(startTime).toISOString(),
    description: asString(b.description) ?? null,
    category,
    end_time: asString(b.end_time)
      ? new Date(asString(b.end_time)!).toISOString()
      : null,
    is_online: asBool(b.is_online) ?? false,
    online_url: asString(b.online_url) ?? null,
    location_name: asString(b.location_name) ?? null,
    address: asString(b.address) ?? null,
    city: asString(b.city) ?? null,
    is_free: asBool(b.is_free) ?? true,
    cost_note: asString(b.cost_note) ?? null,
    audience: asString(b.audience) ?? null,
    accessibility: Array.isArray(b.accessibility)
      ? b.accessibility.map(String)
      : [],
    transportation: asString(b.transportation) ?? null,
    registration_url: asString(b.registration_url) ?? null,
    registration_instructions: asString(b.registration_instructions) ?? null,
    host_organization: asString(b.host_organization) ?? null,
  };

  return { input };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
function asCategory(v: unknown): EventCategory {
  return typeof v === "string" && (EVENT_CATEGORIES as readonly string[]).includes(v)
    ? (v as EventCategory)
    : "other";
}
