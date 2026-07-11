"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentResult, Profile, PublicEvent } from "@chiron/shared";
import { ChatMessageView, type UiMessage } from "@/components/ChatMessage";
import { Composer } from "@/components/Composer";
import { EventsPanel } from "@/components/EventsPanel";
import { OnboardingQuiz } from "@/components/OnboardingQuiz";
import { apiUrl, API_URL, CHANNEL, logApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const SUGGESTIONS = [
  "Find all events in Markham for food banks",
  "Recommend me some events",
  "Create a charity fundraiser next Saturday at Cherry St",
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
  const [messages, setMessages] = useState<UiMessage[]>([GREETING]);
  const [sending, setSending] = useState(false);
  const [demoCalling, setDemoCalling] = useState(false);
  const [demoEmailing, setDemoEmailing] = useState(false);
  // Mobile-only: the events panel is a slide-over drawer below the lg breakpoint.
  const [showEvents, setShowEvents] = useState(false);
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

  async function triggerDemoCall() {
    setDemoCalling(true);
    const url = apiUrl("/api/demo/call-user");
    logApi("POST", url, "(demo outbound call)");
    try {
      const res = await authFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Demo call failed.",
        );
      }
      const goals = (data.voice_ontology?.event_goals as string[] | undefined) ?? [];
      const goalText =
        goals.length > 0 ? ` Saved goals: ${goals.join("; ")}.` : "";
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: `Demo call placed to ${data.user as string} about "${(data.event as { title: string }).title}".${data.mock ? " (mock mode)" : ""}${goalText}`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content:
            err instanceof Error
              ? `Demo call failed: ${err.message}`
              : "Demo call failed.",
        },
      ]);
    } finally {
      setDemoCalling(false);
    }
  }

  async function triggerDemoEmail() {
    setDemoEmailing(true);
    const url = apiUrl("/api/demo/email-events");
    logApi("POST", url, "(demo email digest)");
    try {
      const res = await authFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Demo email failed.",
        );
      }
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: `Emailed a digest of ${data.count as number} cool events to ${data.to as string}. 📬`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content:
            err instanceof Error
              ? `Demo email failed: ${err.message}`
              : "Demo email failed.",
        },
      ]);
    } finally {
      setDemoEmailing(false);
    }
  }

  return (
    <div className="grid h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      {needsQuiz === true && <OnboardingQuiz onDone={handleQuizDone} />}
      {/* Chat column */}
      <div className="flex h-screen min-w-0 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              C
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-slate-900">Chiron</h1>
              <p className="truncate text-[11px] text-slate-400">
                Community event assistant
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode && <ModeBadge mode={mode} />}
            <button
              type="button"
              onClick={() => setShowEvents(true)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 lg:hidden"
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => void triggerDemoCall()}
              disabled={demoCalling}
              title="Manually call Maria Chen and ask what she wants from the upcoming food bank event"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {demoCalling ? "Calling…" : (
                <>
                  <span className="sm:hidden">Call</span>
                  <span className="hidden sm:inline">Demo: Call user</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void triggerDemoEmail()}
              disabled={demoEmailing}
              title="Email a summary of cool upcoming events to the demo recipient"
              className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
            >
              {demoEmailing ? "Sending…" : (
                <>
                  <span className="sm:hidden">Email</span>
                  <span className="hidden sm:inline">Demo: Email events</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
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

      {/* Results / calendar column (desktop) */}
      <div className="hidden lg:block">
        <EventsPanel
          events={events}
          loading={eventsLoading}
          profileId={profile?.id ?? null}
        />
      </div>

      {/* Results / calendar drawer (mobile) */}
      {showEvents && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close events"
            onClick={() => setShowEvents(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-semibold text-slate-900">
                Upcoming events
              </span>
              <button
                type="button"
                onClick={() => setShowEvents(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <EventsPanel
                events={events}
                loading={eventsLoading}
                profileId={profile?.id ?? null}
              />
            </div>
          </div>
        </div>
      )}
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
