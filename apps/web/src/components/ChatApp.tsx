"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult, Profile, PublicEvent } from "@chiron/shared";
import { ChatMessageView, type UiMessage } from "@/components/ChatMessage";
import { Composer } from "@/components/Composer";
import { EventsPanel } from "@/components/EventsPanel";
import { OnboardingQuiz } from "@/components/OnboardingQuiz";
import { ProfilePanel } from "@/components/ProfilePanel";
import { apiUrl, API_URL, CHANNEL, logApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const SUGGESTIONS = [
  "Find all events in Markham for food banks",
  "Recommend me some events",
  "Create an event for a charity fundraiser on June 20th at Cherry St",
];

const QUICK_SUGGESTIONS = [
  "Find me something to do",
  "Show free events",
];

const GREETING: UiMessage = {
  id: "greeting",
  role: "assistant",
  content:
    "Hi, I'm Chiron 👋 I can help you find community events or publish a new one. What would you like to do?",
};

const QUICK_GREETING: UiMessage = {
  id: "greeting",
  role: "assistant",
  content: "Hi, I'm Chiron 👋 I help you find things to do. What do you like?",
};

export function ChatApp() {
  const { authFetch, signOut, user } = useAuth();
  const { theme, mounted, toggleTheme } = useTheme();
  const [messages, setMessages] = useState<UiMessage[]>([GREETING]);
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [mode, setMode] = useState<AgentResult["mode"] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // null = still reading localStorage (avoids flashing the quiz on reload).
  const [needsQuiz, setNeedsQuiz] = useState<boolean | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const uiMode = profile?.ui_mode ?? "elaborate";

  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logApi("API_URL =", API_URL);
    void probeBackend();
    void refreshEvents();

    async function loadProfile() {
      if (!user?.id) return;
      try {
        const res = await authFetch(apiUrl(`/api/profile?id=${user.id}`));
        if (res.status === 404) {
          setProfile(null);
          setNeedsQuiz(true);
          return;
        }
        const data = await res.json();
        if (res.ok && data.profile) {
          const loadedProfile = data.profile as Profile;
          setProfile(loadedProfile);
          if (loadedProfile.ui_mode === "quick") setMessages([QUICK_GREETING]);
          setNeedsQuiz(false);
          return;
        }
        setNeedsQuiz(true);
      } catch {
        setNeedsQuiz(true);
      }
    }

    void loadProfile();
  }, [authFetch, user?.id]);

  function handleQuizDone(newProfile: Profile | null) {
    setNeedsQuiz(false);
    if (!newProfile) return; // skipped — stay in elaborate mode, ask again next visit
    setProfile(newProfile);
    if (newProfile.ui_mode === "quick") setMessages([QUICK_GREETING]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function probeBackend() {
    const url = apiUrl("/health");
    const started = Date.now();
    logApi("GET", url, "(startup health check)");
    try {
      const res = await fetch(url);
      const data = await res.json();
      logApi("GET", url, "->", res.status, data, `${Date.now() - started}ms`);
    } catch (err) {
      console.error(
        "[chiron-web] Backend unreachable at",
        API_URL,
        `after ${Date.now() - started}ms:`,
        err,
      );
    }
  }

  async function refreshEvents() {
    setEventsLoading(true);
    const url = apiUrl("/api/events");
    const started = Date.now();
    logApi("GET", url);
    try {
      const res = await fetch(url);
      logApi("GET", url, "->", res.status, `${Date.now() - started}ms`);
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      console.error("[chiron-web] GET /api/events failed:", err);
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }

  async function send(text: string) {
    if (sending) return;
    setSending(true);

    const userMsg: UiMessage = { id: nextId(), role: "user", content: text };
    const pendingMsg: UiMessage = {
      id: nextId(),
      role: "assistant",
      content: "",
      pending: true,
    };
    const history = [...messages, userMsg];
    setMessages([...history, pendingMsg]);

    const url = apiUrl("/api/chat");
    const started = Date.now();
    logApi("POST", url, {
      channel: CHANNEL,
      messageCount: history.length,
      lastMessage: text,
    });

    try {
      const res = await authFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: CHANNEL,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          profile: profile
            ? {
                ui_mode: profile.ui_mode,
                accessibility_needs: profile.accessibility_needs,
                preferred_tags: profile.preferred_tags,
                city: profile.city,
                free_only: profile.free_only,
              }
            : null,
        }),
      });
      logApi("POST", url, "->", res.status, `${Date.now() - started}ms`);
      const data = (await res.json()) as AgentResult & { error?: string };
      logApi("POST", url, "response", {
        mode: data.mode,
        actions: data.actions?.length ?? 0,
        error: data.error,
      });

      const assistant: UiMessage = {
        id: pendingMsg.id,
        role: "assistant",
        content: data.error
          ? `Sorry — ${data.error}`
          : data.message || "Here's what I found.",
        actions: data.actions,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingMsg.id ? assistant : m)),
      );
      if (data.mode) setMode(data.mode);
    } catch (err) {
      console.error(
        "[chiron-web] POST /api/chat failed:",
        url,
        `after ${Date.now() - started}ms:`,
        err,
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                pending: false,
                content: "Sorry — I couldn't reach the server. Please try again.",
              }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  }

  function handleEventCreated(event: PublicEvent) {
    // Optimistically show it, then re-sort via a fresh fetch.
    setEvents((prev) =>
      [event, ...prev].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    );
    void refreshEvents();
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "assistant",
        content: `“${event.title}” is now published and will start appearing in recommendations. Anything else?`,
      },
    ]);
  }

  return (
    <div className="grid h-screen grid-cols-1 bg-slate-50 dark:bg-slate-950 lg:grid-cols-[minmax(0,1fr)_380px]">
      {needsQuiz === true && <OnboardingQuiz onDone={handleQuizDone} />}
      {profileOpen && (
        <ProfilePanel
          profile={profile}
          onProfileUpdated={(p) => {
            setProfile(p);
            if (p.ui_mode === "quick" && messages.length <= 1)
              setMessages([QUICK_GREETING]);
          }}
          onEventsChanged={() => void refreshEvents()}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {/* Chat column */}
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              C
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Chiron
              </h1>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Community event assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mode && <ModeBadge mode={mode} />}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                mounted && theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                mounted && theme === "dark" ? "Light mode" : "Dark mode"
              }
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:bg-slate-700 dark:hover:text-brand-200"
            >
              <ThemeIcon dark={mounted && theme === "dark"} />
            </button>
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              aria-label="Open your profile"
              title="Your profile"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700 dark:hover:text-brand-200"
            >
              {(user?.email?.[0] ?? "U").toUpperCase()}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-6"
        >
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {messages.map((m) => (
              <ChatMessageView
                key={m.id}
                message={m}
                onEventCreated={handleEventCreated}
                profileId={profile?.id ?? null}
                uiMode={uiMode}
              />
            ))}

            {messages.length <= 1 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {(uiMode === "quick" ? QUICK_SUGGESTIONS : SUGGESTIONS).map(
                  (s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className={
                        uiMode === "quick"
                          ? "rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-lg text-slate-700 hover:border-brand-400 hover:text-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-300"
                          : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-200"
                      }
                    >
                      {s}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl">
          <Composer onSend={send} disabled={sending} />
        </div>
      </div>

      {/* Results / calendar column */}
      <div className="hidden lg:block">
        <EventsPanel
          events={events}
          loading={eventsLoading}
          profileId={profile?.id ?? null}
        />
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: AgentResult["mode"] }) {
  const isLiveLlm = mode.llm === "openai" || mode.llm === "local";
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
      <span
        className={`rounded-full px-2 py-0.5 ${
          isLiveLlm
            ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
        }`}
        title="Which LLM served this response"
      >
        LLM: {mode.llm}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 ${
          mode.db === "supabase"
            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
        }`}
        title="Which database served this response"
      >
        DB: {mode.db}
      </span>
    </div>
  );
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
    </svg>
  ) : (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
    </svg>
  );
}
