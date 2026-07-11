"use client";

import { useCallback, useEffect, useState } from "react";
import {
  QUIZ_QUESTIONS,
  type EventRegistration,
  type Profile,
  type PublicEvent,
} from "@chiron/shared";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { EventCreateForm } from "@/components/EventCreateForm";

// The settings panel, opened from the header gear icon. Four tabs:
//   My events   — events the user published; each can be edited or deleted.
//   Joining     — the user's registrations; edit status/notes or cancel.
//   Analytics   — for each of the user's events, who's attending + an
//                 aggregated audience summary (only profiles that opted in
//                 to share their quiz-derived tags are folded in).
//   Preferences — the onboarding quiz answers, editable; saving re-derives
//                 the profile (ui_mode, tags) exactly like onboarding did.
//                 Privacy toggle lives here: opting out excludes this user's
//                 tags from any event-creator's analytics summary.

type Tab = "events" | "joining" | "analytics" | "preferences";

interface Props {
  profile: Profile | null;
  onProfileUpdated: (profile: Profile) => void;
  /** Called after an event edit so the main panel can refresh. */
  onEventsChanged: () => void;
  onClose: () => void;
}

export function ProfilePanel({
  profile,
  onProfileUpdated,
  onEventsChanged,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("events");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your profile"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-5 pt-2">
          <TabButton active={tab === "events"} onClick={() => setTab("events")}>
            My events
          </TabButton>
          <TabButton active={tab === "joining"} onClick={() => setTab("joining")}>
            Joining
          </TabButton>
          <TabButton
            active={tab === "analytics"}
            onClick={() => setTab("analytics")}
          >
            Analytics
          </TabButton>
          <TabButton
            active={tab === "preferences"}
            onClick={() => setTab("preferences")}
          >
            Preferences
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "events" && <MyEventsTab onEventsChanged={onEventsChanged} />}
          {tab === "joining" && <JoiningTab />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "preferences" && (
            <PreferencesTab profile={profile} onProfileUpdated={onProfileUpdated} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
        active
          ? "border-b-2 border-brand-600 text-brand-700"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

// --- My events ---------------------------------------------------------------

function MyEventsTab({ onEventsChanged }: { onEventsChanged: () => void }) {
  const { authFetch } = useAuth();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl("/api/my/events"));
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setEvents(data.events as PublicEvent[]);
    } catch {
      setError("Could not load your events.");
      setEvents([]);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeEvent(event: PublicEvent) {
    if (!window.confirm(`Delete “${event.title}”? This can't be undone.`)) return;
    setDeletingId(event.id);
    try {
      const res = await authFetch(apiUrl(`/api/events/${event.id}`), {
        method: "DELETE",
      });
      if (res.ok) {
        setEvents((prev) => (prev ?? []).filter((e) => e.id !== event.id));
        onEventsChanged();
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (events === null) return <Loading />;
  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        You haven&apos;t published any events yet. Ask Chiron to create one!
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-xl border border-slate-200 p-3">
          {editingId === event.id ? (
            <EventCreateForm
              draft={{}}
              event={event}
              onCreated={(updated) => {
                setEvents((prev) =>
                  (prev ?? []).map((e) => (e.id === updated.id ? updated : e)),
                );
                setEditingId(null);
                onEventsChanged();
              }}
            />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {event.title}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(event.start_time)}
                  {event.city ? ` · ${event.city}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setEditingId(event.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700"
                >
                  Edit
                </button>
                <button
                  onClick={() => void removeEvent(event)}
                  disabled={deletingId === event.id}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- Joining -------------------------------------------------------------------

function JoiningTab() {
  const { authFetch } = useAuth();
  const [registrations, setRegistrations] = useState<EventRegistration[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl("/api/my/registrations"));
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setRegistrations(data.registrations as EventRegistration[]);
    } catch {
      setError("Could not load your registrations.");
      setRegistrations([]);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(reg: EventRegistration, status: "interested" | "registered") {
    setBusyId(reg.id);
    try {
      const res = await authFetch(apiUrl(`/api/event-registrations/${reg.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (res.ok && data.registration) {
        setRegistrations((prev) =>
          (prev ?? []).map((r) => (r.id === reg.id ? data.registration : r)),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(reg: EventRegistration) {
    if (!window.confirm("Cancel this registration?")) return;
    setBusyId(reg.id);
    try {
      const res = await authFetch(apiUrl(`/api/event-registrations/${reg.id}`), {
        method: "DELETE",
      });
      if (res.ok) {
        setRegistrations((prev) => (prev ?? []).filter((r) => r.id !== reg.id));
      }
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (registrations === null) return <Loading />;
  if (registrations.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        You&apos;re not signed up for anything yet. Register from an event card
        to see it here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {registrations.map((reg) => {
        const snapshot = reg.event_snapshot;
        return (
          <li key={reg.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {snapshot?.title ?? "Event"}
                </p>
                <p className="text-xs text-slate-500">
                  {snapshot ? formatDateTime(snapshot.start_time) : ""}
                  {snapshot?.city ? ` · ${snapshot.city}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={reg.status}
                  disabled={busyId === reg.id}
                  onChange={(e) =>
                    void setStatus(
                      reg,
                      e.target.value as "interested" | "registered",
                    )
                  }
                  aria-label="Registration status"
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                >
                  <option value="interested">Interested</option>
                  <option value="registered">Registered</option>
                </select>
                <button
                  onClick={() => void cancel(reg)}
                  disabled={busyId === reg.id}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- Analytics -----------------------------------------------------------------

// Per-event analytics for events the current user published. Shows raw
// attendee counts + a server-built audience summary, which is itself
// derived only from profiles that opted in to share their quiz tags.

interface EventAnalytics {
  total: number;
  status_counts: { interested: number; registered: number };
  audience: {
    preferred_tags: Record<string, number>;
    accessibility_needs: Record<string, number>;
    opted_in: number;
    opted_out: number;
  };
  summary: string;
}

function AnalyticsTab() {
  const { authFetch } = useAuth();
  const [events, setEvents] = useState<PublicEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl("/api/my/events"));
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setEvents(data.events as PublicEvent[]);
    } catch {
      setError("Could not load your events.");
      setEvents([]);
    }
  }, [authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (events === null) return <Loading />;
  if (events.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Once you publish an event, attendance and audience insights will show up
        here.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <EventAnalyticsCard key={event.id} event={event} />
      ))}
    </ul>
  );
}

function EventAnalyticsCard({ event }: { event: PublicEvent }) {
  const { authFetch } = useAuth();
  const [analytics, setAnalytics] = useState<EventAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await authFetch(apiUrl(`/api/events/${event.id}/analytics`));
        const data = await res.json();
        if (!cancelled && res.ok) {
          setAnalytics(data as EventAnalytics);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authFetch, event.id]);

  const total = analytics?.total ?? 0;
  const interested = analytics?.status_counts.interested ?? 0;
  const registered = analytics?.status_counts.registered ?? 0;
  const optedOut = analytics?.audience.opted_out ?? 0;

  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">
          {event.title}
        </p>
        <p className="text-xs text-slate-500">
          {formatDateTime(event.start_time)}
          {event.city ? ` · ${event.city}` : ""}
        </p>
      </div>

      {loading ? (
        <p className="mt-2 text-sm text-slate-400">Loading analytics…</p>
      ) : total === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          No one has signed up yet.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-3 text-sm text-slate-700">
            <span>
              <strong className="font-semibold text-slate-900">{total}</strong>{" "}
              attendee{total === 1 ? "" : "s"}
            </span>
            <span className="text-slate-400">·</span>
            <span>{registered} registered</span>
            <span className="text-slate-400">·</span>
            <span>{interested} interested</span>
            {optedOut > 0 && (
              <>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">
                  {optedOut} opted out of sharing
                </span>
              </>
            )}
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {analytics?.summary}
          </p>
        </div>
      )}
    </li>
  );
}

// --- Preferences ----------------------------------------------------------------

function PreferencesTab({
  profile,
  onProfileUpdated,
}: {
  profile: Profile | null;
  onProfileUpdated: (profile: Profile) => void;
}) {
  const { authFetch, user } = useAuth();
  const [answers, setAnswers] = useState<Record<string, boolean>>(
    () => profile?.quiz_answers ?? {},
  );
  const [shareInAnalytics, setShareInAnalytics] = useState<boolean>(
    () => profile?.share_in_analytics ?? true,
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  async function save() {
    if (!user?.id) return;
    setStatus("saving");
    try {
      const res = await authFetch(apiUrl("/api/profile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, answers, city: profile?.city }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) throw new Error(data?.error);
      onProfileUpdated(data.profile as Profile);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  async function togglePrivacy(next: boolean) {
    if (!user?.id) return;
    setShareInAnalytics(next);
    try {
      const res = await authFetch(apiUrl("/api/profile"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_in_analytics: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.profile) throw new Error(data?.error);
      onProfileUpdated(data.profile as Profile);
    } catch {
      // revert on failure so the toggle reflects reality
      setShareInAnalytics(!next);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        These are your onboarding answers. Changing them updates how Chiron
        talks to you and what it recommends.
      </p>

      <ul className="space-y-2">
        {QUIZ_QUESTIONS.map((q) => {
          const value = answers[q.id] ?? false;
          return (
            <li
              key={q.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3"
            >
              <div>
                <p className="text-sm text-slate-800">{q.text}</p>
                {q.detail && (
                  <p className="text-xs text-slate-400">{q.detail}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1" role="group" aria-label={q.text}>
                <button
                  onClick={() => {
                    setAnswers((a) => ({ ...a, [q.id]: true }));
                    setStatus("idle");
                  }}
                  aria-pressed={value}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    value
                      ? "bg-brand-600 text-white"
                      : "border border-slate-300 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  Yes
                </button>
                <button
                  onClick={() => {
                    setAnswers((a) => ({ ...a, [q.id]: false }));
                    setStatus("idle");
                  }}
                  aria-pressed={!value}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    !value
                      ? "bg-slate-700 text-white"
                      : "border border-slate-300 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  No
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={status === "saving"}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Save preferences"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-emerald-600">✓ Saved</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-600">Could not save. Try again.</span>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Privacy</p>
            <p className="text-xs text-slate-500">
              When enabled, your quiz-derived tags may be aggregated into
              audience summaries shown to event creators. Turning this off keeps
              your tags private but means your preferences won&apos;t appear in
              analytics.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={shareInAnalytics}
            onClick={() => void togglePrivacy(!shareInAnalytics)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              shareInAnalytics ? "bg-brand-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                shareInAnalytics ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return <p className="text-sm text-slate-400">Loading…</p>;
}
