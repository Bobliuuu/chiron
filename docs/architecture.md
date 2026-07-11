# Chiron Architecture

Chiron is a monorepo with a **standalone backend** and **thin frontends**:

- `apps/server` — a **Hono** service (the whole agent + events API). Packaged
  with Docker and deployed on its own behind Cloudflare. Frontend-agnostic.
- `apps/web` — a **Next.js** chat UI that holds no business logic; it calls the
  backend over HTTP.
- `packages/shared` (`@chiron/shared`) — the request/response **contract**
  (channels, chat/agent types, event domain types) imported by both.

The same backend serves every frontend (web today; a voice agent and WhatsApp
bot next). It is **channel-aware**: each request declares its `channel`, and the
agent adapts what it does with the response.

## High-level flow

```
 Frontend (web ChatApp / voice / whatsapp / email)
     │  POST {API_URL}/api/chat { channel, messages }
     ▼
 apps/server  Hono  [src/http/app.ts]  ──► runAgent({ channel, messages })   [src/agent/orchestrator.ts]
                 │       capabilitiesFor(channel) → { richUi }
                 │
                 ├─ getLlmClient()  ── openai / local ─► tool-calling loop
                 │     [src/agent/llm.ts]               (model picks tools, we execute)
                 │        │  provider chosen by LLM_PROVIDER (auto: openai→local→mock)
                 │        │  tools = toolsFor(caps)  ── draft_event only when richUi
                 │        └─ on any error ─► fall back to rule-based planner
                 └─ no model configured ─► rule-based planner  [src/agent/mock-planner.ts]
                 │
                 ▼  both paths call the same tools
        executeTool(name, args)                        [src/agent/tools.ts]
                 │        ├─ search_events    ─► events repository  [src/data/events.ts]
                 │        ├─ recommend_events ─► events repository
                 │        └─ draft_event      ─► builds an EventDraft (no write)
                 ▼
        AgentResult { message, actions[], mode }
                 │  richUi → actions kept; prose-only → actions dropped
                 ▼
 web renders EventCard(s) + EventCreateForm inline; other channels use message only
                 │  web form submit → POST {API_URL}/api/events → createEvent()
                 ▼
        Supabase `events` table  (or in-memory mock store)
```

## Channels

`Channel = "web" | "voice" | "whatsapp" | "email" | "api"`, defined in
`@chiron/shared`. `capabilitiesFor(channel)` maps it to `{ richUi }` — only
`web` is rich today. The capability threads through three places
(`orchestrator.ts`):

| | `web` (richUi) | prose-only channels |
| --- | --- | --- |
| **Tools** (`toolsFor`) | search, recommend, **draft_event** | search, recommend (draft_event withheld) |
| **Prompt** (`systemPrompt`) | "surface the creation form" | "no screen — ask short questions" |
| **Result** (`finalize`) | `actions` kept (cards + form) | `actions` dropped (text only) |

So the web app **always surfaces the event-creation UI** on create intent, while
voice/whatsapp/email **keep asking questions like any LLM**. The mock planner
mirrors the same split so the behavior holds with no API key.

## The agent

The orchestrator (`runAgent`) is model-agnostic at the boundary: given
`{ channel, messages }` it always returns an `AgentResult`:

```ts
interface AgentResult {
  message: string;                       // assistant prose (a chat bubble)
  actions: UiAction[];                   // cards to render beneath it (rich channels only)
  mode: { llm; db; channel };            // llm: "openai" | "local" | "mock"
}

type UiAction =
  | { type: "events"; title: string; events: EventRecord[] }
  | { type: "event_draft"; draft: EventDraft };
```

Separating **prose** from **UiActions** is the key idea. The model writes a
short natural-language reply, while structured results (event lists, the
creation form) are rendered by the web components — not stuffed into text. This
keeps the UI accessible, lets the same agent output drive rich UI, and lets
prose-only channels consume just `message`.

### Tools

Defined once in `apps/server/src/agent/tools.ts` as OpenAI function schemas, with
an `executeTool` dispatcher used by **both** the real and mock orchestrators.
`toolsFor(caps)` selects which are advertised per channel:

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

`apps/server/src/data/events.ts` is the single repository the backend uses. It
targets Supabase when configured and an in-memory store otherwise — callers never
branch on backend:

```ts
searchEvents(filters) · upcomingEvents(limit) · getEvent(id) · createEvent(input)
```

Filtering semantics are kept consistent between backends: the mock store uses a
pure `applyFilters` function (`data/mock-store.ts`) that mirrors the Supabase
query built in `data/events.ts`.

Schema lives in `supabase/schema.sql` (the single source of truth); the
`event_category` enum is kept in sync with `EVENT_CATEGORIES` in
`packages/shared/src/events.ts`.

## The web UI (apps/web)

A thin client — it holds no agent/data logic and reaches the backend through
`src/lib/api.ts` (`NEXT_PUBLIC_API_URL`, sends `channel: "web"`).

- `ChatApp` — top-level client component: chat state, calls `{API_URL}/api/chat`,
  keeps the right-hand events/calendar panel in sync, handles form submissions.
- `ChatMessageView` — renders a bubble plus any `UiAction` cards.
- `EventCard` — an accessible event summary.
- `EventsPanel` — upcoming events grouped by day (a lightweight calendar).
- `EventCreateForm` — the creation "page" surfaced inline, prefilled from a
  draft; submits to `{API_URL}/api/events`.

Accessibility is treated as core (per the product overview): semantic elements,
visible focus rings, keyboard-submittable composer, labelled form fields, and no
reliance on color alone.

## Extending this scaffold

- **New frontend** (voice / WhatsApp): a new client that POSTs `/api/chat` with
  its `channel` and renders `message` (see [`deploy.md`](deploy.md)).
- **Streaming**: swap `/api/chat` to stream tokens + incremental actions.
- **Auth & ownership**: add Supabase Auth; scope insert/update RLS to the owning
  nonprofit instead of the prototype's open policies.
- **Flyer ingestion**: add a `parse_flyer` tool (vision) that returns an
  `EventDraft`.
- **Boardy-like delivery**: a scheduled job that matches new events to saved
  user profiles and sends email/WhatsApp digests.
```
