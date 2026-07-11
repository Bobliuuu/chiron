import { getSupabaseAdmin } from "./client";
import type { Profile, ProfileInput } from "@chiron/shared";

// The profiles repository — same pattern as events.ts: Supabase when
// configured, an in-memory map otherwise.

const TABLE = "profiles";

const mockProfiles = new Map<string, Profile>();

export async function upsertProfile(input: ProfileInput): Promise<Profile> {
  const db = getSupabaseAdmin();
  if (!db) {
    const now = new Date().toISOString();
    const existing = mockProfiles.get(input.id);
    const profile: Profile = {
      ...input,
      city: input.city ?? null,
      share_in_analytics: input.share_in_analytics ?? true,
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
        ui_mode: input.ui_mode,
        accessibility_needs: input.accessibility_needs,
        preferred_tags: input.preferred_tags,
        city: input.city ?? null,
        free_only: input.free_only,
        quiz_answers: input.quiz_answers,
        share_in_analytics: input.share_in_analytics ?? true,
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
