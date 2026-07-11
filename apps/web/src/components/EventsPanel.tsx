"use client";

import { useMemo } from "react";
import type { EventRecord } from "@chiron/shared";
import { EventCard } from "@/components/EventCard";
import { formatDate } from "@/lib/format";

// The right-hand results panel: a lightweight "calendar" grouping of upcoming
// events by day, plus each event as a card. Refreshed whenever an event is
// created.
export function EventsPanel({
  events,
  loading,
}: {
  events: EventRecord[];
  loading: boolean;
}) {
  const groups = useMemo(() => groupByDay(events), [events]);

  return (
    <aside className="flex h-full flex-col border-l border-slate-200 bg-white/60">
      <header className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Upcoming events
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {loading ? "Loading…" : `${events.length} on the calendar`}
        </p>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {!loading && events.length === 0 && (
          <p className="text-sm text-slate-500">
            No upcoming events yet. Ask Chiron to create one.
          </p>
        )}
        {groups.map(({ day, items }) => (
          <section key={day}>
            <h3 className="mb-2 text-xs font-semibold text-slate-400">{day}</h3>
            <div className="space-y-3">
              {items.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function groupByDay(events: EventRecord[]) {
  const map = new Map<string, EventRecord[]>();
  for (const e of events) {
    const day = formatDate(e.start_time) || "Date TBD";
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
}
