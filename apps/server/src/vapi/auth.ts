import type { Context, Next } from "hono";
import { env } from "../config";

/**
 * Validates `Authorization: Bearer <VAPI_LLM_API_KEY>` when a key is configured.
 * Skips auth when VAPI_LLM_API_KEY is unset (local dev).
 */
export async function vapiAuth(c: Context, next: Next): Promise<Response | void> {
  const expected = env.vapiLlmApiKey;
  if (!expected) {
    await next();
    return;
  }

  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token !== expected) {
    return c.json({ error: "Unauthorized." }, 401);
  }

  await next();
}
