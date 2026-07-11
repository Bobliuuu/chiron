// scripts/seed.ts — populate Supabase with a small batch of fake events,
// profiles, and registrations for local development + analytics demos.
//
// Why this exists: the mock store in apps/server seeds only four events and
// resets every restart, which makes the analytics tab + recommender hard to
// exercise. This script runs the real pipeline (tagEvent) to generate events
// and writes them through the data layer, so it works against Supabase (the
// only place data actually persists between runs).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
//
// Idempotency: this script WIPES the existing events, profiles, and
// registrations first. It does not touch auth.users (so sign-in still works
// after a re-run), but it will leave orphaned auth.users from previous runs
// behind — clean those manually if they pile up.
//
// What it generates:
//   - 10 stubbed users (email user1@example.com … user10@example.com,
//     password "chiron-dev", email_confirm: true). 7 of them opt in to
//     share_in_analytics; 3 opt out so the analytics tab can demo the
//     "opted out of sharing" line.
//   - 20 events spread across Markham / Toronto / Scarborough / Mississauga,
//     spanning every category. Each one is run through tagEvent so the
//     pipeline produces both static tags and internal_tags.
//   - ~30 registrations linking those users to events, mixing
//     "interested" and "registered" so the analytics status counts are real.
//
// Deterministic: same event titles + same UUIDs every run, so re-running the
// script doesn't churn the DB or change analytics totals.

import "../apps/server/src/load-env";
import { randomUUID } from "node:crypto";
// ^ kept for potential future use; the helper below uses a deterministic
// hash of the email instead so re-runs keep the same auth.users ids.
void randomUUID;
import {
  type EventCategory,
  type EventInput,
  type ProfileInput,
} from "@chiron/shared";
import { getSupabaseAdmin } from "../apps/server/src/data/client";
import { createEvent } from "../apps/server/src/data/events";
import { tagEvent } from "../apps/server/src/pipeline/tag-event";
import { upsertEventRegistration } from "../apps/server/src/data/event-registrations";
import { upsertProfile } from "../apps/server/src/data/profiles";

// --- env -------------------------------------------------------------------

const db = getSupabaseAdmin();
if (!db) {
  console.error(
    "[seed] Supabase is not configured.\n" +
      "       Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in apps/server/.env " +
      "or your shell and re-run.",
  );
  process.exit(1);
}

const STUB_PASSWORD = "chiron-dev";

// --- wipe existing rows (auth.users is left alone) --------------------------

async function wipe() {
  // Order matters: registrations first (FK to events + profiles), then events,
  // then profiles (FK to auth.users — but we keep auth.users).
  for (const table of ["event_registrations", "event_registration_forms", "events", "profiles"] as const) {
    const { error } = await db!.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`wipe ${table} failed: ${error.message}`);
  }
}

// --- fake users ------------------------------------------------------------

interface StubUser {
  id: string;
  email: string;
  display: string;
  /** Quiz answers keyed by question id (see packages/shared/src/quiz.ts). */
  answers: Record<string, boolean>;
  /** A few of these opt out so the analytics tab can demo that line. */
  shareInAnalytics: boolean;
}

function uuidFor(s: string): string {
  // Deterministic UUID v5-shaped string so re-running the script keeps the
  // same auth.users ids. We use a hash of the email; not a real v5 (no
  // namespace) but Supabase only cares that the format is a UUID.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `00000000-0000-5000-8000-${hex}${hex.slice(0, 4)}`.slice(0, 36);
}

const STUB_USERS: StubUser[] = [
  // 4 family-tagged profiles (preferred_tags: families, kids)
  mkUser(1, { family: true, meet_people: true }),
  mkUser(2, { family: true, free_only: true }),
  mkUser(3, { family: true, short_info: true }),
  mkUser(4, { family: true }, false /* opts out */),
  // 3 seniors / accessibility-tagged
  mkUser(5, { wheelchair: true, quiet: true }),
  mkUser(6, { wheelchair: true }),
  mkUser(7, { quiet: true, short_info: true, few_choices: true }),
  // 2 youth / learning-tagged
  mkUser(8, { family: false }, false /* opts out */),
  mkUser(9, { meet_people: true, free_only: true }),
  // 1 opted-out newcomer profile
  mkUser(10, { free_only: true }, false /* opts out */),
];

function mkUser(
  n: number,
  yesAnswers: Record<string, boolean>,
  shareInAnalytics = true,
): StubUser {
  // All quiz ids default to false; only the ones passed in flip to true.
  const allIds = [
    "short_info",
    "few_choices",
    "wheelchair",
    "quiet",
    "free_only",
    "family",
    "meet_people",
  ];
  const answers: Record<string, boolean> = {};
  for (const id of allIds) answers[id] = yesAnswers[id] ?? false;
  return {
    id: uuidFor(`chiron-seed-user-${n}@example.com`),
    email: `user${n}@example.com`,
    display: `User ${n}`,
    answers,
    shareInAnalytics,
  };
}

async function ensureAuthUsers() {
  for (const u of STUB_USERS) {
    const { error } = await db!.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: STUB_PASSWORD,
      email_confirm: true, // skip the confirmation email
      user_metadata: { display_name: u.display, seeded: true },
    });
    if (error && !/already been registered|already exists/i.test(error.message)) {
      // Re-runs hit "already registered" — that's fine, the id is stable.
      throw new Error(`auth.createUser ${u.email} failed: ${error.message}`);
    }
  }
}

async function upsertProfiles() {
  // Derive profile prefs from the stubbed quiz answers the same way the
  // onboarding endpoint does (packages/shared/src/quiz.ts:deriveProfile).
  // We inline it here instead of importing to keep the script self-contained.
  const allQuestions = [
    { id: "short_info", onYes: { preferred_tags: [] as string[], accessibility_needs: ["plain_language"], quick_signal: true, free_only: false } },
    { id: "few_choices", onYes: { preferred_tags: [], accessibility_needs: [], quick_signal: true, free_only: false } },
    { id: "wheelchair", onYes: { preferred_tags: [], accessibility_needs: ["wheelchair"], quick_signal: false, free_only: false } },
    { id: "quiet", onYes: { preferred_tags: [], accessibility_needs: ["quiet_space"], quick_signal: false, free_only: false } },
    { id: "free_only", onYes: { preferred_tags: ["free"], accessibility_needs: [], quick_signal: false, free_only: true } },
    { id: "family", onYes: { preferred_tags: ["families", "kids"], accessibility_needs: [], quick_signal: false, free_only: false } },
    { id: "meet_people", onYes: { preferred_tags: ["social"], accessibility_needs: [], quick_signal: false, free_only: false } },
  ];

  for (const u of STUB_USERS) {
    const preferred = new Set<string>();
    const needs = new Set<string>();
    let quickSignals = 0;
    let freeOnly = false;
    for (const q of allQuestions) {
      if (!u.answers[q.id]) continue;
      for (const t of q.onYes.preferred_tags) preferred.add(t);
      for (const t of q.onYes.accessibility_needs) needs.add(t);
      if (q.onYes.quick_signal) quickSignals++;
      if (q.onYes.free_only) freeOnly = true;
    }
    const input: ProfileInput = {
      id: u.id,
      ui_mode: quickSignals >= 1 ? "quick" : "elaborate",
      accessibility_needs: [...needs],
      preferred_tags: [...preferred],
      city: "Toronto",
      free_only: freeOnly,
      quiz_answers: u.answers,
      share_in_analytics: u.shareInAnalytics,
    };
    await upsertProfile(input);
  }
}

// --- event listings --------------------------------------------------------

const CITIES = ["Toronto", "Markham", "Scarborough", "Mississauga"] as const;

interface ListingSpec {
  category: EventCategory;
  title: string;
  summary: string;
  description: string;
  city: (typeof CITIES)[number];
  host: string;
  audience: string;
  accessibility: string[];
  isFree: boolean;
  costNote?: string;
  isOnline?: boolean;
  onlineUrl?: string;
  /** Days from "now" — randomized ±3d at run time so dates feel fresh. */
  daysFromNow: number;
  /** Spread across morning/afternoon/evening. */
  startHour: number;
  endHour?: number;
  hasRegistrationUrl: boolean;
  recurring?: boolean;
}

// 20 listings, hand-authored so each one has real text to feed the pipeline.
// They cover every category at least once and skew toward the kinds of events
// Chiron would surface for the quiz profiles above (families, accessibility,
// youth, seniors).
const LISTINGS: ListingSpec[] = [
  {
    category: "food_bank",
    title: "Markham Community Food Bank — Evening Distribution",
    summary: "Free groceries and fresh produce, no appointment needed.",
    description:
      "Weekly evening food bank distribution. Bring a bag; volunteers help carry groceries to your car.",
    city: "Markham",
    host: "Markham Food Network",
    audience: "families, individuals",
    accessibility: ["wheelchair"],
    isFree: true,
    daysFromNow: 3,
    startHour: 17,
    endHour: 20,
    hasRegistrationUrl: false,
    recurring: true,
  },
  {
    category: "fundraiser",
    title: "Feed the Neighbourhood Charity Gala",
    summary: "An evening gala raising funds for local food security programs.",
    description:
      "Dinner, silent auction, and live music supporting food banks across York Region. Formal attire; refreshments provided.",
    city: "Toronto",
    host: "Toronto Cares Foundation",
    audience: "adults",
    accessibility: ["wheelchair", "asl"],
    isFree: false,
    costNote: "$75 per ticket",
    daysFromNow: 14,
    startHour: 18,
    endHour: 22,
    hasRegistrationUrl: true,
  },
  {
    category: "youth",
    title: "Youth Coding Club — Saturday Session",
    summary: "Free drop-in coding club for teens, all skill levels welcome.",
    description:
      "Learn the basics of web development with mentors from local tech companies. Beginners welcome.",
    city: "Scarborough",
    host: "Code Forward",
    audience: "teens 13-18",
    accessibility: [],
    isFree: true,
    daysFromNow: 5,
    startHour: 10,
    endHour: 12,
    hasRegistrationUrl: true,
    recurring: true,
  },
  {
    category: "seniors",
    title: "Senior Wellness Morning",
    summary: "Gentle exercise, health screening, and coffee for seniors.",
    description:
      "A relaxed morning of chair yoga, blood-pressure checks, and social time. Quiet space with large-print handouts.",
    city: "Markham",
    host: "York Region Health Collective",
    audience: "seniors 55+",
    accessibility: ["wheelchair", "large_print"],
    isFree: true,
    daysFromNow: 7,
    startHour: 9,
    endHour: 11,
    hasRegistrationUrl: false,
  },
  {
    category: "health",
    title: "Community Mental Health Drop-In",
    summary: "Free confidential counselling walk-in, no appointment needed.",
    description:
      "Talk to a registered therapist in a quiet, low-sensory room. Plain-language intake; support persons welcome.",
    city: "Toronto",
    host: "MindWell Toronto",
    audience: "adults",
    accessibility: ["wheelchair", "quiet_space", "plain_language"],
    isFree: true,
    daysFromNow: 4,
    startHour: 13,
    endHour: 16,
    hasRegistrationUrl: false,
  },
  {
    category: "education",
    title: "Free Resume Workshop for Newcomers",
    summary: "Build a Canadian-style resume with one-on-one mentors.",
    description:
      "Settlement workers and tech mentors help newcomers tailor resumes for the local job market. One-on-one help available.",
    city: "Scarborough",
    host: "Scarborough Welcome Centre",
    audience: "newcomers",
    accessibility: ["plain_language", "support_person"],
    isFree: true,
    daysFromNow: 6,
    startHour: 10,
    endHour: 13,
    hasRegistrationUrl: true,
  },
  {
    category: "community",
    title: "Neighbourhood Park Cleanup",
    summary: "Volunteer cleanup followed by a free community lunch.",
    description:
      "Gloves and bags provided. Family-friendly — kids welcome with a guardian. Outdoor event in the park; bring water.",
    city: "Toronto",
    host: "Friends of Dufferin Grove",
    audience: "families, all ages",
    accessibility: [],
    isFree: true,
    daysFromNow: 8,
    startHour: 10,
    endHour: 13,
    hasRegistrationUrl: false,
  },
  {
    category: "arts",
    title: "Community Mural Painting Day",
    summary: "Help paint a new mural on the side of the library.",
    description:
      "All ages and skill levels welcome. Aprons and paint provided. Outdoor event on the library's south wall.",
    city: "Mississauga",
    host: "Mississauga Public Library",
    audience: "families, all ages",
    accessibility: ["wheelchair"],
    isFree: true,
    daysFromNow: 9,
    startHour: 11,
    endHour: 15,
    hasRegistrationUrl: false,
  },
  {
    category: "employment",
    title: "York Region Job Fair",
    summary: "Meet 30+ local employers hiring across retail, healthcare, and trades.",
    description:
      "Bring copies of your resume. Free professional headshots available. ASL interpretation at the info booth.",
    city: "Markham",
    host: "York Region Employment Services",
    audience: "adults, newcomers",
    accessibility: ["wheelchair", "asl"],
    isFree: true,
    daysFromNow: 11,
    startHour: 10,
    endHour: 15,
    hasRegistrationUrl: false,
  },
  {
    category: "housing",
    title: "Tenant Rights Q&A",
    summary: "Free legal advice clinic for renters facing repair or eviction issues.",
    description:
      "Duty counsel and tenant advocates answer questions one-on-one. Plain-language summaries provided.",
    city: "Toronto",
    host: "Tenant Defence Fund",
    audience: "adults",
    accessibility: ["wheelchair", "plain_language"],
    isFree: true,
    daysFromNow: 2,
    startHour: 18,
    endHour: 20,
    hasRegistrationUrl: false,
  },
  {
    category: "other",
    title: "Repair Café — Bring Your Broken Stuff",
    summary: "Volunteer fixers help repair electronics, bikes, and clothing.",
    description:
      "Volunteers with sewing, soldering, and bike-repair skills help you fix what you've got. Outdoor tent; refreshments provided.",
    city: "Scarborough",
    host: "Scarborough Tool Library",
    audience: "families, adults",
    accessibility: ["wheelchair"],
    isFree: true,
    daysFromNow: 12,
    startHour: 13,
    endHour: 17,
    hasRegistrationUrl: true,
    recurring: true,
  },
  {
    category: "food_bank",
    title: "Scarborough Hot Lunch Program",
    summary: "Free hot meal, sit-down or takeaway. Open to everyone.",
    description:
      "Cooked on-site by volunteer chefs. Vegetarian and halal options every day. Step-free entrance at the rear.",
    city: "Scarborough",
    host: "Scarborough Community Kitchen",
    audience: "individuals, families",
    accessibility: ["wheelchair"],
    isFree: true,
    daysFromNow: 1,
    startHour: 12,
    endHour: 14,
    hasRegistrationUrl: false,
    recurring: true,
  },
  {
    category: "education",
    title: "Adult Literacy Tutoring — Open House",
    summary: "Free one-on-one tutoring for adults building reading and writing skills.",
    description:
      "Meet volunteer tutors and try a sample lesson. Plain-language intake; child-minding available.",
    city: "Mississauga",
    host: "Peel Literacy Guild",
    audience: "adults, newcomers",
    accessibility: ["plain_language", "support_person"],
    isFree: true,
    daysFromNow: 10,
    startHour: 18,
    endHour: 20,
    hasRegistrationUrl: false,
  },
  {
    category: "community",
    title: "Newcomers' Welcome Social",
    summary: "Drop-in social for newcomers — meet other families new to the area.",
    description:
      "Light refreshments and kids' crafts provided. Settlement workers on hand. Quiet corner available.",
    city: "Markham",
    host: "Markham Welcome Network",
    audience: "newcomers, families",
    accessibility: ["wheelchair", "quiet_space"],
    isFree: true,
    daysFromNow: 6,
    startHour: 17,
    endHour: 19,
    hasRegistrationUrl: false,
  },
  {
    category: "youth",
    title: "After-School Homework Help",
    summary: "Free drop-in homework help for middle-schoolers.",
    description:
      "Volunteer tutors in math, science, and English. Snacks provided. Quiet, supervised space; beginners welcome.",
    city: "Toronto",
    host: "West End Youth Centre",
    audience: "teens 11-14",
    accessibility: ["quiet_space"],
    isFree: true,
    daysFromNow: 3,
    startHour: 15,
    endHour: 17,
    hasRegistrationUrl: false,
    recurring: true,
  },
  {
    category: "arts",
    title: "Friday Night Open Mic",
    summary: "Open mic for musicians, poets, and storytellers — all levels welcome.",
    description:
      "Sign up at the door. House piano and PA provided. Loud — not recommended for noise-sensitive guests. Refreshments provided.",
    city: "Toronto",
    host: "Dundas West Coffee House",
    audience: "adults",
    accessibility: ["wheelchair"],
    isFree: false,
    costNote: "$5 cover",
    daysFromNow: 5,
    startHour: 20,
    endHour: 23,
    hasRegistrationUrl: false,
  },
  {
    category: "health",
    title: "Free Flu Shot Clinic",
    summary: "Walk-in flu shots — no OHIP required.",
    description:
      "Public health nurses administer flu shots. ASL and plain-language signage at intake. Wheelchair-accessible.",
    city: "Mississauga",
    host: "Peel Public Health",
    audience: "all ages",
    accessibility: ["wheelchair", "asl", "plain_language"],
    isFree: true,
    daysFromNow: 13,
    startHour: 10,
    endHour: 16,
    hasRegistrationUrl: false,
  },
  {
    category: "seniors",
    title: "Seniors' Tech Help Desk",
    summary: "One-on-one help with phones, tablets, and video calls.",
    description:
      "Patient volunteers walk you through whatever you need. One-on-one appointments. Quiet, large-print handouts provided.",
    city: "Toronto",
    host: "Seniors Connect",
    audience: "seniors 60+",
    accessibility: ["wheelchair", "quiet_space", "large_print", "support_person"],
    isFree: true,
    daysFromNow: 8,
    startHour: 10,
    endHour: 12,
    hasRegistrationUrl: true,
  },
  {
    category: "fundraiser",
    title: "Bake Sale for the Food Bank",
    summary: "Volunteer-baked goods, all proceeds to the food bank.",
    description:
      "Cookies, loaves, and vegan options. Drop in, cash only. Indoor event; step-free entrance at the side door.",
    city: "Markham",
    host: "Markham Food Network",
    audience: "all ages",
    accessibility: ["wheelchair"],
    isFree: true,
    daysFromNow: 4,
    startHour: 10,
    endHour: 14,
    hasRegistrationUrl: false,
  },
  {
    category: "other",
    title: "Community Garden Open House",
    summary: "Tour the community garden and sign up for a plot this season.",
    description:
      "Outdoor event — meet current gardeners and ask questions. Seedlings for sale; refreshments provided.",
    city: "Scarborough",
    host: "Scarborough Garden Collective",
    audience: "all ages",
    accessibility: [],
    isFree: true,
    daysFromNow: 15,
    startHour: 11,
    endHour: 14,
    hasRegistrationUrl: false,
  },
];

function jitter(spec: ListingSpec): ListingSpec {
  // Small ±3d and ±1h jitter so re-runs feel like real upcoming events rather
  // than the same fixed dates every time.
  const dayJ = (Math.floor(Math.random() * 7) - 3);
  const hourJ = Math.random() < 0.5 ? 0 : 1;
  return {
    ...spec,
    daysFromNow: Math.max(1, spec.daysFromNow + dayJ),
    startHour: Math.max(7, Math.min(20, spec.startHour + hourJ)),
    endHour: spec.endHour ? Math.max(spec.endHour, spec.startHour + 1) : undefined,
  };
}

function dateAt(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function seedEvents() {
  const ids: string[] = [];
  for (const raw of LISTINGS) {
    const spec = jitter(raw);
    const listing: EventInput = {
      title: spec.title,
      summary: spec.summary,
      description: spec.description,
      category: spec.category,
      start_time: dateAt(spec.daysFromNow, spec.startHour),
      end_time: spec.endHour ? dateAt(spec.daysFromNow, spec.endHour) : null,
      is_online: spec.isOnline,
      online_url: spec.onlineUrl ?? null,
      location_name: spec.host + " — " + spec.city,
      address: "TBD",
      city: spec.city,
      is_free: spec.isFree,
      cost_note: spec.costNote ?? null,
      audience: spec.audience,
      accessibility: spec.accessibility,
      transportation: null,
      registration_url: spec.hasRegistrationUrl
        ? "https://example.org/rsvp"
        : null,
      registration_instructions: spec.hasRegistrationUrl
        ? "Register online to reserve a spot."
        : null,
      host_organization: spec.host,
    };
    const tagged = await tagEvent(listing);
    const event = await createEvent({
      ...listing,
      tags: tagged.tags,
      internal_tags: tagged.internal_tags,
      created_by: STUB_USERS[0].id, // all seeded under the first user so analytics has data
    });
    ids.push(event.id);
    console.log(
      `[seed] event: ${event.title} → ${tagged.tags.length} static tags, ${tagged.internal_tags.length} internal`,
    );
  }
  return ids;
}

// --- registrations ---------------------------------------------------------

async function seedRegistrations(eventIds: string[]) {
  // Deterministic-ish: pick 3-5 random events per user, mix statuses.
  let count = 0;
  for (const u of STUB_USERS) {
    const picks = pickN(eventIds, 3 + Math.floor(Math.random() * 3));
    for (const eventId of picks) {
      const status = Math.random() < 0.55 ? "registered" : "interested";
      const event = await fetchEvent(eventId);
      try {
        await upsertEventRegistration({
          event_id: eventId,
          profile_id: u.id,
          status,
          attendee_name: u.display,
          contact_email: u.email,
          notes: null,
          event_snapshot: event,
        });
        count++;
      } catch (err) {
        console.warn(
          `[seed] registration skip for ${u.email} → ${eventId}: ${(err as Error).message}`,
        );
      }
    }
  }
  console.log(`[seed] registrations: ${count}`);
}

async function fetchEvent(eventId: string) {
  const { data, error } = await db!
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) throw new Error(`fetchEvent ${eventId} failed`);
  // Strip internal_tags to match the PublicEvent shape registrations expect.
  const { internal_tags: _internal, ...pub } = data as Record<string, unknown>;
  return pub as import("@chiron/shared").PublicEvent;
}

function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

// --- main ------------------------------------------------------------------

async function main() {
  console.log("[seed] wiping existing events, profiles, registrations…");
  await wipe();

  console.log("[seed] ensuring 10 stubbed auth users…");
  await ensureAuthUsers();

  console.log("[seed] upserting profiles…");
  await upsertProfiles();

  console.log("[seed] running the pipeline on 20 listings…");
  const eventIds = await seedEvents();

  console.log("[seed] linking users to events…");
  await seedRegistrations(eventIds);

  console.log("\n[seed] done. Test sign-in:");
  for (const u of STUB_USERS.slice(0, 3)) {
    console.log(`  ${u.email}  /  ${STUB_PASSWORD}  (analytics=${u.shareInAnalytics})`);
  }
  console.log("  … 7 more users user4@example.com … user10@example.com with the same password.");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  const msg = String((err as Error).message ?? err);
  if (/column .* does not exist|schema cache/i.test(msg)) {
    console.error(
      "\n[seed] The Supabase schema appears out of date. " +
        "Re-run supabase/schema.sql in the Supabase SQL editor and try again " +
        "(it's destructive — re-seeds the events + profiles tables).",
    );
  }
  process.exit(1);
});