import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  asChannel,
  EVENT_CATEGORIES,
  type ChatMessage,
  type ChatRole,
  type EventCategory,
  type EventInput,
} from "@chiron/shared";
import { env, currentMode as mode } from "../config";
import { logVerbose } from "../log";
import { runAgent } from "../agent/orchestrator";
import { createEvent, upcomingEvents } from "../data/events";
import { vapiAuth } from "../vapi/auth";
import { handleChatCompletions } from "../vapi/adapter";

// The standalone Chiron backend. A single Hono app exposing the channel-aware
// agent + the events store over HTTP, consumed by every frontend (web app,
// voice agent, WhatsApp bot). Deployed on its own behind Cloudflare.

export function createApp(): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const started = Date.now();
    const { method } = c.req;
    const path = c.req.path;
    logVerbose(
      "http",
      `--> ${method} ${path}`,
      `origin=${c.req.header("origin") ?? "-"}`,
      `ip=${c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "-"}`,
    );
    await next();
    logVerbose("http", `<-- ${method} ${path} ${c.res.status} ${Date.now() - started}ms`);
  });

  // CORS: browsers (the web app) call this cross-origin when not using the
  // Next.js dev proxy. Server-to-server callers (voice/whatsapp) are unaffected.
  const allowAny = env.allowedOrigins.includes("*");
  app.use(
    "*",
    cors({
      origin: allowAny ? "*" : env.allowedOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  // Liveness/readiness probe for Cloudflare + uptime checks.
  app.get("/health", (c) => c.json({ ok: true, mode: mode() }));
  app.get("/", (c) => c.json({ service: "chiron-backend", ok: true }));

  // VAPI Custom LLM — OpenAI-compatible ingress for phone calls.
  // VAPI appends /chat/completions to the assistant "url". Use .../v1 as the
  // base (→ /v1/chat/completions). Also accept /chat/completions when the
  // base URL is set to the server root without /v1.
  if (env.vapiEnabled) {
    app.post("/v1/chat/completions", vapiAuth, handleChatCompletions);
    app.post("/chat/completions", vapiAuth, handleChatCompletions);
  }

  // POST /api/chat  { channel, messages }  ->  AgentResult
  app.post("/api/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const b = (body ?? {}) as { channel?: unknown; messages?: unknown };
    const channel = asChannel(b.channel);
    const messages = sanitizeMessages(b.messages);
    if (messages.length === 0) {
      return c.json({ error: "No messages provided." }, 400);
    }

    logVerbose(
      "chat",
      `channel=${channel} messages=${messages.length}`,
      `last="${truncate(messages.at(-1)?.content ?? "", 120)}"`,
    );

    try {
      const started = Date.now();
      const result = await runAgent({ channel, messages });
      logVerbose(
        "chat",
        `done in ${Date.now() - started}ms`,
        `llm=${result.mode.llm} actions=${result.actions.length}`,
      );
      return c.json(result);
    } catch (err) {
      console.error("[/api/chat] agent error:", err);
      return c.json(
        { error: "The assistant hit an error. Please try again." },
        500,
      );
    }
  });

  // GET /api/events -> upcoming events (for the web results/calendar panel)
  app.get("/api/events", async (c) => {
    try {
      const events = await upcomingEvents(50);
      return c.json({ events });
    } catch (err) {
      console.error("[/api/events GET] error:", err);
      return c.json({ error: "Failed to load events." }, 500);
    }
  });

  // POST /api/events -> create an event (nonprofit form submit)
  app.post("/api/events", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const parsed = validateEvent(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    try {
      const event = await createEvent(parsed.input);
      return c.json({ event }, 201);
    } catch (err) {
      console.error("[/api/events POST] error:", err);
      return c.json({ error: "Failed to create event." }, 500);
    }
  });

  return app;
}

// --- request validation (ported from the old Next.js API routes) -----------

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown })?.role;
    const content = (item as { content?: unknown })?.content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string"
    ) {
      out.push({ role: role as ChatRole, content });
    }
  }
  return out.slice(-20); // keep the last few turns
}

function validateEvent(
  body: unknown,
): { input: EventInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const title = asString(b.title);
  const summary = asString(b.summary);
  const startTime = asString(b.start_time);

  if (!title) return { error: "A title is required." };
  if (!summary) return { error: "A short summary is required." };
  if (!startTime) return { error: "A start date/time is required." };
  if (Number.isNaN(Date.parse(startTime)))
    return { error: "start_time must be a valid date-time." };

  const input: EventInput = {
    title,
    summary,
    start_time: new Date(startTime).toISOString(),
    description: asString(b.description) ?? null,
    category: asCategory(b.category),
    end_time: asString(b.end_time)
      ? new Date(asString(b.end_time)!).toISOString()
      : null,
    is_online: asBool(b.is_online) ?? false,
    online_url: asString(b.online_url) ?? null,
    location_name: asString(b.location_name) ?? null,
    address: asString(b.address) ?? null,
    city: asString(b.city) ?? null,
    is_free: asBool(b.is_free) ?? true,
    cost_note: asString(b.cost_note) ?? null,
    audience: asString(b.audience) ?? null,
    accessibility: Array.isArray(b.accessibility)
      ? b.accessibility.map(String)
      : [],
    transportation: asString(b.transportation) ?? null,
    registration_url: asString(b.registration_url) ?? null,
    registration_instructions: asString(b.registration_instructions) ?? null,
    host_organization: asString(b.host_organization) ?? null,
  };

  return { input };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
function asCategory(v: unknown): EventCategory {
  return typeof v === "string" &&
    (EVENT_CATEGORIES as readonly string[]).includes(v)
    ? (v as EventCategory)
    : "other";
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
