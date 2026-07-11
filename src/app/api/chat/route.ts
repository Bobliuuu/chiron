import { runAgent } from "@/lib/agent/orchestrator";
import type { ChatMessage, ChatRole } from "@/lib/agent/types";
import { sanitizeStaticTags } from "@/lib/tags";
import type { AgentProfile } from "@/lib/types/profile";

export const runtime = "nodejs";

// POST /api/chat  { messages: {role, content}[], profile? }  ->  AgentResult
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = sanitize((body as { messages?: unknown })?.messages);
  if (messages.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const profile = sanitizeProfile((body as { profile?: unknown })?.profile);

  try {
    const result = await runAgent(messages, profile);
    return Response.json(result);
  } catch (err) {
    console.error("[/api/chat] agent error:", err);
    return Response.json(
      { error: "The assistant hit an error. Please try again." },
      { status: 500 },
    );
  }
}

function sanitize(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      out.push({ role: role as ChatRole, content });
    }
  }
  return out.slice(-20); // keep the last few turns
}

/** Trust nothing from the client: coerce the profile to known-safe values. */
function sanitizeProfile(raw: unknown): AgentProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  return {
    ui_mode: p.ui_mode === "quick" ? "quick" : "elaborate",
    accessibility_needs: sanitizeStaticTags(p.accessibility_needs),
    preferred_tags: sanitizeStaticTags(p.preferred_tags),
    city:
      typeof p.city === "string" && p.city.trim() ? p.city.trim() : null,
    free_only: p.free_only === true,
  };
}
