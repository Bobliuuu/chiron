import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chat } from "./agent-client";
import { env, whatsappConfigured } from "./config";
import { sessions } from "./session";
import { handleIncoming, handleVerification } from "./webhooks";

// Thin WhatsApp webhook client. Receives messages from Meta's Cloud API,
// forwards the conversation to the shared Chiron backend (/api/chat with
// channel: "whatsapp"), and sends the agent's prose reply back.

const GREETING =
  "Hi, I'm Chiron 👋 I can help you find community events or publish a new one. What would you like to do?";

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "chiron-whatsapp",
    whatsappConfigured: whatsappConfigured(),
    chironApiUrl: env.chironApiUrl,
  }),
);

app.get("/", (c) =>
  c.json({
    service: "chiron-whatsapp",
    ok: true,
    webhook: "/webhook",
    health: "/health",
    test: "POST /test (local dev — no Meta send)",
  }),
);

app.get("/webhook", handleVerification);
app.post("/webhook", handleIncoming);

/** Local dev helper: run session + agent without sending via Meta. */
app.post("/test", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const b = (body ?? {}) as { from?: unknown; text?: unknown };
  const from = typeof b.from === "string" && b.from.trim() ? b.from.trim() : "test-user";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return c.json({ error: "text is required." }, 400);

  if (sessions.isResetCommand(text)) {
    sessions.reset(from);
    return c.json({ from, reply: GREETING, reset: true });
  }

  const history = sessions.append(from, { role: "user", content: text });

  try {
    const result = await chat(history);
    const reply = result.message.trim() || "Sorry, I didn't have a reply for that.";
    sessions.append(from, { role: "assistant", content: reply });
    return c.json({ from, reply, mode: result.mode });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Something went wrong. Please try again.";
    return c.json({ error: message }, 502);
  }
});

serve({ fetch: app.fetch, port: env.port }, () => {
  console.log(`Chiron WhatsApp bot listening on http://localhost:${env.port}`);
  console.log(`  webhook:  GET/POST /webhook`);
  console.log(`  backend:  ${env.chironApiUrl}/api/chat (channel=whatsapp)`);
  if (!whatsappConfigured()) {
    console.warn(
      "  WhatsApp credentials not set — configure apps/whatsapp/.env to receive messages.",
    );
  }
});
