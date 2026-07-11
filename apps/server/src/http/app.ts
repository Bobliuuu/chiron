import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  asChannel,
  deriveProfile,
  EVENT_CATEGORIES,
  QUIZ_QUESTIONS,
  sanitizeStaticTags,
  toPublicEvent,
  type AgentProfile,
  type ChatMessage,
  type ChatRole,
  type EventCategory,
  type EventInput,
} from "@chiron/shared";
import { env, currentMode as mode } from "../config";
import { logVerbose } from "../log";
import { runAgent } from "../agent/orchestrator";
import { createEvent, upcomingEvents } from "../data/events";
import { getProfile, upsertProfile } from "../data/profiles";
import { tagEvent } from "../pipeline/tag-event";
import { uploadEventImage } from "../data/storage";
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
  if (env.vapiEnabled) {
    app.post("/v1/chat/completions", vapiAuth, handleChatCompletions);
  }

  // POST /api/chat  { channel, messages }  ->  AgentResult
  app.post("/api/chat", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const b = (body ?? {}) as {
      channel?: unknown;
      messages?: unknown;
      profile?: unknown;
    };
    const channel = asChannel(b.channel);
    const messages = sanitizeMessages(b.messages);
    if (messages.length === 0) {
      return c.json({ error: "No messages provided." }, 400);
    }
    const profile = sanitizeProfile(b.profile);

    logVerbose(
      "chat",
      `channel=${channel} messages=${messages.length}`,
      `last="${truncate(messages.at(-1)?.content ?? "", 120)}"`,
    );

    try {
      const started = Date.now();
      const result = await runAgent({ channel, messages, profile });
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
      return c.json({ events: events.map(toPublicEvent) });
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
      // Tagging pipeline: derive static tags (per the rubric) and internal
      // ranking tags before the row is written, so the event is immediately
      // discoverable by tag.
      const { tags, internal_tags } = await tagEvent(parsed.input);
      const event = await createEvent({ ...parsed.input, tags, internal_tags });
      return c.json({ event: toPublicEvent(event) }, 201);
    } catch (err) {
      console.error("[/api/events POST] error:", err);
      return c.json({ error: "Failed to create event." }, 500);
    }
  });

  // POST /api/upload -> store an event image in the public bucket.
  // multipart/form-data with a single "file" field; returns { url }.
  app.post("/api/upload", async (c) => {
    let file: File | null = null;
    try {
      const form = await c.req.formData();
      const f = form.get("file");
      file = f instanceof File ? f : null;
    } catch {
      return c.json({ error: "Expected multipart/form-data with a file." }, 400);
    }
    if (!file) return c.json({ error: "No file provided." }, 400);
    if (!file.type.startsWith("image/")) {
      return c.json({ error: "Only image files are accepted." }, 400);
    }
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ error: "Image must be under 5 MB." }, 400);
    }

    try {
      const url = await uploadEventImage(file);
      if (!url) {
        return c.json(
          { error: "Image storage is not configured on this server." },
          503,
        );
      }
      return c.json({ url }, 201);
    } catch (err) {
      console.error("[/api/upload] error:", err);
      return c.json({ error: "Failed to store the image." }, 500);
    }
  });

  // GET /api/profile?id=... -> the stored onboarding profile (or 404)
  app.get("/api/profile", async (c) => {
    const id = c.req.query("id");
    if (!id || !isUuid(id)) {
      return c.json({ error: "A profile id is required." }, 400);
    }
    try {
      const profile = await getProfile(id);
      if (!profile) return c.json({ error: "Profile not found." }, 404);
      return c.json({ profile });
    } catch (err) {
      console.error("[/api/profile GET] error:", err);
      return c.json({ error: "Failed to load profile." }, 500);
    }
  });

  // POST /api/profile  { id, answers: {question_id: boolean}, city? }
  // Derives preferences + ui_mode from the quiz answers and upserts the profile.
  app.post("/api/profile", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!isUuid(id)) {
      return c.json(
        { error: "id must be a UUID (client-generated for now)." },
        400,
      );
    }

    const answers = sanitizeAnswers(b.answers);
    const city =
      typeof b.city === "string" && b.city.trim() ? b.city.trim() : null;

    try {
      const profile = await upsertProfile(deriveProfile(id, answers, city));
      return c.json({ profile }, 201);
    } catch (err) {
      console.error("[/api/profile POST] error:", err);
      return c.json({ error: "Failed to save profile." }, 500);
    }
  });

  return app;
}

/** Trust nothing from the client: coerce the profile to known-safe values. */
function sanitizeProfile(raw: unknown): AgentProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  return {
    ui_mode: p.ui_mode === "quick" ? "quick" : "elaborate",
    accessibility_needs: sanitizeStaticTags(p.accessibility_needs),
    preferred_tags: sanitizeStaticTags(p.preferred_tags),
    city: typeof p.city === "string" && p.city.trim() ? p.city.trim() : null,
    free_only: p.free_only === true,
  };
}

/** Keep only known question ids with boolean answers. */
function sanitizeAnswers(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (typeof raw !== "object" || raw === null) return out;
  const known = new Set(QUIZ_QUESTIONS.map((q) => q.id));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
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
    image_url: asImageUrl(b.image_url),
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
/** Accept only http(s) URLs for the card image. */
function asImageUrl(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
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
