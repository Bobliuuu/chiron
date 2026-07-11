import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "@/lib/config";

// Lazily-created singletons so we never construct a client without config.
let browserClient: SupabaseClient | null = null;
let serverClient: SupabaseClient | null = null;

/** Public (anon) client — safe for the browser and read paths. */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!browserClient) {
    browserClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });
  }
  return browserClient;
}

/**
 * Server-side client. Uses the service-role key when available for privileged
 * writes, otherwise falls back to the anon key. Never import this into client
 * components.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!serverClient) {
    const key = env.supabaseServiceRoleKey || env.supabaseAnonKey;
    serverClient = createClient(env.supabaseUrl, key, {
      auth: { persistSession: false },
    });
  }
  return serverClient;
}
