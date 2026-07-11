# Chiron

An AI-first community event assistant. Chat to **find** local nonprofit events or
**publish** a new one.

Chiron is a **monorepo** split into a standalone, channel-aware **backend** and
one or more thin **frontends**. The backend holds all agent + data logic and is
deployed on its own (Docker + Cloudflare); every frontend — the web app today,
plus a voice agent and WhatsApp bot — calls it over HTTP.

```
apps/
  web/        # Next.js chat UI (thin client; calls the backend over HTTP)
  server/     # standalone Hono backend: channel-aware agent + events API + Docker
  whatsapp/   # WhatsApp webhook client (thin client; calls the backend over HTTP)
packages/
  shared/     # the contract shared by every frontend + the backend (@chiron/shared)
```

The backend is **channel-aware**: on the **web** app it surfaces event cards and
a **prefilled creation form**; on prose-only channels (**voice / whatsapp /
email**) it has no form to render, so it keeps **asking questions like any LLM**
and returns text only.

See [`docs/project-overview.md`](docs/project-overview.md) for the product vision,
[`docs/architecture.md`](docs/architecture.md) for how it's wired, and
[`docs/deploy.md`](docs/deploy.md) for Docker + Cloudflare deployment.

## Quick start

Requires Node.js 18.18+. This is an npm-workspaces monorepo — install once at the
root.

```bash
npm install

# 1) Backend (agent + events API) — http://localhost:8787
cp apps/server/.env.example apps/server/.env   # optional — see "Modes" below
npm run dev:server

# 2) Web frontend — http://localhost:3000
cp apps/web/.env.example apps/web/.env.local   # sets NEXT_PUBLIC_API_URL
npm run dev:web

# 3) WhatsApp bot (optional) — http://localhost:8788
cp apps/whatsapp/.env.example apps/whatsapp/.env   # Meta Cloud API credentials
npm run dev:whatsapp
# See docs/whatsapp.md for Meta webhook setup + ngrok
```

**It runs with zero configuration.** With no keys set, the backend uses a
deterministic rule-based planner and an in-memory seed database, so you can demo
the whole loop immediately. Add keys to progressively enable the real services.

## Modes

The backend degrades gracefully — set env in `apps/server/.env`. Each capability
lights up independently:

| Env vars set | Behavior |
| --- | --- |
| _none_ | Mock planner + in-memory events (great for demos) |
| `OPENAI_API_KEY` | Real OpenAI tool-calling orchestrator |
| `LOCAL_LLM_ENABLED=true` | Local GGUF model (`Qwen3-8B-Q4_K_M.gguf`) via **llama.cpp** — run `./scripts/setup-llama.sh`, then `./scripts/serve-local-model.sh`. See [`docs/local-model.md`](docs/local-model.md) |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` | Reads/writes a real Supabase `events` table (the `NEXT_PUBLIC_*` names are also accepted) |

**LLM provider** is chosen by `LLM_PROVIDER` (default `auto`): OpenAI if keyed,
else a local model if enabled, else the mock planner. If a live model call
fails, Chiron auto-falls back to the mock planner so it never hard-fails. A
small badge in the web header shows which LLM and DB served each response.

## Channels

Every `/api/chat` request carries a `channel`. The backend adapts:

| Channel | Behavior |
| --- | --- |
| `web` | Rich UI: offers `draft_event`, surfaces event **cards** and a **prefilled creation form**. |
| `voice` / `whatsapp` / `email` / `api` | Prose-only: no form to render, so the agent **asks clarifying questions** and describes results in words. `actions` is always empty. |

```bash
# web → surfaces the creation form
curl -XPOST localhost:8787/api/chat -H 'content-type: application/json' \
  -d '{"channel":"web","messages":[{"role":"user","content":"create a food bank event"}]}'
# whatsapp → asks questions instead
curl -XPOST localhost:8787/api/chat -H 'content-type: application/json' \
  -d '{"channel":"whatsapp","messages":[{"role":"user","content":"create a food bank event"}]}'
```

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
   `apps/server/.env`.

## Deployment

The backend is packaged with Docker and meant to run on its own behind a custom
domain (Cloudflare DNS-proxied origin). See [`docs/deploy.md`](docs/deploy.md).

```bash
docker compose up --build      # backend on :8787
```

## Scripts (run at the repo root)

| Script | Purpose |
| --- | --- |
| `npm run dev:server` | Start the backend (`apps/server`) on :8787 |
| `npm run dev:web` | Start the web frontend (`apps/web`) on :3000 |
| `npm run dev:whatsapp` | Start the WhatsApp webhook client (`apps/whatsapp`) on :8788 |
| `npm run build` | Build backend bundle + web production build |
| `npm run typecheck` | Typecheck all workspaces |

## Layout

```
apps/
  web/                         # Next.js frontend (thin client)
    src/app/                   # page.tsx renders <ChatApp/>, layout, globals
    src/components/            # ChatApp, EventCard, EventCreateForm, ...
    src/lib/{api,format}.ts    # backend base URL + client-side formatting
  server/                      # standalone backend (Hono on Node)
    src/index.ts               # boots @hono/node-server
    src/http/app.ts            # routes: /api/chat, /api/events, /health
    src/agent/                 # orchestrator, tools, prompts, mock planner (channel-aware)
    src/data/                  # supabase client + events repository + mock store
    src/config.ts              # env + feature detection
    Dockerfile, tsup.config.ts
  whatsapp/                    # WhatsApp webhook client (Meta Cloud API)
    src/index.ts               # GET/POST /webhook, POST /test
    src/webhooks.ts            # Meta verification + inbound message handling
    src/agent-client.ts        # POST /api/chat with channel=whatsapp
    src/session.ts             # per-user conversation history
    src/whatsapp.ts            # Meta send/read helpers
packages/
  shared/src/                  # @chiron/shared: channels, chat/agent types, event types
supabase/
  migrations/0001_init.sql     # events schema
  seed.sql
docker-compose.yml             # backend (+ optional Caddy TLS for Cloudflare)
```
