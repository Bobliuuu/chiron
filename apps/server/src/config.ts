// Centralized environment access + feature detection.
// The app is designed to run with ZERO configuration (mock mode) and to
// progressively light up real services as env vars are provided.

export type LlmProvider = "openai" | "local" | "mock";

export const env = {
  // --- HTTP server ---
  // Port the standalone backend listens on (Cloudflare origin fronts this).
  port: Number(process.env.PORT || 8787),
  // Log every request + agent/LLM steps to stdout (great for local debugging).
  verboseLogging:
    (process.env.VERBOSE_LOGGING || "").toLowerCase() === "true",
  // Comma-separated list of browser origins allowed to call this API via CORS.
  // e.g. "https://chiron.example,http://localhost:3000". "*" allows any origin.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Which LLM to use: "openai" | "local" | "mock" | "auto" (default).
  // "auto" resolves to openai (if keyed) -> local (if enabled) -> mock.
  llmProviderSetting: (process.env.LLM_PROVIDER || "auto").toLowerCase(),

  // --- OpenAI ---
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",

  // --- Local model (OpenAI-compatible server: llama.cpp, Ollama, LM Studio) ---
  // Enable the local fallback explicitly so pure zero-config stays in mock mode.
  localLlmEnabled: (process.env.LOCAL_LLM_ENABLED || "").toLowerCase() === "true",
  // OpenAI-compatible base URL. llama-server default is http://localhost:8080/v1.
  localLlmBaseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:8080/v1",
  // Model name/path as the local server expects it. Defaults to the GGUF this
  // repo's scripts/setup-llama.sh installs (Qwen3-8B, Q4_K_M quant).
  localLlmModel: process.env.LOCAL_LLM_MODEL || "Qwen3-8B-Q4_K_M.gguf",
  // Most local servers ignore the key but require a non-empty string.
  localLlmApiKey: process.env.LOCAL_LLM_API_KEY || "sk-local",

  // --- Supabase ---
  // Server-side, prefer the unprefixed names; accept the NEXT_PUBLIC_* names too
  // so a shared .env with the web app keeps working.
  supabaseUrl:
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey:
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  // --- Trusted channel services (WhatsApp bot, voice adapter, tests) ---
  // Shared secret for server-to-server /api/chat calls from channel bots that
  // have no signed-in Supabase user (a caller on the phone can't log in).
  // When unset, channel requests are allowed without a key (local dev stub).
  channelApiKey: process.env.CHANNEL_API_KEY ?? "",

  // --- VAPI (voice telephony via Custom LLM) ---
  // Bearer token VAPI sends on POST /v1/chat/completions. When unset, the
  // endpoint is open (fine for local dev behind ngrok).
  vapiLlmApiKey: process.env.VAPI_LLM_API_KEY ?? "",
  // Set to "false" to disable the /v1/chat/completions route entirely.
  vapiEnabled: (process.env.VAPI_ENABLED ?? "true").toLowerCase() !== "false",

  // --- VAPI outbound calls (organizer outreach) ---
  // API key from https://dashboard.vapi.ai — used to place outbound calls.
  vapiApiKey: process.env.VAPI_API_KEY ?? "",
  // VAPI phone number ID to dial from (Phone Numbers tab in dashboard).
  vapiPhoneNumberId: process.env.VAPI_PHONE_NUMBER_ID ?? "",
  // Optional saved assistant for outbound calls. When unset, a transient
  // OpenAI assistant is created per call.
  vapiOutboundAssistantId: process.env.VAPI_OUTBOUND_ASSISTANT_ID ?? "",
  // ElevenLabs voice id for transient outbound assistants.
  vapiVoiceId: process.env.VAPI_VOICE_ID ?? "",
  // Public HTTPS base URL for VAPI webhooks (ngrok or production API host).
  vapiWebhookBaseUrl: (process.env.VAPI_WEBHOOK_BASE_URL ?? "").replace(/\/$/, ""),

  // --- Email (Resend) ---
  // Demo key + recipient are hardcoded as fallbacks so the "Email events"
  // button works out of the box; override via env in real deployments.
  resendApiKey:
    process.env.RESEND_API_KEY || "re_9fdFJ4Qa_8uc3q4s2iPakhXmm69ewrd5X",
  // Resend's sandbox sender works without a verified domain.
  emailFrom: process.env.EMAIL_FROM || "Chiron <onboarding@resend.dev>",
  // Who the demo "cool events" digest goes to.
  demoEmailTo: process.env.DEMO_EMAIL_TO || "mmmzzz66g@gmail.com",

  // --- Demo: manual outbound user check-in ---
  // Hardcoded profile to call when triggering the demo button.
  // Seed UUID for Maria Chen (see supabase/seed.sql); mock id usr_maria_chen
  // only works when the DB is in-memory.
  demoCallProfileId:
    process.env.DEMO_CALL_PROFILE_ID ?? "11111111-1111-1111-1111-111111111101",
  // Demo always dials this number (E.164). Override via DEMO_CALL_USER_PHONE.
  demoCallUserPhone: process.env.DEMO_CALL_USER_PHONE || "+16479681128",
};

/** True when a real OpenAI key is configured. */
export const hasOpenAI = () => env.openaiApiKey.length > 0;

/** True when the local model fallback is turned on. */
export const hasLocalLlm = () =>
  env.localLlmEnabled && env.localLlmBaseUrl.length > 0;

/** True when Supabase is configured (otherwise: in-memory store). */
export const hasSupabase = () =>
  env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;

/** True when VAPI outbound calling is fully configured. */
export const hasVapiOutbound = () =>
  env.vapiApiKey.length > 0 && env.vapiPhoneNumberId.length > 0;

/**
 * Resolve the effective LLM provider from the configured setting and available
 * credentials. Falls back safely so the app always has a working path.
 */
export function resolveLlmProvider(): LlmProvider {
  switch (env.llmProviderSetting) {
    case "openai":
      return hasOpenAI() ? "openai" : "mock";
    case "local":
      return hasLocalLlm() ? "local" : "mock";
    case "mock":
      return "mock";
    case "auto":
    default:
      if (hasOpenAI()) return "openai";
      if (hasLocalLlm()) return "local";
      return "mock";
  }
}

export const dbMode = (): "supabase" | "mock" =>
  hasSupabase() ? "supabase" : "mock";

export interface ModeInfo {
  llm: LlmProvider;
  db: "supabase" | "mock";
}

export const currentMode = (): ModeInfo => ({
  llm: resolveLlmProvider(),
  db: dbMode(),
});
