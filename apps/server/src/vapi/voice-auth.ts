import type { AgentProfile, ChatMessage } from "@chiron/shared";
import { findProfileByFullName, toAgentProfile } from "../data/profiles";

export interface VoiceAuthState {
  profile: AgentProfile | null;
  fullName: string | null;
  isAuthenticated: boolean;
}

const NAME_PATTERNS = [
  /\b(?:my name is|i am|i'm|this is|call me)\s+([a-z][a-z' -]{1,60})/i,
  /\b(?:name(?:'s)? is)\s+([a-z][a-z' -]{1,60})/i,
];

/**
 * Demo voice auth: if the caller's full name matches a profile row, treat them
 * as signed in for the rest of the call. No password — name only.
 */
export async function resolveVoiceAuth(
  messages: ChatMessage[],
): Promise<VoiceAuthState> {
  const name = extractCallerName(messages);
  if (!name) {
    return { profile: null, fullName: null, isAuthenticated: false };
  }

  const profile = await findProfileByFullName(name);
  if (!profile) {
    return { profile: null, fullName: name, isAuthenticated: false };
  }

  return {
    profile: toAgentProfile(profile),
    fullName: profile.full_name,
    isAuthenticated: true,
  };
}

function extractCallerName(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;

    for (const pattern of NAME_PATTERNS) {
      const match = msg.content.match(pattern);
      if (match?.[1]) return normalizeName(match[1]);
    }

    // Short reply right after the assistant asked for a name.
    const prev = messages[i - 1];
    if (
      prev?.role === "assistant" &&
      /\b(your name|what(?:'s| is) your name|may i have your name|who am i speaking with)\b/i.test(
        prev.content,
      )
    ) {
      const candidate = normalizeName(msg.content);
      if (looksLikeName(candidate)) return candidate;
    }
  }

  return null;
}

function normalizeName(raw: string): string {
  return raw
    .replace(/[.,!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeName(value: string): boolean {
  if (!value || value.length > 80) return false;
  const words = value.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  return words.every((w) => /^[A-Za-z][A-Za-z'-]*$/.test(w));
}
