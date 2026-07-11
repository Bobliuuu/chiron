# Chiron

An AI-first community event assistant. Chat to **find** local nonprofit events or
**publish** a new one. The assistant surfaces event results as cards and, for
creation, drops a **prefilled event form** right into the conversation for a
human to review and submit.

See [`docs/project-overview.md`](docs/project-overview.md) for the product vision
and [`docs/architecture.md`](docs/architecture.md) for how this scaffold is wired.

## Quick start

Requires Node.js 18.18+.

```bash
npm install
cp .env.example .env.local   # optional — see "Modes" below
npm run dev                  # http://localhost:3000
```

**It runs with zero configuration.** With no keys set, Chiron uses a
deterministic rule-based planner and an in-memory seed database, so you can demo
the whole loop immediately. Add keys to progressively enable the real services.

## Modes

Chiron degrades gracefully. Each capability lights up independently:

| Env vars set | Behavior |
| --- | --- |
| _none_ | Mock planner + in-memory events (great for demos) |
| `OPENAI_API_KEY` | Real OpenAI tool-calling orchestrator |
| `LOCAL_LLM_ENABLED=true` | Local GGUF model (`Qwen3-8B-Q4_K_M.gguf`) via **llama.cpp** — run `./scripts/setup-llama.sh`, then `./scripts/serve-local-model.sh`. See [`docs/local-model.md`](docs/local-model.md) |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Reads/writes a real Supabase `events` table |

**LLM provider** is chosen by `LLM_PROVIDER` (default `auto`): OpenAI if keyed,
else a local model if enabled, else the mock planner. If a live model call
fails, Chiron auto-falls back to the mock planner so it never hard-fails. A
small badge in the header shows which LLM and DB served each response.

## Try these prompts

- `Find all events in Markham for food banks`
- `Recommend me some events`
- `Create an event for a charity fundraiser on June 20th at Cherry St`

## Supabase setup (optional)

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) in
   the SQL editor (creates the `events` table, indexes, and RLS policies).
3. Optionally run [`supabase/seed.sql`](supabase/seed.sql) for sample data.
4. Put the project URL + anon key (and optionally the service-role key) in
   `.env.local`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next.js ESLint |

## Layout

```
src/
  app/
    page.tsx                 # renders <ChatApp/>
    layout.tsx, globals.css
    api/
      chat/route.ts          # POST -> runs the agent orchestrator
      events/route.ts        # GET upcoming, POST create
  components/                # ChatApp, EventCard, EventCreateForm, ...
  lib/
    agent/                   # orchestrator, tools, prompts, mock planner
    supabase/                # client + events repository + mock store
    types/events.ts          # shared event domain types
supabase/
  migrations/0001_init.sql   # events schema
  seed.sql
```
