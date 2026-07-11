import type { ChatMessage } from "@chiron/shared";
import { env } from "./config";

const RESET_PHRASES = new Set([
  "/reset",
  "reset",
  "start over",
  "new chat",
  "clear",
]);

/** In-memory per-user conversation history keyed by WhatsApp sender id. */
export class SessionStore {
  private sessions = new Map<string, ChatMessage[]>();

  get(userId: string): ChatMessage[] {
    return this.sessions.get(userId) ?? [];
  }

  append(userId: string, message: ChatMessage): ChatMessage[] {
    const history = [...this.get(userId), message].slice(-env.sessionMaxMessages);
    this.sessions.set(userId, history);
    return history;
  }

  reset(userId: string): void {
    this.sessions.delete(userId);
  }

  isResetCommand(text: string): boolean {
    return RESET_PHRASES.has(text.trim().toLowerCase());
  }
}

export const sessions = new SessionStore();
