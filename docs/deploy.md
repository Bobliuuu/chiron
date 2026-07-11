# Deploying the Chiron backend

The backend (`apps/server`) is a standalone Hono service. It has no dependency
on the web app and is deployed on its own — the web app, a voice agent, and a
WhatsApp bot all call it over HTTP. This guide covers packaging it with Docker
and putting it on a **custom domain as a Cloudflare DNS-proxied origin**.

```
 Browsers / voice / WhatsApp
        │  HTTPS  →  api.<yourdomain>
        ▼
 Cloudflare (proxied DNS, Full (strict) TLS)
        │  HTTPS
        ▼
 Your host  ─ Caddy :443 ─ terminates TLS (Cloudflare Origin Cert)
                    │  HTTP
                    ▼
             chiron-server :8787  (Docker)
```

## 1. Build & run the image

Build from the **repo root** (the Dockerfile needs the workspace):

```bash
docker build -f apps/server/Dockerfile -t chiron-server .
```

Configure the service, then run it:

```bash
cp apps/server/.env.example apps/server/.env   # fill in keys (or leave blank for mock mode)
docker compose up -d server                    # server on :8787
curl http://localhost:8787/health              # {"ok":true,...}
```

Key env vars (`apps/server/.env`):

| Var | Purpose |
| --- | --- |
| `PORT` | Listen port (default `8787`). |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed via CORS. Set to your web app's domain in prod, e.g. `https://chiron.example`. |
| `OPENAI_API_KEY` | Enables the real OpenAI agent (else mock/local). |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Enables the real events DB (else in-memory). |

With no keys set the backend runs in **mock mode** (rule-based agent +
in-memory events), so it boots and serves immediately.

## 2. Put it on a custom domain via Cloudflare (DNS-proxied origin)

1. **DNS record.** In the Cloudflare dashboard for your zone, add a record for
   the API subdomain pointing at your host, with the **proxy enabled**
   (orange cloud):
   - `A  api  <your-host-public-IP>`  — Proxied
   *(or `CNAME api <your-host-hostname>` — Proxied)*

2. **Origin Certificate.** Go to **SSL/TLS → Origin Server → Create
   Certificate**. Save the certificate as `deploy/certs/origin.pem` and the
   private key as `deploy/certs/origin.key` (this folder is gitignored).

3. **SSL/TLS mode.** Set **SSL/TLS → Overview → Full (strict)** so Cloudflare
   validates the origin cert.

4. **Terminate TLS at the origin with Caddy.** Edit `deploy/Caddyfile` and
   replace `api.chiron.example` with your subdomain, then bring up the `edge`
   profile (server stays internal, Caddy faces the internet on 443):

   ```bash
   docker compose --profile edge up -d
   ```

   Caddy serves `api.<yourdomain>` with the Cloudflare Origin Cert and reverse-
   proxies to `server:8787`.

5. **Point the frontends at it.** Set the web app's
   `NEXT_PUBLIC_API_URL=https://api.<yourdomain>` and the server's
   `ALLOWED_ORIGINS=https://<your-web-domain>`. The voice agent and WhatsApp bot
   simply POST `https://api.<yourdomain>/api/chat` with their own `channel`.
   For the VAPI phone agent, see [vapi.md](./vapi.md) — VAPI calls
   `POST /v1/chat/completions` instead.

### Alternative: skip Caddy

If you terminate TLS elsewhere (an existing nginx/Traefik, or Cloudflare
"Flexible" TLS for non-production), just expose the `server` container's `:8787`
and proxy to it — the `edge`/Caddy profile is optional.

## 3. Verify the deployment

```bash
curl https://api.<yourdomain>/health
# Web channel surfaces the creation UI:
curl -XPOST https://api.<yourdomain>/api/chat -H 'content-type: application/json' \
  -d '{"channel":"web","messages":[{"role":"user","content":"create a food bank event"}]}'
#   → response has an "event_draft" action
# WhatsApp channel asks questions instead:
curl -XPOST https://api.<yourdomain>/api/chat -H 'content-type: application/json' \
  -d '{"channel":"whatsapp","messages":[{"role":"user","content":"create a food bank event"}]}'
#   → "actions": [] and a follow-up question
```

## Adding another frontend

The backend is channel-aware, so a new frontend is just a new client:

1. POST to `/api/chat` with `{ "channel": "voice" | "whatsapp" | "email" | "api", "messages": [...] }`.
2. Render `AgentResult.message` (prose). Rich channels (`web`) may also render
   `AgentResult.actions` (event cards + the creation form); prose-only channels
   receive an empty `actions` array by design.
3. Add the channel's browser origin to `ALLOWED_ORIGINS` if it calls from a
   browser. Share the request/response types by importing `@chiron/shared`.
