"use client";

import type { PublicEvent, UiAction, UiMode } from "@chiron/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EventCard } from "@/components/EventCard";
import { EventCreateForm } from "@/components/EventCreateForm";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";

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
  profileId,
  uiMode = "elaborate",
}: {
  message: UiMessage;
  onEventCreated: (event: PublicEvent) => void;
  profileId?: string | null;
  uiMode?: UiMode;
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
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          ) : (
            <div className="break-words leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => (
                    <p className="mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-slate-900">
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => (
                    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
                    >
                      {children}
                    </a>
                  ),
                  h1: ({ children }) => (
                    <h3 className="mb-1 mt-2 text-base font-semibold text-slate-900 first:mt-0">
                      {children}
                    </h3>
                  ),
                  h2: ({ children }) => (
                    <h3 className="mb-1 mt-2 text-base font-semibold text-slate-900 first:mt-0">
                      {children}
                    </h3>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mb-1 mt-2 text-sm font-semibold text-slate-900 first:mt-0">
                      {children}
                    </h3>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-800">
                      {children}
                    </code>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="mb-2 border-l-2 border-slate-300 pl-3 text-slate-600 last:mb-0">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {message.actions && message.actions.length > 0 && (
          <div className="mt-3 space-y-3">
            {message.actions.map((action, i) => (
              <ActionView
                key={i}
                action={action}
                onEventCreated={onEventCreated}
                profileId={profileId}
                uiMode={uiMode}
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
  profileId,
  uiMode,
}: {
  action: UiAction;
  onEventCreated: (event: PublicEvent) => void;
  profileId?: string | null;
  uiMode: UiMode;
}) {
  if (action.type === "events") {
    if (action.events.length === 0) return null;
    // Quick mode: one card per row — one thing to look at at a time.
    const grid = uiMode === "quick" ? "grid gap-4" : "grid gap-3 sm:grid-cols-2";
    return (
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {action.title}
        </p>
        <div className={grid}>
          {action.events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              profileId={profileId}
              uiMode={uiMode}
            />
          ))}
        </div>
      </div>
    );
  }

  if (action.type === "event_draft") {
    return <EventCreateForm draft={action.draft} onCreated={onEventCreated} />;
  }

  if (action.type === "event_registration") {
    if (!profileId) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Finish the quick profile first to register for {action.event.title}.
        </div>
      );
    }
    return <EventRegistrationForm event={action.event} profileId={profileId} />;
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
