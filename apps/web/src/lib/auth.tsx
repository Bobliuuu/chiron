"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiUrl } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextValue {
  loading: boolean;
  user: AuthUser | null;
  authFetch: typeof fetch;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const TOKEN_KEY = "chiron.auth.token";

const AuthContext = createContext<AuthContextValue | null>(null);

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function writeToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, validate any stored token against the backend.
  useEffect(() => {
    let mounted = true;
    const stored = readToken();
    if (!stored) {
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/auth/me"), {
          headers: { Authorization: `Bearer ${stored}` },
        });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          setToken(stored);
          setUser(data.user as AuthUser);
        } else {
          writeToken(null);
        }
      } catch {
        // Network error — keep the token; the user can retry.
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const authFetch = useCallback<typeof fetch>(
    async (input, init) => {
      const current = token ?? readToken();
      const headers = new Headers(init?.headers);
      if (current) headers.set("Authorization", `Bearer ${current}`);
      return fetch(input, { ...init, headers });
    },
    [token],
  );

  // Shared login/signup: POST credentials, store the returned session.
  const submit = useCallback(
    async (path: "/api/auth/login" | "/api/auth/signup", email: string, password: string) => {
      try {
        const res = await fetch(apiUrl(path), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return (data as { error?: string }).error ?? "Something went wrong.";
        }
        const nextToken = (data as { token: string }).token;
        writeToken(nextToken);
        setToken(nextToken);
        setUser((data as { user: AuthUser }).user);
        return null;
      } catch {
        return "Could not reach the server. Please try again.";
      }
    },
    [],
  );

  const signIn = useCallback(
    (email: string, password: string) => submit("/api/auth/login", email, password),
    [submit],
  );

  const signUp = useCallback(
    (email: string, password: string) => submit("/api/auth/signup", email, password),
    [submit],
  );

  const signOut = useCallback(async () => {
    const current = token ?? readToken();
    try {
      if (current) {
        await fetch(apiUrl("/api/auth/logout"), {
          method: "POST",
          headers: { Authorization: `Bearer ${current}` },
        });
      }
    } catch {
      // Best-effort; clear locally regardless.
    }
    writeToken(null);
    setToken(null);
    setUser(null);
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, user, authFetch, signIn, signUp, signOut }),
    [authFetch, loading, signIn, signOut, signUp, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
