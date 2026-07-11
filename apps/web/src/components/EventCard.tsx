"use client";

import { useState } from "react";
import {
  CATEGORY_LABELS,
  type PublicEvent,
  type UiMode,
} from "@chiron/shared";
import { formatDateTime } from "@/lib/format";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";

export function EventCard({
  event,
  uiMode = "elaborate",
  profileId,
}: {
  event: PublicEvent;
  uiMode?: UiMode;
  profileId?: string | null;
}) {
  const [showRegistration, setShowRegistration] = useState(false);
  const where = event.is_online
    ? "Online"
    : [event.location_name, event.city].filter(Boolean).join(", ") || "Location TBD";

  if (uiMode === "quick") {
    return (
      <QuickEventCard event={event} where={where} profileId={profileId} />
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {event.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt=""
          className="-mx-4 -mt-4 mb-3 h-32 w-[calc(100%+2rem)] max-w-none object-cover"
        />
      )}
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-200">
          {CATEGORY_LABELS[event.category] ?? event.category}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            event.is_free
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {event.is_free ? "Free" : event.cost_note || "Paid"}
        </span>
      </div>

      <h3 className="text-base font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {event.title}
      </h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{event.summary}</p>

      <dl className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-200">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400 dark:text-slate-500">When</dt>
          <dd>{formatDateTime(event.start_time)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400 dark:text-slate-500">Where</dt>
          <dd>{where}</dd>
        </div>
        {event.audience && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400 dark:text-slate-500">For</dt>
            <dd>{event.audience}</dd>
          </div>
        )}
        {event.host_organization && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400 dark:text-slate-500">Host</dt>
            <dd>{event.host_organization}</dd>
          </div>
        )}
        {event.accessibility.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-400 dark:text-slate-500">Access</dt>
            <dd>{event.accessibility.join(", ")}</dd>
          </div>
        )}
      </dl>

      {(event.registration_url || event.registration_instructions) && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
          {event.registration_url ? (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
            >
              External signup →
            </a>
          ) : (
            <span className="text-slate-600 dark:text-slate-300">
              {event.registration_instructions}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShowRegistration((v) => !v)}
          disabled={!profileId}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {showRegistration ? "Hide form" : "Register"}
        </button>
        {!profileId && (
          <span className="text-xs text-slate-500">
            Finish the quick profile first.
          </span>
        )}
      </div>

      {showRegistration && profileId && (
        <EventRegistrationForm event={event} profileId={profileId} />
      )}
    </article>
  );
}

/**
 * The "quick" presentation: larger text, icons paired with words, and only the
 * details needed to decide — what, when, where, cost.
 */
function QuickEventCard({
  event,
  where,
  profileId,
}: {
  event: PublicEvent;
  where: string;
  profileId?: string | null;
}) {
  const [showRegistration, setShowRegistration] = useState(false);

  return (
    <article className="overflow-hidden rounded-xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {event.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image_url}
          alt=""
          className="-mx-5 -mt-5 mb-4 h-40 w-[calc(100%+2.5rem)] max-w-none object-cover"
        />
      )}
      <h3 className="text-xl font-semibold leading-snug text-slate-900 dark:text-slate-100">
        {event.title}
      </h3>
      <p className="mt-2 text-lg leading-relaxed text-slate-700 dark:text-slate-300">
        {event.summary}
      </p>

      <ul className="mt-4 space-y-2 text-lg text-slate-800 dark:text-slate-200">
        <li className="flex items-start gap-3">
          <span aria-hidden="true">📅</span>
          <span>{formatDateTime(event.start_time)}</span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden="true">📍</span>
          <span>{where}</span>
        </li>
        <li className="flex items-start gap-3">
          <span aria-hidden="true">💵</span>
          <span>{event.is_free ? "Free" : event.cost_note || "Costs money"}</span>
        </li>
      </ul>

      {event.registration_url && (
        <a
          href={event.registration_url}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block rounded-xl bg-brand-600 px-6 py-3 text-lg font-semibold text-white hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-300"
        >
          External signup
        </a>
      )}

      <button
        type="button"
        onClick={() => setShowRegistration((v) => !v)}
        disabled={!profileId}
        className="mt-4 block rounded-xl bg-brand-600 px-6 py-3 text-lg font-semibold text-white hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-300 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {showRegistration ? "Hide form" : "Register"}
      </button>
      {!profileId && (
        <p className="mt-2 text-base text-slate-500 dark:text-slate-400">
          Finish the quick profile first.
        </p>
      )}

      {showRegistration && profileId && (
        <EventRegistrationForm event={event} profileId={profileId} />
      )}
    </article>
  );
}
