# Chiron Architecture

This document describes the prototype scaffold: a Next.js app with a chat UI, an
agent orchestrator that makes tool calls, and a Supabase-backed events store.

## High-level flow

```
 Browser (ChatApp)
     │  POST /api/chat { messages }
     ▼
 /api/chat ──► runAgent(history)                     [src/lib/agent/orchestrator.ts]
                 │
                 ├─ getLlmClient()  ── openai / local ─► tool-calling loop
                 │     [src/lib/agent/llm.ts]            (model picks tools, we execute)
                 │        │  provider chosen by LLM_PROVIDER (auto: openai→local→mock)
                 │        └─ on any error ─► fall back to rule-based planner
                 └─ no model configured ─► rule-based planner  [src/lib/agent/mock-planner.ts]
                 │
                 ▼  both paths call the same tools
        executeTool(name, args)                       [src/lib/agent/tools.ts]
                 │        ├─ search_events    ─► events repository
                 │        ├─ recommend_events ─► events repository
                 │        └─ draft_event      ─► builds an EventDraft (no write)
                 ▼
        AgentResult { message, actions[], mode }
                 │  actions render as cards / a prefilled form
                 ▼
 Browser renders EventCard(s) and EventCreateForm inline in the chat
                 │  form submit → POST /api/events → createEvent()
                 ▼
        Supabase `events` table  (or in-memory mock store)
```

## The agent

The orchestrator (`runAgent`) is model-agnostic at the boundary: it always
returns an `AgentResult`:

```ts
interface AgentResult {
  message: string;            // assistant prose (a chat bubble)
  actions: UiAction[];        // cards to render beneath it
  mode: { llm; db };          // llm: "openai" | "local" | "mock"
}

type UiAction =
  | { type: "events"; title: string; events: EventRecord[] }
  | { type: "event_draft"; draft: EventDraft };
```

Separating **prose** from **UiActions** is the key idea. The model writes a
short natural-language reply, while structured results (event lists, the
creation form) are rendered by React components — not stuffed into text. This
keeps the UI accessible and lets the same agent output drive rich UI.

### Tools

Defined once in `src/lib/agent/tools.ts` as OpenAI function schemas, with an
`executeTool` dispatcher used by **both** the real and mock orchestrators:

| Tool | Purpose | Produces |
| --- | --- | --- |
| `search_events` | Concrete filtered search | `events` action |
| `recommend_events` | Curated suggestions (falls back to upcoming) | `events` action |
| `draft_event` | Prefill the creation form; **does not publish** | `event_draft` action |

Each executor returns `{ forModel, actions }` — `forModel` is the compact JSON
the model reasons over next; `actions` are what the UI renders.

### Model path (OpenAI **or** local)

`llm.ts` resolves the active provider and returns an OpenAI SDK client — either
the hosted API or a local server (llama.cpp / Ollama / LM Studio) via a
`baseURL`. Because every endpoint speaks the same protocol, `orchestrator.ts`
runs one bounded loop (`MAX_TOOL_ROUNDS`): send messages + tools → if the model
returns tool calls, execute them, append tool results, and loop; otherwise
return the final text. Collected `actions` accumulate across rounds. Any error
from the live model (e.g. local server down) is caught and the request falls
through to the mock planner. See [`local-model.md`](local-model.md).

### Mock path

`mock-planner.ts` does lightweight intent detection (create / recommend /
search) and entity extraction (city, category, date, address) with regex, then
calls the **same** `executeTool`. This makes the full product loop demoable with
no API key, and documents exactly what the agent is expected to extract.

## The data layer

`src/lib/supabase/events.ts` is the single repository the app uses. It targets
Supabase when configured and an in-memory store otherwise — callers never
branch on backend:

```ts
searchEvents(filters) · upcomingEvents(limit) · getEvent(id) · createEvent(input)
```

Filtering semantics are kept consistent between backends: the mock store uses a
pure `applyFilters` function (`mock-store.ts`) that mirrors the Supabase query
built in `events.ts`.

Schema lives in `supabase/migrations/0001_init.sql`; the `event_category` enum is
kept in sync with `EVENT_CATEGORIES` in `src/lib/types/events.ts`.

## The UI

- `ChatApp` — top-level client component: chat state, calls `/api/chat`, keeps
  the right-hand events/calendar panel in sync, handles form submissions.
- `ChatMessageView` — renders a bubble plus any `UiAction` cards.
- `EventCard` — an accessible event summary.
- `EventsPanel` — upcoming events grouped by day (a lightweight calendar).
- `EventCreateForm` — the creation "page" surfaced inline, prefilled from a
  draft; submits to `POST /api/events`.

Accessibility is treated as core (per the product overview): semantic elements,
visible focus rings, keyboard-submittable composer, labelled form fields, and no
reliance on color alone.

## Extending this scaffold

- **Streaming**: swap `/api/chat` to stream tokens + incremental actions.
- **Auth & ownership**: add Supabase Auth; scope insert/update RLS to the owning
  nonprofit instead of the prototype's open policies.
- **Flyer ingestion**: add a `parse_flyer` tool (vision) that returns an
  `EventDraft`.
- **Boardy-like delivery**: a scheduled job that matches new events to saved
  user profiles and sends email/WhatsApp digests.
```
