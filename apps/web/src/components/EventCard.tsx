import { CATEGORY_LABELS, type EventRecord } from "@chiron/shared";
import { formatDateTime } from "@/lib/format";

export function EventCard({ event }: { event: EventRecord }) {
  const where = event.is_online
    ? "Online"
    : [event.location_name, event.city].filter(Boolean).join(", ") || "Location TBD";

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
          {CATEGORY_LABELS[event.category] ?? event.category}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            event.is_free
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {event.is_free ? "Free" : event.cost_note || "Paid"}
        </span>
      </div>

      <h3 className="text-base font-semibold leading-snug text-slate-900">
        {event.title}
      </h3>
      <p className="mt-1 text-sm text-slate-600">{event.summary}</p>

      <dl className="mt-3 space-y-1 text-sm text-slate-700">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">When</dt>
          <dd>{formatDateTime(event.start_time)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">Where</dt>
          <dd>{where}</dd>
        </div>
        {event.audience && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400">For</dt>
            <dd>{event.audience}</dd>
          </div>
        )}
        {event.host_organization && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400">Host</dt>
            <dd>{event.host_organization}</dd>
          </div>
        )}
        {event.accessibility.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400">Access</dt>
            <dd>{event.accessibility.join(", ")}</dd>
          </div>
        )}
      </dl>

      {(event.registration_url || event.registration_instructions) && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          {event.registration_url ? (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
            >
              Register →
            </a>
          ) : (
            <span className="text-slate-600">
              {event.registration_instructions}
            </span>
          )}
        </div>
      )}
    </article>
  );
}
