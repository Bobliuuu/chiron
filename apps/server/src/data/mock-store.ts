import type {
  EventInput,
  EventRecord,
  EventSearchFilters,
} from "@chiron/shared";

// In-memory events store used when Supabase is not configured. It mirrors the
// shape and behavior of the real table so the rest of the app is agnostic to
// which backend is active. Data resets on server restart.

let counter = 0;
const uid = () => `evt_${(++counter).toString().padStart(4, "0")}`;

function daysFromNow(days: number, hour: number, minutes = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minutes, 0, 0);
  return d.toISOString();
}

function seed(input: EventInput): EventRecord {
  const now = new Date().toISOString();
  return {
    id: uid(),
    description: null,
    end_time: null,
    is_online: false,
    online_url: null,
    location_name: null,
    address: null,
    city: null,
    is_free: true,
    cost_note: null,
    audience: null,
    accessibility: [],
    transportation: null,
    registration_url: null,
    registration_instructions: null,
    host_organization: null,
    organizer_name: null,
    organizer_phone: null,
    category: "other",
    tags: [],
    internal_tags: [],
    image_url: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...input,
  };
}

const store: EventRecord[] = [
  seed({
    title: "Markham Community Food Bank — Evening Distribution",
    summary: "Free groceries and fresh produce, no appointment needed.",
    description:
      "Weekly evening food bank distribution. Bring a bag; volunteers help carry.",
    category: "food_bank",
    start_time: daysFromNow(3, 17),
    end_time: daysFromNow(3, 20),
    location_name: "Markham Community Centre",
    address: "3201 Bur Oak Ave",
    city: "Markham",
    is_free: true,
    audience: "families, individuals",
    accessibility: ["wheelchair"],
    transportation: "On the 5 bus route",
    registration_instructions: "Walk in during distribution hours.",
    host_organization: "Markham Food Network",
    organizer_name: "Sarah Patel",
    organizer_phone: "+14165550101",
    tags: ["food", "free", "in_person", "drop_in", "recurring", "families", "adults", "wheelchair"],
    internal_tags: ["evening_only", "bring_your_own_bag", "volunteers_assist"],
  }),
  seed({
    title: "Feed the Neighbourhood Charity Fundraiser",
    summary: "An evening gala to raise funds for local food security programs.",
    description:
      "Dinner, silent auction, and live music supporting food banks across York Region.",
    category: "fundraiser",
    start_time: daysFromNow(10, 18),
    end_time: daysFromNow(10, 22),
    location_name: "The Cherry Street Hall",
    address: "15 Cherry St",
    city: "Toronto",
    is_free: false,
    cost_note: "$75 per ticket",
    audience: "adults",
    accessibility: ["wheelchair", "asl"],
    transportation: "Streetcar 504 to Cherry St",
    registration_url: "https://example.org/feed-the-neighbourhood",
    registration_instructions: "Purchase tickets online in advance.",
    host_organization: "Toronto Cares Foundation",
    organizer_name: "David Kim",
    organizer_phone: "+14165550102",
    tags: ["volunteering", "adults", "in_person", "registration_needed", "wheelchair", "asl"],
    internal_tags: ["evening_only", "formal_attire", "loud_music", "food_provided"],
  }),
  seed({
    title: "Youth Coding Club — Saturday Session",
    summary: "Free drop-in coding club for teens, all skill levels welcome.",
    description:
      "Learn the basics of web development with mentors from local tech companies.",
    category: "youth",
    start_time: daysFromNow(5, 10),
    end_time: daysFromNow(5, 12),
    location_name: "Scarborough Public Library",
    address: "1076 Ellesmere Rd",
    city: "Toronto",
    is_free: true,
    audience: "teens 13-18",
    registration_url: "https://example.org/youth-coding",
    registration_instructions: "Register online, spots limited.",
    host_organization: "Code Forward",
    organizer_name: "Aisha Rahman",
    organizer_phone: "+14165550103",
    tags: ["teens", "education", "free", "in_person", "registration_needed", "recurring"],
    internal_tags: ["beginner_friendly", "mentors_present", "limited_spots"],
  }),
  seed({
    title: "Senior Wellness Morning",
    summary: "Gentle exercise, health screening, and coffee for seniors.",
    description:
      "A relaxed morning of chair yoga, blood-pressure checks, and social time.",
    category: "seniors",
    start_time: daysFromNow(7, 9),
    end_time: daysFromNow(7, 11),
    location_name: "Markham Seniors Centre",
    address: "8100 Warden Ave",
    city: "Markham",
    is_free: true,
    audience: "seniors 55+",
    accessibility: ["wheelchair", "large_print"],
    transportation: "Parking and transit available",
    registration_instructions: "Just show up, or call ahead.",
    host_organization: "York Region Health Collective",
    organizer_name: "Robert Nguyen",
    organizer_phone: "+14165550104",
    tags: ["seniors", "health", "sports", "free", "in_person", "drop_in", "wheelchair", "large_print", "quiet_space"],
    internal_tags: ["morning_only", "gentle_pace", "refreshments_provided"],
  }),
];

/** Pure, backend-agnostic filter used by both the mock store and tests. */
export function applyFilters(
  events: EventRecord[],
  filters: EventSearchFilters,
): EventRecord[] {
  const q = filters.query?.toLowerCase().trim();
  const city = filters.city?.toLowerCase().trim();
  const audience = filters.audience?.toLowerCase().trim();

  return events
    .filter((e) => {
      if (filters.category && e.category !== filters.category) return false;
      if (
        filters.tags &&
        filters.tags.length > 0 &&
        !filters.tags.some((t) => e.tags.includes(t))
      )
        return false;
      if (city && (e.city ?? "").toLowerCase() !== city) return false;
      if (typeof filters.isFree === "boolean" && e.is_free !== filters.isFree)
        return false;
      if (audience && !(e.audience ?? "").toLowerCase().includes(audience))
        return false;
      if (filters.from && e.start_time < filters.from) return false;
      if (filters.to && e.start_time > filters.to) return false;
      if (q) {
        const haystack = [
          e.title,
          e.summary,
          e.description ?? "",
          e.host_organization ?? "",
          e.category,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export const mockStore = {
  search(filters: EventSearchFilters): EventRecord[] {
    const results = applyFilters(store, filters);
    return typeof filters.limit === "number"
      ? results.slice(0, filters.limit)
      : results;
  },
  upcoming(limit = 20): EventRecord[] {
    const nowIso = new Date().toISOString();
    return applyFilters(store, { from: nowIso }).slice(0, limit);
  },
  get(id: string): EventRecord | null {
    return store.find((e) => e.id === id) ?? null;
  },
  create(input: EventInput): EventRecord {
    const record = seed(input);
    store.unshift(record);
    return record;
  },
  byCreator(userId: string): EventRecord[] {
    return store
      .filter((e) => e.created_by === userId)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  },
  update(id: string, patch: Partial<EventInput>): EventRecord {
    const idx = store.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`updateEvent failed: ${id} not found`);
    store[idx] = { ...store[idx], ...patch, updated_at: new Date().toISOString() } as EventRecord;
    return store[idx];
  },
};
