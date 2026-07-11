// Centralized environment access + feature detection.
// The app is designed to run with ZERO configuration (mock mode) and to
// progressively light up real services as env vars are provided.

export type LlmProvider = "openai" | "local" | "mock";

export const env = {
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
  // Model name/path as the local server expects it.
  localLlmModel: process.env.LOCAL_LLM_MODEL || "Qwen3.5-9B-Q4_K_M.gguf",
  // Most local servers ignore the key but require a non-empty string.
  localLlmApiKey: process.env.LOCAL_LLM_API_KEY || "sk-local",

  // --- Supabase ---
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
};

/** True when a real OpenAI key is configured. */
export const hasOpenAI = () => env.openaiApiKey.length > 0;

/** True when the local model fallback is turned on. */
export const hasLocalLlm = () =>
  env.localLlmEnabled && env.localLlmBaseUrl.length > 0;

/** True when Supabase is configured (otherwise: in-memory store). */
export const hasSupabase = () =>
  env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;

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
