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

// The profile panel, opened from the header avatar. Three tabs:
//   My events — events the user published; each can be edited in place.
//   Joining   — the user's registrations; edit status/notes or cancel.
//   Preferences — the onboarding quiz answers, editable; saving re-derives
//                 the profile (ui_mode, tags) exactly like onboarding did.

type Tab = "events" | "joining" | "preferences";

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Your profile</h2>
          <button
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-5 pt-2 dark:border-slate-800">
          <TabButton active={tab === "events"} onClick={() => setTab("events")}>
            My events
          </TabButton>
          <TabButton active={tab === "joining"} onClick={() => setTab("joining")}>
            Joining
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
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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
      <p className="text-sm text-slate-500 dark:text-slate-400">
        You haven&apos;t published any events yet. Ask Chiron to create one!
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
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
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {event.title}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(event.start_time)}
                  {event.city ? ` · ${event.city}` : ""}
                </p>
              </div>
              <button
                onClick={() => setEditingId(event.id)}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-200"
              >
                Edit
              </button>
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
      <p className="text-sm text-slate-500 dark:text-slate-400">
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
          <li key={reg.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {snapshot?.title ?? "Event"}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
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
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        These are your onboarding answers. Changing them updates how Chiron
        talks to you and what it recommends.
      </p>

      <ul className="space-y-2">
        {QUIZ_QUESTIONS.map((q) => {
          const value = answers[q.id] ?? false;
          return (
            <li
              key={q.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
            >
              <div>
                <p className="text-sm text-slate-800 dark:text-slate-100">{q.text}</p>
                {q.detail && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">{q.detail}</p>
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
                      : "border border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
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
                      ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900"
                      : "border border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600"
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
    </div>
  );
}

function Loading() {
  return <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>;
}
