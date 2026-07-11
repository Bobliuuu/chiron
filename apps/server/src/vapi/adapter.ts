import type { Context } from "hono";
import type { ChatMessage, ChatRole } from "@chiron/shared";
import { runAgent } from "../agent/orchestrator";
import { resolveVoiceAuth } from "./voice-auth";

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
 * request, runs the Chiron voice agent, and returns either a JSON completion
 * or an SSE stream (VAPI defaults to stream: true).
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

  let content: string;
  try {
    const auth = await resolveVoiceAuth(messages);
    const result = await runAgent({
      channel: "voice",
      messages,
      profile: auth.profile,
    });
    content = result.message;
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

  if (body.stream) {
    return streamCompletion(content, body.model);
  }
  return c.json(toOpenAiCompletion(content, body.model));
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
  const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
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

/**
 * OpenAI-compatible SSE stream. We run the agent to completion first, then
 * emit the reply as chunk(s) — VAPI requires stream format by default even
 * when the Custom LLM isn't token-streaming.
 */
function streamCompletion(content: string, model?: string): Response {
  const id = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  const modelName = model ?? "chiron-voice";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      };

      // Role + first content chunk
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content },
            finish_reason: null,
          },
        ],
      });

      // Terminal chunk
      send({
        id,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
