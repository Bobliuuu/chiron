import { getSupabaseAdmin } from "./client";
import {
  EMPTY_VOICE_ONTOLOGY,
  mergeLearnedFacts,
  type Profile,
  type ProfileInput,
  type AgentProfile,
  type LearnedFact,
  type LearnedFactInput,
  type VoiceCallRecord,
  type VoiceOntology,
} from "@chiron/shared";

// The profiles repository — same pattern as events.ts: Supabase when
// configured, an in-memory map otherwise.

const TABLE = "profiles";

const mockProfiles = new Map<string, Profile>();

// Demo community members for voice name-based auth.
const DEMO_PROFILES: ProfileInput[] = [
  {
    id: "usr_maria_chen",
    full_name: "Maria Chen",
    contact_phone: "+14165550101",
    ui_mode: "quick",
    accessibility_needs: ["wheelchair", "plain_language"],
    preferred_tags: ["food", "families", "free"],
    city: "Markham",
    free_only: true,
    quiz_answers: { short_info: true, wheelchair: true, free_only: true, family: true },
  },
  {
    id: "usr_james_okonkwo",
    full_name: "James Okonkwo",
    contact_phone: "+14165550102",
    ui_mode: "elaborate",
    accessibility_needs: ["quiet_space"],
    preferred_tags: ["seniors", "health", "social"],
    city: "Toronto",
    free_only: false,
    quiz_answers: { quiet: true, meet_people: true },
  },
];

for (const input of DEMO_PROFILES) {
  const now = new Date().toISOString();
  mockProfiles.set(input.id, {
    ...input,
    full_name: input.full_name ?? null,
    contact_phone: input.contact_phone ?? null,
    city: input.city ?? null,
    voice_ontology: input.voice_ontology ?? EMPTY_VOICE_ONTOLOGY,
    learned_facts: input.learned_facts ?? [],
    created_at: now,
    updated_at: now,
  });
}

export async function upsertProfile(input: ProfileInput): Promise<Profile> {
  const db = getSupabaseAdmin();
  if (!db) {
    const now = new Date().toISOString();
    const existing = mockProfiles.get(input.id);
    const profile: Profile = {
      ...input,
      full_name: input.full_name ?? null,
      contact_phone: input.contact_phone ?? null,
      city: input.city ?? null,
      voice_ontology: input.voice_ontology ?? existing?.voice_ontology ?? EMPTY_VOICE_ONTOLOGY,
      learned_facts: input.learned_facts ?? existing?.learned_facts ?? [],
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    mockProfiles.set(profile.id, profile);
    return profile;
  }

  const { data, error } = await db
    .from(TABLE)
    .upsert(
      {
        id: input.id,
        full_name: input.full_name ?? null,
        contact_phone: input.contact_phone ?? null,
        ui_mode: input.ui_mode,
        accessibility_needs: input.accessibility_needs,
        preferred_tags: input.preferred_tags,
        city: input.city ?? null,
        free_only: input.free_only,
        quiz_answers: input.quiz_answers,
        voice_ontology: input.voice_ontology ?? EMPTY_VOICE_ONTOLOGY,
        learned_facts: input.learned_facts ?? [],
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(`upsertProfile failed: ${error.message}`);
  return data as Profile;
}

export async function getProfile(id: string): Promise<Profile | null> {
  const db = getSupabaseAdmin();
  if (!db) return mockProfiles.get(id) ?? null;

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`getProfile failed: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/** Case-insensitive full-name lookup for simple voice auth (demo). */
export async function findProfileByFullName(
  fullName: string,
): Promise<Profile | null> {
  const normalized = fullName.trim().toLowerCase();
  if (!normalized) return null;

  const db = getSupabaseAdmin();
  if (!db) {
    for (const profile of mockProfiles.values()) {
      if ((profile.full_name ?? "").trim().toLowerCase() === normalized) {
        return profile;
      }
    }
    return null;
  }

  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .ilike("full_name", fullName.trim())
    .maybeSingle();

  if (error) throw new Error(`findProfileByFullName failed: ${error.message}`);
  return (data as Profile | null) ?? null;
}

/** Map a stored profile to the slice the agent consumes. */
export function toAgentProfile(profile: Profile): AgentProfile {
  return {
    full_name: profile.full_name,
    ui_mode: profile.ui_mode,
    accessibility_needs: profile.accessibility_needs,
    preferred_tags: profile.preferred_tags,
    city: profile.city,
    free_only: profile.free_only,
    voice_ontology: profile.voice_ontology,
    learned_facts: profile.learned_facts,
  };
}

/**
 * Append facts the text-chat agent learned to the user's ontology (dedup +
 * capped). Best-effort; returns the updated profile or null if it's missing.
 */
export async function appendLearnedFacts(
  profileId: string,
  facts: LearnedFactInput[],
): Promise<Profile | null> {
  const existing = await getProfile(profileId);
  if (!existing) return null;
  if (facts.length === 0) return existing;

  const now = new Date().toISOString();
  const incoming: LearnedFact[] = facts.map((f) => ({
    predicate: f.predicate,
    object: f.object,
    source: f.source ?? "conversation",
    confidence: typeof f.confidence === "number" ? f.confidence : 0.8,
    updated_at: now,
  }));
  const learned_facts = mergeLearnedFacts(existing.learned_facts, incoming);

  return upsertProfile({
    id: existing.id,
    full_name: existing.full_name,
    contact_phone: existing.contact_phone,
    ui_mode: existing.ui_mode,
    accessibility_needs: existing.accessibility_needs,
    preferred_tags: existing.preferred_tags,
    city: existing.city,
    free_only: existing.free_only,
    quiz_answers: existing.quiz_answers,
    voice_ontology: existing.voice_ontology,
    learned_facts,
  });
}

function mergeOntology(
  current: VoiceOntology,
  record: VoiceCallRecord,
): VoiceOntology {
  const calls = [...current.calls, record].slice(-20);
  const eventGoals = [
    ...new Set([
      ...current.event_goals,
      ...(record.event_goals ?? []),
    ]),
  ];
  const motivations = [
    ...new Set([
      ...current.motivations,
      ...(record.motivations ?? []),
    ]),
  ];
  return { calls, event_goals: eventGoals, motivations };
}

/** Append a voice call outcome to the user's ontology. */
export async function appendVoiceOntology(
  profileId: string,
  record: VoiceCallRecord,
): Promise<Profile | null> {
  const existing = await getProfile(profileId);
  if (!existing) return null;

  const voice_ontology = mergeOntology(existing.voice_ontology, record);
  return upsertProfile({
    id: existing.id,
    full_name: existing.full_name,
    contact_phone: existing.contact_phone,
    ui_mode: existing.ui_mode,
    accessibility_needs: existing.accessibility_needs,
    preferred_tags: existing.preferred_tags,
    city: existing.city,
    free_only: existing.free_only,
    quiz_answers: existing.quiz_answers,
    voice_ontology,
  });
}
