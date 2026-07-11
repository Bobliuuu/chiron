import type { MiddlewareHandler } from "hono";
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

function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}
