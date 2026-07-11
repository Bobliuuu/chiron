import { Hono, type Context } from "hono";
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
  type EventRegistrationFormSchema,
  type EventRegistrationInput,
  type JsonObject,
} from "@chiron/shared";
import { env, currentMode as mode } from "../config";
import { logVerbose } from "../log";
import { runAgent } from "../agent/orchestrator";
import { createEvent, getEvent, upcomingEvents } from "../data/events";
import {
  defaultRegistrationFormSchema,
  getEventRegistrationForm,
  sanitizeRegistrationFormSchema,
  upsertEventRegistrationForm,
} from "../data/event-registration-forms";
import { upsertEventRegistration } from "../data/event-registrations";
import {
  authenticate,
  createSession,
  createUser,
  deleteSession,
} from "../data/users";
import {
  appendVoiceOntology,
  findProfileByFullName,
  getProfile,
  toAgentProfile,
  upsertProfile,
} from "../data/profiles";
import { tagEvent } from "../pipeline/tag-event";
import { uploadEventImage } from "../data/storage";
import { mockEventCheckinRecord } from "../pipeline/voice-ontology";
import { requireAuth, type AuthVariables } from "./auth";
import { vapiAuth } from "../vapi/auth";
import { handleChatCompletions } from "../vapi/adapter";
import { handleVapiWebhook } from "../vapi/webhook";
import { callUserEventCheckin } from "../vapi/call-user-checkin";
import { sendEventsDigest } from "../email/send-events";

// The standalone Chiron backend. A single Hono app exposing the channel-aware
// agent + the events store over HTTP, consumed by every frontend (web app,
// voice agent, WhatsApp bot). Deployed on its own behind Cloudflare.

export function createApp(): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

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

  // --- Auth: self-hosted email + password (replaces Supabase Auth) ---------

  // POST /api/auth/signup { email, password } -> create account + session.
  app.post("/api/auth/signup", async (c) => {
    const creds = await readCredentials(c);
    if ("error" in creds) return c.json({ error: creds.error }, 400);

    try {
      const result = await createUser(creds.email, creds.password);
      if ("error" in result) return c.json({ error: result.error }, 409);
      const token = await createSession(result.user.id);
      return c.json({ token, user: result.user }, 201);
    } catch (err) {
      console.error("[/api/auth/signup] error:", err);
      return c.json({ error: "Failed to create account." }, 500);
    }
  });

  // POST /api/auth/login { email, password } -> session on valid credentials.
  app.post("/api/auth/login", async (c) => {
    const creds = await readCredentials(c);
    if ("error" in creds) return c.json({ error: creds.error }, 400);

    try {
      const result = await authenticate(creds.email, creds.password);
      if (!result) return c.json({ error: "Invalid email or password." }, 401);
      return c.json({ token: result.token, user: result.user });
    } catch (err) {
      console.error("[/api/auth/login] error:", err);
      return c.json({ error: "Failed to sign in." }, 500);
    }
  });

  // POST /api/auth/logout -> revoke the caller's session token.
  app.post("/api/auth/logout", requireAuth, async (c) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : "";
    try {
      if (token) await deleteSession(token);
      return c.json({ ok: true });
    } catch (err) {
      console.error("[/api/auth/logout] error:", err);
      return c.json({ error: "Failed to sign out." }, 500);
    }
  });

  // GET /api/auth/me -> the authenticated user (used to validate a stored token).
  app.get("/api/auth/me", requireAuth, (c) =>
    c.json({ user: c.get("authUser") }),
  );

  // VAPI Custom LLM — OpenAI-compatible ingress for phone calls.
  if (env.vapiEnabled) {
    app.post("/v1/chat/completions", vapiAuth, handleChatCompletions);
  }

  // VAPI server URL — end-of-call reports saved to user voice ontology.
  app.post("/api/vapi/webhook", handleVapiWebhook);

  // POST /api/demo/email-events — email a "cool events" digest to the demo
  // recipient via Resend.
  app.post("/api/demo/email-events", async (c) => {
    try {
      const events = await upcomingEvents(5);
      const result = await sendEventsDigest(env.demoEmailTo, events);
      if (!result.sent) {
        return c.json({ error: result.error ?? "Failed to send email." }, 502);
      }
      return c.json({
        sent: true,
        id: result.id,
        to: env.demoEmailTo,
        count: events.length,
      });
    } catch (err) {
      console.error("[/api/demo/email-events] error:", err);
      return c.json({ error: "Failed to send email." }, 500);
    }
  });

  // POST /api/demo/call-user — manually trigger outbound event check-in call.
  app.post("/api/demo/call-user", async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body is fine
    }
    const eventId =
      typeof (body as { event_id?: unknown })?.event_id === "string"
        ? (body as { event_id: string }).event_id
        : undefined;

    try {
      let demoProfile = await getProfile(env.demoCallProfileId);
      if (!demoProfile) {
        demoProfile = await findProfileByFullName("Maria Chen");
      }
      if (!demoProfile) {
        return c.json(
          { error: `Demo profile not found: ${env.demoCallProfileId}` },
          404,
        );
      }

      // Demo button always dials the configured demo number — never the
      // profile's contact_phone, so we don't accidentally call a seed/demo user.
      const phone = env.demoCallUserPhone;
      if (!phone) {
        return c.json(
          { error: "Demo user has no phone. Set DEMO_CALL_USER_PHONE." },
          400,
        );
      }

      const events = await upcomingEvents(10);
      const event = eventId
        ? await getEvent(eventId)
        : events.find((e) => e.category === "food_bank") ?? events[0];
      if (!event) {
        return c.json({ error: "No upcoming event found for demo call." }, 404);
      }

      const result = await callUserEventCheckin({
        userName: demoProfile.full_name ?? "Maria Chen",
        userPhone: phone,
        profileId: demoProfile.id,
        event: {
          title: event.title,
          start_time: event.start_time,
          city: event.city,
        },
      });

      if (!result.placed) {
        return c.json({ error: result.error ?? "Call failed." }, 500);
      }

      let updatedProfile = demoProfile;
      if (result.mock && result.callId) {
        const record = mockEventCheckinRecord(result.callId, event.title);
        const saved = await appendVoiceOntology(demoProfile.id, record);
        if (saved) updatedProfile = saved;
      }

      return c.json({
        placed: true,
        mock: result.mock ?? false,
        call_id: result.callId,
        user: demoProfile.full_name,
        phone,
        event: { id: event.id, title: event.title },
        voice_ontology: updatedProfile.voice_ontology,
        note: result.mock
          ? "Mock call — sample ontology saved immediately. With VAPI configured, ontology updates via webhook after the real call ends."
          : "Call placed. Ontology will update when VAPI sends end-of-call-report to /api/vapi/webhook.",
      });
    } catch (err) {
      console.error("[/api/demo/call-user] error:", err);
      return c.json({ error: "Failed to place demo call." }, 500);
    }
  });

  // POST /api/chat  { channel, messages }  ->  AgentResult
  app.post("/api/chat", requireAuth, async (c) => {
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
    const authUser = c.get("authUser");
    // Prefer the stored server-side profile — it carries the full ontology
    // (learned facts, voice goals, name) the thin client payload lacks. Fall
    // back to the client-sent profile when the user hasn't saved one yet.
    let profile = sanitizeProfile(b.profile);
    try {
      const stored = authUser?.id ? await getProfile(authUser.id) : null;
      if (stored) profile = toAgentProfile(stored);
    } catch (err) {
      console.error("[/api/chat] profile load failed:", err);
    }

    logVerbose(
      "chat",
      `channel=${channel} messages=${messages.length}`,
      `last="${truncate(messages.at(-1)?.content ?? "", 120)}"`,
    );

    try {
      const started = Date.now();
      const result = await runAgent({
        channel,
        messages,
        profile,
        userId: authUser?.id ?? null,
      });
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
  app.post("/api/events", requireAuth, async (c) => {
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

  // GET /api/events/:id/registration-form -> JSONB event-specific form schema.
  app.get("/api/events/:id/registration-form", async (c) => {
    const eventId = c.req.param("id");
    if (!eventId || !isUuid(eventId)) {
      return c.json({ error: "A valid event id is required." }, 400);
    }

    try {
      const event = await getEvent(eventId);
      if (!event) return c.json({ error: "Event not found." }, 404);

      const form = await getEventRegistrationForm(eventId);
      return c.json({
        form: form ?? {
          id: null,
          event_id: eventId,
          schema: defaultRegistrationFormSchema(),
          created_at: null,
          updated_at: null,
        },
        required_fields: ["attendee_name", "contact_email"],
        stripe_stub: {
          enabled: false,
          endpoint: `/api/event-registrations/{registration_id}/checkout`,
        },
      });
    } catch (err) {
      console.error("[/api/events/:id/registration-form GET] error:", err);
      return c.json({ error: "Failed to load registration form." }, 500);
    }
  });

  // POST /api/events/:id/registration-form -> upsert JSONB form schema.
  app.post("/api/events/:id/registration-form", requireAuth, async (c) => {
    const eventId = c.req.param("id");
    if (!eventId || !isUuid(eventId)) {
      return c.json({ error: "A valid event id is required." }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    try {
      const event = await getEvent(eventId);
      if (!event) return c.json({ error: "Event not found." }, 404);

      const b = (body ?? {}) as Record<string, unknown>;
      const form = await upsertEventRegistrationForm({
        event_id: eventId,
        schema: sanitizeRegistrationFormSchema(b.schema),
      });
      return c.json({ form }, 201);
    } catch (err) {
      console.error("[/api/events/:id/registration-form POST] error:", err);
      return c.json({ error: "Failed to save registration form." }, 500);
    }
  });

  // POST /api/event-registrations -> save a user's generated registration form.
  app.post("/api/event-registrations", requireAuth, async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    const parsed = validateEventRegistration(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }
    if (parsed.input.profile_id !== c.get("authUser").id) {
      return c.json({ error: "Cannot save another user's registration." }, 403);
    }

    try {
      const [event, profile, form] = await Promise.all([
        getEvent(parsed.input.event_id),
        getProfile(parsed.input.profile_id),
        getEventRegistrationForm(parsed.input.event_id),
      ]);
      if (!event) return c.json({ error: "Event not found." }, 404);
      if (!profile) return c.json({ error: "Profile not found." }, 404);

      const schema = form?.schema ?? defaultRegistrationFormSchema();
      const responseError = validateRegistrationResponses(parsed.input, schema);
      if (responseError) return c.json({ error: responseError }, 400);

      const registration = await upsertEventRegistration({
        ...parsed.input,
        registration_form_id: form?.id ?? null,
      });

      // Remember the attendee's identity on their profile so the next event's
      // registration form is prefilled without re-asking (the "reuse across
      // events" behavior). Only fill gaps; never overwrite existing values.
      const learnedName = parsed.input.attendee_name?.trim();
      const learnedPhone = parsed.input.contact_phone?.trim();
      const fillName = !profile.full_name && learnedName ? learnedName : null;
      const fillPhone = !profile.contact_phone && learnedPhone ? learnedPhone : null;
      if (fillName || fillPhone) {
        try {
          await upsertProfile({
            id: profile.id,
            full_name: fillName ?? profile.full_name,
            contact_phone: fillPhone ?? profile.contact_phone,
            ui_mode: profile.ui_mode,
            accessibility_needs: profile.accessibility_needs,
            preferred_tags: profile.preferred_tags,
            city: profile.city,
            free_only: profile.free_only,
            quiz_answers: profile.quiz_answers,
            voice_ontology: profile.voice_ontology,
          });
        } catch (err) {
          // Non-fatal: the registration already saved; memory enrichment is
          // best-effort.
          console.error("[/api/event-registrations] profile enrich failed:", err);
        }
      }

      return c.json({ registration }, 201);
    } catch (err) {
      console.error("[/api/event-registrations POST] error:", err);
      return c.json({ error: "Failed to save registration." }, 500);
    }
  });

  // Stub for a future Stripe Checkout integration.
  app.post("/api/event-registrations/:id/checkout", requireAuth, (c) => {
    const registrationId = c.req.param("id");
    if (!registrationId || !isUuid(registrationId)) {
      return c.json({ error: "A valid registration id is required." }, 400);
    }
    return c.json(
      {
        error: "Stripe checkout is not implemented yet.",
        registration_id: registrationId,
        stripe_stub: true,
      },
      501,
    );
  });

  // POST /api/upload -> store an event image in the public bucket.
  // multipart/form-data with a single "file" field; returns { url }.
  app.post("/api/upload", requireAuth, async (c) => {
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
  app.get("/api/profile", requireAuth, async (c) => {
    const id = c.req.query("id");
    if (!id || !isUuid(id)) {
      return c.json({ error: "A profile id is required." }, 400);
    }
    if (id !== c.get("authUser").id) {
      return c.json({ error: "Cannot load another user's profile." }, 403);
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
  app.post("/api/profile", requireAuth, async (c) => {
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
    if (id !== c.get("authUser").id) {
      return c.json({ error: "Cannot save another user's profile." }, 403);
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
    full_name:
      typeof p.full_name === "string" && p.full_name.trim()
        ? p.full_name.trim()
        : null,
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

/** Parse + validate an { email, password } auth body. */
async function readCredentials(
  c: Context,
): Promise<{ email: string; password: string } | { error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: "Invalid JSON body." };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "A valid email is required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  return { email, password };
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

function validateEventRegistration(
  body: unknown,
): { input: EventRegistrationInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const eventId = asString(b.event_id);
  const profileId = asString(b.profile_id);

  if (!eventId || !isUuid(eventId)) {
    return { error: "event_id must be a valid UUID." };
  }
  if (!profileId || !isUuid(profileId)) {
    return { error: "profile_id must be a valid UUID." };
  }

  const status = b.status === "registered" ? "registered" : "interested";

  return {
    input: {
      event_id: eventId,
      profile_id: profileId,
      registration_form_id: isUuid(asString(b.registration_form_id) ?? "")
        ? asString(b.registration_form_id)!
        : null,
      status,
      attendee_name: asString(b.attendee_name) ?? null,
      contact_email: asString(b.contact_email) ?? null,
      contact_phone: asString(b.contact_phone) ?? null,
      accessibility_requests: asString(b.accessibility_requests) ?? null,
      notes: asString(b.notes) ?? null,
      form_response: asJsonObject(b.form_response),
      event_snapshot:
        typeof b.event_snapshot === "object" && b.event_snapshot !== null
          ? (b.event_snapshot as EventRegistrationInput["event_snapshot"])
          : null,
    },
  };
}

function validateRegistrationResponses(
  input: EventRegistrationInput,
  schema: EventRegistrationFormSchema,
): string | null {
  if (input.status !== "registered") return null;
  if (!input.attendee_name) return "A name is required.";
  if (!input.contact_email) return "An email is required.";

  const responses = input.form_response ?? {};
  for (const field of schema.fields) {
    if (!field.required) continue;
    const value = responses[field.id];
    if (field.type === "checkbox") {
      if (value !== true) return `${field.label} is required.`;
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      return `${field.label} is required.`;
    }
  }

  return null;
}

function asJsonObject(v: unknown): JsonObject {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return v as JsonObject;
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
