"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult, Profile, PublicEvent } from "@chiron/shared";
import { ChatMessageView, type UiMessage } from "@/components/ChatMessage";
import { Composer } from "@/components/Composer";
import { EventsPanel } from "@/components/EventsPanel";
import { OnboardingQuiz } from "@/components/OnboardingQuiz";
import { apiUrl, CHANNEL } from "@/lib/api";

const PROFILE_STORAGE_KEY = "chiron_profile";

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
  const [messages, setMessages] = useState<UiMessage[]>([GREETING]);
  const [sending, setSending] = useState(false);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [mode, setMode] = useState<AgentResult["mode"] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // null = still reading localStorage (avoids flashing the quiz on reload).
  const [needsQuiz, setNeedsQuiz] = useState<boolean | null>(null);

  const uiMode = profile?.ui_mode ?? "elaborate";

  const idRef = useRef(0);
  const nextId = () => `m${++idRef.current}`;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshEvents();
    try {
      const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Profile;
        setProfile(parsed);
        if (parsed.ui_mode === "quick") setMessages([QUICK_GREETING]);
        setNeedsQuiz(false);
      } else {
        setNeedsQuiz(true);
      }
    } catch {
      setNeedsQuiz(true);
    }
  }, []);

  function handleQuizDone(newProfile: Profile | null) {
    setNeedsQuiz(false);
    if (!newProfile) return; // skipped — stay in elaborate mode, ask again next visit
    setProfile(newProfile);
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(newProfile));
    } catch {
      // Private browsing etc. — the profile just won't persist.
    }
    if (newProfile.ui_mode === "quick") setMessages([QUICK_GREETING]);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function refreshEvents() {
    setEventsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/events"));
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
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

    try {
      const res = await fetch(apiUrl("/api/chat"), {
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
      const data = (await res.json()) as AgentResult & { error?: string };

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
    } catch {
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
    <div className="grid h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      {needsQuiz === true && <OnboardingQuiz onDone={handleQuizDone} />}
      {/* Chat column */}
      <div className="flex h-screen flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              C
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">Chiron</h1>
              <p className="text-[11px] text-slate-400">
                Community event assistant
              </p>
            </div>
          </div>
          {mode && <ModeBadge mode={mode} />}
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            {messages.map((m) => (
              <ChatMessageView
                key={m.id}
                message={m}
                onEventCreated={handleEventCreated}
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
                          : "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700"
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
        <EventsPanel events={events} loading={eventsLoading} />
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: AgentResult["mode"] }) {
  const isLiveLlm = mode.llm === "openai" || mode.llm === "local";
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
      <span
        className={`rounded-full px-2 py-0.5 ${
          isLiveLlm
            ? "bg-brand-50 text-brand-700"
            : "bg-slate-100 text-slate-500"
        }`}
        title="Which LLM served this response"
      >
        LLM: {mode.llm}
      </span>
      <span
        className={`rounded-full px-2 py-0.5 ${
          mode.db === "supabase"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-slate-100 text-slate-500"
        }`}
        title="Which database served this response"
      >
        DB: {mode.db}
      </span>
    </div>
  );
}
