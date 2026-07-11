"use client";

import type { EventRecord } from "@/lib/types/events";
import type { UiAction } from "@/lib/agent/types";
import { EventCard } from "@/components/EventCard";
import { EventCreateForm } from "@/components/EventCreateForm";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: UiAction[];
  pending?: boolean;
}

export function ChatMessageView({
  message,
  onEventCreated,
}: {
  message: UiMessage;
  onEventCreated: (event: EventRecord) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        <div
          className={
            isUser
              ? "rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white"
              : "rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200"
          }
        >
          {message.pending ? (
            <TypingDots />
          ) : (
            <p className="whitespace-pre-wrap leading-relaxed">
              {message.content}
            </p>
          )}
        </div>

        {message.actions && message.actions.length > 0 && (
          <div className="mt-3 space-y-3">
            {message.actions.map((action, i) => (
              <ActionView
                key={i}
                action={action}
                onEventCreated={onEventCreated}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionView({
  action,
  onEventCreated,
}: {
  action: UiAction;
  onEventCreated: (event: EventRecord) => void;
}) {
  if (action.type === "events") {
    if (action.events.length === 0) return null;
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {action.title}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {action.events.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      </div>
    );
  }

  if (action.type === "event_draft") {
    return <EventCreateForm draft={action.draft} onCreated={onEventCreated} />;
  }

  return null;
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="Chiron is typing">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
    </span>
  );
}
