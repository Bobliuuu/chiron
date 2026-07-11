# WhatsApp bot

Chiron's WhatsApp integration is a **thin webhook client** that forwards messages to
the same backend as the web app and voice agent. All LLM orchestration, tools, and
event storage live in `apps/server` — this service only handles WhatsApp transport.

```
WhatsApp user  →  Meta Cloud API  →  POST /webhook  →  POST /api/chat (channel=whatsapp)
                                                              ↓
                                                        runAgent() → same LLM + tools + DB
                                                              ↓
                         reply text  ←  Meta send API  ←  AgentResult.message
```

On the `whatsapp` channel the agent behaves like voice: short prose replies, no UI
cards, and it can publish events after verbal confirmation via the `create_event` tool.

## Prerequisites

- Chiron backend running (`npm run dev:server` or deployed at `https://api.<yourdomain>`)
- [Meta developer account](https://developers.facebook.com/)
- WhatsApp Business app with the Cloud API product added
- A public HTTPS URL for webhooks (ngrok locally, Cloudflare in production)

## Quick start (local)

```bash
# Terminal 1 — backend (LLM + agent + events)
npm run dev:server

# Terminal 2 — WhatsApp webhook client
cp apps/whatsapp/.env.example apps/whatsapp/.env
# Fill in WHATSAPP_* values (see "Meta setup" below)
npm run dev:whatsapp

# Terminal 3 — expose the webhook (Meta requires HTTPS)
ngrok http 8788
```

Point Meta's webhook URL at `https://<ngrok-host>/webhook`.

### Test without Meta (backend only)

Verify the shared agent path the bot uses:

```bash
curl -XPOST http://localhost:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"channel":"whatsapp","messages":[{"role":"user","content":"find food bank events in Markham"}]}'
```

### Test the full bot loop locally (no Meta send)

With the WhatsApp service running, POST to `/test` — it runs session + agent logic
and returns the reply as JSON instead of sending via WhatsApp:

```bash
curl -XPOST http://localhost:8788/test \
  -H 'Content-Type: application/json' \
  -d '{"from":"15551234567","text":"find free events in Markham"}'
```

Send `"text":"start over"` to reset the in-memory session for that `from` number.

## Configuration

Copy `apps/whatsapp/.env.example` to `apps/whatsapp/.env`:

| Variable | Purpose |
| -------- | ------- |
| `PORT` | Webhook server port (default `8788`). |
| `CHIRON_API_URL` | Backend base URL (default `http://localhost:8787`). |
| `WHATSAPP_VERIFY_TOKEN` | Arbitrary string you choose; Meta sends it back during webhook verification. |
| `WHATSAPP_ACCESS_TOKEN` | Permanent token from Meta → WhatsApp → API Setup. |
| `WHATSAPP_PHONE_NUMBER_ID` | Numeric phone number ID from API Setup (not the display number). |
| `WHATSAPP_APP_SECRET` | App secret for `X-Hub-Signature-256` verification. Unset = skip (local dev only). |

The backend's LLM keys (`OPENAI_API_KEY`, `LOCAL_LLM_*`, etc.) stay in
`apps/server/.env` — the WhatsApp bot does not need them.

## Meta setup

1. Create an app at [developers.facebook.com](https://developers.facebook.com/) → **Business** type.
2. Add the **WhatsApp** product.
3. Under **WhatsApp → API Setup**, note the **Phone number ID** and generate a
   **Temporary access token** (or a permanent System User token for production).
4. Under **WhatsApp → Configuration**, set:
   - **Callback URL:** `https://<your-public-host>/webhook`
   - **Verify token:** same value as `WHATSAPP_VERIFY_TOKEN` in `.env`
   - Subscribe to the **messages** field.
5. Add your personal WhatsApp number as a test recipient (API Setup → "Send and receive messages").
6. Copy the **App secret** from App Settings → Basic into `WHATSAPP_APP_SECRET`.

Send a message from your phone to the test business number. You should get a reply
from Chiron within a few seconds.

## Session management

Conversation history is kept **in memory** per WhatsApp sender id (`wa_id`), capped
at 20 turns (matching the backend). Restarting the bot clears all sessions.

Users can reset with: `start over`, `reset`, `/reset`, `new chat`, or `clear`.

## Production deployment

Run the WhatsApp webhook service on a public HTTPS endpoint (separate from or
alongside the backend):

```
https://whatsapp.<yourdomain>/webhook  →  chiron-whatsapp :8788
https://api.<yourdomain>/api/chat      →  chiron-server :8787
```

Set `CHIRON_API_URL=https://api.<yourdomain>` in `apps/whatsapp/.env`.

The backend CORS settings do not affect server-to-server calls from this bot.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Webhook verification fails | Ensure `WHATSAPP_VERIFY_TOKEN` matches Meta's verify token exactly. |
| 401 on POST /webhook | Set `WHATSAPP_APP_SECRET` correctly, or unset it locally to skip verification. |
| No reply | Check `npm run dev:server` is running and `CHIRON_API_URL` is reachable. |
| "WhatsApp credentials missing" in logs | Fill in `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`. |
| Agent uses mock mode | Add `OPENAI_API_KEY` (or enable local LLM) in `apps/server/.env`. |

## Architecture note

This mirrors the VAPI voice adapter pattern: a thin transport layer calling the
shared agent. See [`docs/architecture.md`](./architecture.md) and [`docs/vapi.md`](./vapi.md).
