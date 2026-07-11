import "./load-env";
import { serve } from "@hono/node-server";
import { createApp } from "./http/app";
import { currentMode, env, hasLocalLlm, hasOpenAI, hasSupabase } from "./config";

// Boot the standalone Chiron backend on Node.
const app = createApp();
const mode = currentMode();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    `[chiron-backend] listening on http://0.0.0.0:${info.port} ` +
      `(llm: ${mode.llm}, db: ${mode.db}, origins: ${env.allowedOrigins.join(", ")})`,
  );
  console.log(
    `[chiron-backend] config: provider=${env.llmProviderSetting} ` +
      `openai=${hasOpenAI() ? "yes" : "no"} ` +
      `local=${hasLocalLlm() ? "yes" : "no"} ` +
      `supabase=${hasSupabase() ? "yes" : "no"}`,
  );
  console.log(`[chiron-backend] health: http://localhost:${info.port}/health`);
  if (env.verboseLogging) {
    console.log("[chiron-backend] verbose logging enabled (VERBOSE_LOGGING=true)");
  } else {
    console.log(
      "[chiron-backend] tip: set VERBOSE_LOGGING=true in apps/server/.env for request logs",
    );
  }
});
