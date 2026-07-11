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
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  authFetch: typeof fetch;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const authFetch = useCallback<typeof fetch>(
    async (input, init) => {
      if (!supabase) return fetch(input, init);

      const {
        data: { session: freshSession },
      } = await supabase.auth.getSession();
      const token = freshSession?.access_token;
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);

      return fetch(input, { ...init, headers });
    },
    [supabase],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return "Supabase is not configured.";
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return error?.message ?? null;
    },
    [supabase],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return "Supabase is not configured.";
      const { error } = await supabase.auth.signUp({ email, password });
      return error?.message ?? null;
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: Boolean(supabase),
      loading,
      session,
      user: session?.user ?? null,
      authFetch,
      signIn,
      signUp,
      signOut,
    }),
    [authFetch, loading, session, signIn, signOut, signUp, supabase],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
