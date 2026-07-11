import type { EventDraft, PublicEvent } from "./events";
import type { AgentProfile } from "./profile";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * The frontend a request came from. The backend is shared across all of these;
 * `web` is a rich UI (renders cards + a creation form), while voice/whatsapp/
 * email are conversational-only surfaces with no screen to render structured UI.
 */
export type Channel = "web" | "voice" | "whatsapp" | "email" | "api";

export const CHANNELS: readonly Channel[] = [
  "web",
  "voice",
  "whatsapp",
  "email",
  "api",
] as const;

/** What a given channel's frontend is able to render. Drives agent behavior. */
export interface ChannelCapabilities {
  /**
   * Can render structured UI (event cards + the prefilled creation form).
   * Only the web app can today; everything else is prose-only.
   */
  richUi: boolean;
}

export function capabilitiesFor(channel: Channel): ChannelCapabilities {
  return { richUi: channel === "web" };
}

/** Coerce arbitrary input to a known Channel, defaulting to "api". */
export function asChannel(v: unknown): Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v)
    ? (v as Channel)
    : "api";
}

/**
 * Structured side-effects the agent asks the UI to render inline in the chat.
 * The assistant's prose lives in AgentResult.message; these are the "cards".
 * Only emitted for rich channels — prose-only channels receive an empty list.
 */
export type UiAction =
  | { type: "events"; title: string; events: PublicEvent[] }
  | { type: "event_draft"; draft: EventDraft };

/** The request every frontend POSTs to the backend's /api/chat. */
export interface AgentRequest {
  /** Which frontend this came from. */
  channel: Channel;
  /** The running conversation. */
  messages: ChatMessage[];
  /** The user's onboarding profile, when known. Personalizes the agent. */
  profile?: AgentProfile | null;
}

export interface AgentResult {
  /** Natural-language reply shown as an assistant bubble. */
  message: string;
  /** Cards to render beneath the reply (event lists, prefilled create form). */
  actions: UiAction[];
  /** Which backends + channel served this turn — surfaced as a subtle badge. */
  mode: {
    llm: "openai" | "local" | "mock";
    db: "supabase" | "mock";
    channel: Channel;
  };
}
