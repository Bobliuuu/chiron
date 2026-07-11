import type { MiddlewareHandler } from "hono";
import { env } from "../config";
import { getUserByToken } from "../data/users";

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthVariables = {
  authUser: AuthUser;
};

/**
 * Authenticate a request from its `Authorization: Bearer <token>` header,
 * where the token is a session issued by /api/auth/login or /api/auth/signup.
 */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> =
  async (c, next) => {
    const token = parseBearerToken(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "Authentication required." }, 401);
    }

    const user = await getUserByToken(token);
    if (!user) {
      return c.json({ error: "Invalid or expired session." }, 401);
    }

    c.set("authUser", { id: user.id, email: user.email });
    await next();
  };

/**
 * Synthetic identity for trusted channel services (WhatsApp bot, voice
 * adapter). Callers on those channels have no user account — the service itself
 * authenticates with CHANNEL_API_KEY instead.
 */
export const CHANNEL_SERVICE_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000000",
  email: null,
};

/**
 * Like requireAuth, but also accepts trusted channel services via the
 * `x-channel-key` header — a phone caller or WhatsApp user can't sign in, so
 * the bot/adapter authenticates as a service instead.
 *
 * STUB: when CHANNEL_API_KEY is unset, any request with an `x-channel-key`
 * header is accepted (mirrors vapiAuth's local-dev behavior). Set the key in
 * production.
 */
export const requireUserOrChannelKey: MiddlewareHandler<{
  Variables: AuthVariables;
}> = async (c, next) => {
  const channelKey = c.req.header("x-channel-key");
  if (channelKey !== undefined) {
    if (env.channelApiKey && channelKey !== env.channelApiKey) {
      return c.json({ error: "Invalid channel key." }, 401);
    }
    c.set("authUser", CHANNEL_SERVICE_USER);
    await next();
    return;
  }
  return requireAuth(c, next);
};

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
