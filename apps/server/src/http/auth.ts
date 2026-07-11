import type { MiddlewareHandler } from "hono";
import { getSupabaseAdmin } from "../data/client";

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthVariables = {
  authUser: AuthUser;
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> =
  async (c, next) => {
    const token = parseBearerToken(c.req.header("authorization"));
    if (!token) {
      return c.json({ error: "Authentication required." }, 401);
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return c.json({ error: "Supabase auth is not configured." }, 503);
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return c.json({ error: "Invalid or expired session." }, 401);
    }

    c.set("authUser", {
      id: data.user.id,
      email: data.user.email ?? null,
    });
    await next();
  };

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
