import type { Context } from "hono";
import type { ChatMessage, ChatRole } from "@chiron/shared";
import { runAgent } from "../agent/orchestrator";

/** OpenAI chat completion request shape VAPI sends to Custom LLM endpoints. */
interface OpenAiChatRequest {
  model?: string;
  messages?: OpenAiMessage[];
  stream?: boolean;
}

interface OpenAiMessage {
  role?: string;
  content?: unknown;
}

/**
 * VAPI Custom LLM ingress. Accepts an OpenAI-compatible chat completion
 * request, runs the Chiron voice agent, and returns JSON or SSE (VAPI sends
 * stream: true by default).
 */
export async function handleChatCompletions(c: Context): Promise<Response> {
  let body: OpenAiChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const messages = toChironMessages(body.messages);
  if (messages.length === 0) {
    return c.json({ error: "No user or assistant messages provided." }, 400);
  }

  try {
    const result = await runAgent({ channel: "voice", messages });
    if (body.stream) {
      return sseCompletion(result.message, body.model);
    }
    return c.json(toOpenAiCompletion(result.message, body.model));
  } catch (err) {
    console.error("[/v1/chat/completions] agent error:", err);
    return c.json(
      {
        error: {
          message: "The assistant hit an error. Please try again.",
          type: "server_error",
        },
      },
      500,
    );
  }
}

/** Keep user/assistant turns; drop system/tool messages (Chiron owns the system prompt). */
export function toChironMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as OpenAiMessage)?.role;
    const content = (item as OpenAiMessage)?.content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim()
    ) {
      out.push({ role: role as ChatRole, content: content.trim() });
    }
  }
  return out.slice(-20);
}

function toOpenAiCompletion(content: string, model?: string) {
  const id = newCompletionId();
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model ?? "chiron-voice",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** OpenAI-compatible SSE stream. VAPI always sends stream:true. */
function sseCompletion(content: string, model?: string): Response {
  const id = newCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const modelName = model ?? "chiron-voice";

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const emit = (payload: Record<string, unknown>) => {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      emit({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      });

      for (const part of splitForStreaming(content)) {
        emit({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelName,
          choices: [
            { index: 0, delta: { content: part }, finish_reason: null },
          ],
        });
      }

      emit({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });

      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function newCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Chunk spoken replies by sentence (fallback: ~40 char groups) for TTS. */
export function splitForStreaming(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [""];

  const sentences = trimmed.match(/[^.!?]+[.!?]?\s*/g);
  if (sentences && sentences.length > 1) return sentences;

  const parts: string[] = [];
  let buf = "";
  for (const token of trimmed.split(/(\s+)/)) {
    buf += token;
    if (buf.length >= 40) {
      parts.push(buf);
      buf = "";
    }
  }
  if (buf) parts.push(buf);
  return parts.length > 0 ? parts : [trimmed];
}
