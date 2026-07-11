import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { chat } from "./agent-client";
import { env, whatsappConfigured } from "./config";
import { sessions } from "./session";
import { markRead, sendText } from "./whatsapp";

const GREETING =
  "Hi, I'm Chiron 👋 I can help you find community events or publish a new one. What would you like to do?";

interface WhatsAppWebhookBody {
  object?: string;
  entry?: WhatsAppEntry[];
}

interface WhatsAppEntry {
  changes?: WhatsAppChange[];
}

interface WhatsAppChange {
  value?: WhatsAppValue;
}

interface WhatsAppValue {
  messages?: WhatsAppInboundMessage[];
  statuses?: unknown[];
}

interface WhatsAppInboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
}

/** Meta webhook verification handshake (GET /webhook). */
export function handleVerification(c: Context): Response {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && token === env.verifyToken && challenge) {
    return c.text(challenge);
  }

  return c.text("Forbidden", 403);
}

/** Verify X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set. */
export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!env.appSecret) return true;

  if (!signature?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", env.appSecret)
    .update(rawBody)
    .digest("hex");

  const received = signature.slice("sha256=".length);
  if (expected.length !== received.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/** Process inbound WhatsApp messages (POST /webhook). */
export async function handleIncoming(c: Context): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    return c.text("Unauthorized", 401);
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch {
    return c.text("Bad Request", 400);
  }

  if (body.object !== "whatsapp_business_account") {
    return c.text("OK");
  }

  const messages = extractMessages(body);
  for (const message of messages) {
    void processMessage(message).catch((err) => {
      console.error("[webhook] processMessage error:", err);
    });
  }

  // Meta expects a fast 200 even while we reply asynchronously.
  return c.text("OK");
}

function extractMessages(body: WhatsAppWebhookBody): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        out.push(message);
      }
    }
  }
  return out;
}

async function processMessage(message: WhatsAppInboundMessage): Promise<void> {
  if (!whatsappConfigured()) {
    console.warn("[webhook] WhatsApp credentials missing — ignoring message.");
    return;
  }

  const from = message.from;
  void markRead(message.id);

  if (message.type !== "text" || !message.text?.body?.trim()) {
    await sendText(
      from,
      "I can only read text messages right now. Send me a message like “find food bank events in Markham”.",
    );
    return;
  }

  const text = message.text.body.trim();

  if (sessions.isResetCommand(text)) {
    sessions.reset(from);
    await sendText(from, GREETING);
    return;
  }

  const history = sessions.append(from, { role: "user", content: text });

  let reply: string;
  try {
    const result = await chat(history);
    reply = result.message.trim() || "Sorry, I didn't have a reply for that.";
    sessions.append(from, { role: "assistant", content: reply });
  } catch (err) {
    console.error("[webhook] agent error:", err);
    reply =
      err instanceof Error
        ? err.message
        : "Something went wrong. Please try again.";
  }

  await sendText(from, reply);
}
