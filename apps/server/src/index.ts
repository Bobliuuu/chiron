import "dotenv/config"; // loads apps/server/.env in local dev; a no-op in Docker
import { serve } from "@hono/node-server";
import { createApp } from "./http/app";
import { currentMode, env } from "./config";

// Boot the standalone Chiron backend on Node.
const app = createApp();
const mode = currentMode();

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(
    `[chiron-backend] listening on http://0.0.0.0:${info.port} ` +
      `(llm: ${mode.llm}, db: ${mode.db}, origins: ${env.allowedOrigins.join(", ")})`,
  );
});
