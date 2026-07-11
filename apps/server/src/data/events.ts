import { getSupabaseAdmin } from "./client";
import { mockStore } from "./mock-store";
import type {
  EventInput,
  EventRecord,
  EventSearchFilters,
} from "@chiron/shared";

// The events repository — the single wrapper the rest of the app uses to touch
// event data. It transparently targets Supabase when configured and an
// in-memory store otherwise, so callers never branch on backend.

const TABLE = "events";
const DEFAULT_LIMIT = 20;

export async function searchEvents(
  filters: EventSearchFilters = {},
): Promise<EventRecord[]> {
  const db = getSupabaseAdmin();
  if (!db) return mockStore.search(filters);

  let query = db.from(TABLE).select("*");

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.city) query = query.ilike("city", filters.city);
  if (typeof filters.isFree === "boolean")
    query = query.eq("is_free", filters.isFree);
  if (filters.audience) query = query.ilike("audience", `%${filters.audience}%`);
  if (filters.from) query = query.gte("start_time", filters.from);
  if (filters.to) query = query.lte("start_time", filters.to);
  if (filters.query) {
    const term = `%${filters.query}%`;
    query = query.or(
      [
        `title.ilike.${term}`,
        `summary.ilike.${term}`,
        `description.ilike.${term}`,
        `host_organization.ilike.${term}`,
      ].join(","),
    );
  }

  query = query
    .order("start_time", { ascending: true })
    .limit(filters.limit ?? DEFAULT_LIMIT);

  const { data, error } = await query;
  if (error) throw new Error(`searchEvents failed: ${error.message}`);
  return (data ?? []) as EventRecord[];
}

export async function upcomingEvents(
  limit = DEFAULT_LIMIT,
): Promise<EventRecord[]> {
  const db = getSupabaseAdmin();
  if (!db) return mockStore.upcoming(limit);

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`upcomingEvents failed: ${error.message}`);
  return (data ?? []) as EventRecord[];
}

export async function getEvent(id: string): Promise<EventRecord | null> {
  const db = getSupabaseAdmin();
  if (!db) return mockStore.get(id);

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getEvent failed: ${error.message}`);
  return (data as EventRecord | null) ?? null;
}

export async function createEvent(input: EventInput): Promise<EventRecord> {
  const db = getSupabaseAdmin();
  if (!db) return mockStore.create(input);

  const { data, error } = await db
    .from(TABLE)
    .insert(input)
    .select("*")
    .single();

  if (error) throw new Error(`createEvent failed: ${error.message}`);
  return data as EventRecord;
}
