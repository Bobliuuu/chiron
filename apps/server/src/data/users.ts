import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./client";
import { hashPassword, newSessionToken, verifyPassword } from "../auth/password";

// The users + sessions repository for self-hosted password auth. Mirrors the
// events/profiles pattern: Supabase when configured, in-memory maps otherwise
// so the app still runs (and can be signed into) with zero configuration.

const USERS_TABLE = "app_users";
const SESSIONS_TABLE = "auth_sessions";

/** Session lifetime. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PublicUser {
  id: string;
  email: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
}

interface SessionRow {
  token: string;
  user_id: string;
  expires_at: string;
}

const mockUsers = new Map<string, UserRow>(); // keyed by lower-case email
const mockSessions = new Map<string, SessionRow>(); // keyed by token

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create a new user. Returns the public user on success, or an error message
 * when the email is already registered.
 */
export async function createUser(
  email: string,
  password: string,
): Promise<{ user: PublicUser } | { error: string }> {
  const normalized = normalizeEmail(email);
  const password_hash = await hashPassword(password);
  const db = getSupabaseAdmin();

  if (!db) {
    if (mockUsers.has(normalized)) {
      return { error: "That email is already registered." };
    }
    const row: UserRow = { id: randomUUID(), email: normalized, password_hash };
    mockUsers.set(normalized, row);
    return { user: { id: row.id, email: row.email } };
  }

  const { data, error } = await db
    .from(USERS_TABLE)
    .insert({ email: normalized, password_hash })
    .select("id, email")
    .single();

  if (error) {
    // 23505 = unique_violation (duplicate email).
    if (error.code === "23505") {
      return { error: "That email is already registered." };
    }
    throw new Error(`createUser failed: ${error.message}`);
  }
  return { user: { id: data.id as string, email: data.email as string } };
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  const normalized = normalizeEmail(email);
  const db = getSupabaseAdmin();

  if (!db) return mockUsers.get(normalized) ?? null;

  const { data, error } = await db
    .from(USERS_TABLE)
    .select("id, email, password_hash")
    .eq("email", normalized)
    .maybeSingle();

  if (error) throw new Error(`findUserByEmail failed: ${error.message}`);
  return (data as UserRow | null) ?? null;
}

/**
 * Verify credentials and, on success, mint a session. Returns null when the
 * email is unknown or the password does not match — callers should not reveal
 * which.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<{ user: PublicUser; token: string } | null> {
  const row = await findUserByEmail(email);
  if (!row) {
    // Hash anyway so timing does not reveal whether the email exists.
    await verifyPassword(password, "0:0");
    return null;
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;

  const token = await createSession(row.id);
  return { user: { id: row.id, email: row.email }, token };
}

export async function createSession(userId: string): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const db = getSupabaseAdmin();

  if (!db) {
    mockSessions.set(token, { token, user_id: userId, expires_at: expiresAt });
    return token;
  }

  const { error } = await db
    .from(SESSIONS_TABLE)
    .insert({ token, user_id: userId, expires_at: expiresAt });
  if (error) throw new Error(`createSession failed: ${error.message}`);
  return token;
}

/** Resolve a bearer token to its user, or null if missing/expired. */
export async function getUserByToken(token: string): Promise<PublicUser | null> {
  const db = getSupabaseAdmin();

  if (!db) {
    const session = mockSessions.get(token);
    if (!session) return null;
    if (Date.parse(session.expires_at) < Date.now()) {
      mockSessions.delete(token);
      return null;
    }
    const user = [...mockUsers.values()].find((u) => u.id === session.user_id);
    return user ? { id: user.id, email: user.email } : null;
  }

  const { data, error } = await db
    .from(SESSIONS_TABLE)
    .select("user_id, expires_at, app_users!inner(id, email)")
    .eq("token", token)
    .maybeSingle();

  if (error) throw new Error(`getUserByToken failed: ${error.message}`);
  if (!data) return null;
  if (Date.parse(data.expires_at as string) < Date.now()) {
    await deleteSession(token);
    return null;
  }

  // app_users is returned as a nested object (or array) depending on the join.
  const joined = (data as unknown as { app_users: UserRow | UserRow[] }).app_users;
  const user = Array.isArray(joined) ? joined[0] : joined;
  return user ? { id: user.id, email: user.email } : null;
}

export async function deleteSession(token: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) {
    mockSessions.delete(token);
    return;
  }
  const { error } = await db.from(SESSIONS_TABLE).delete().eq("token", token);
  if (error) throw new Error(`deleteSession failed: ${error.message}`);
}
