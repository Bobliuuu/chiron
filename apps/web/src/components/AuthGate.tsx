"use client";

import type { ReactNode } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { useAuth } from "@/lib/auth";

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading Chiron...
      </main>
    );
  }

  if (!session) return <AuthScreen />;

  return <>{children}</>;
}
