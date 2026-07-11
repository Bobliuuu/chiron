import type { EventDraft, PublicEvent } from "@/lib/types/events";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * Structured side-effects the agent asks the UI to render inline in the chat.
 * The assistant's prose lives in AgentResult.message; these are the "cards".
 */
export type UiAction =
  | { type: "events"; title: string; events: PublicEvent[] }
  | { type: "event_draft"; draft: EventDraft };

export interface AgentResult {
  /** Natural-language reply shown as an assistant bubble. */
  message: string;
  /** Cards to render beneath the reply (event lists, prefilled create form). */
  actions: UiAction[];
  /** Which backends served this turn — surfaced as a subtle badge. */
  mode: { llm: "openai" | "local" | "mock"; db: "supabase" | "mock" };
}
