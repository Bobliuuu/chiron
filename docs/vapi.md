# VAPI voice agent

Chiron's phone agent uses [VAPI](https://vapi.ai) for telephony (speech-to-text,
text-to-speech, call handling) and the Chiron backend for intelligence (search,
recommend, create events).

```
Caller  →  VAPI phone number  →  POST /v1/chat/completions  →  runAgent(voice)
                                                                    ↓
                                                              Supabase / mock DB
```

VAPI sends OpenAI-compatible chat completion requests. The backend runs the same
channel-aware agent as the web app, with `channel: "voice"` — short spoken
replies, no UI cards, and a `create_event` tool that publishes after verbal
confirmation.

## Prerequisites

- Chiron backend running (`npm run dev:server` or deployed at `https://api.<yourdomain>`)
- VAPI account with a phone number
- `OPENAI_API_KEY` (or local LLM) for real agent behavior
- `SUPABASE_*` env vars if events should persist beyond the in-memory mock store

## Backend configuration

Add to `apps/server/.env`:

```bash
# Required in production — VAPI sends this as Authorization: Bearer ...
VAPI_LLM_API_KEY=your-secret-token-here

# Optional — defaults to true
VAPI_ENABLED=true
```

| Variable | Purpose |
| -------- | ------- |
| `VAPI_LLM_API_KEY` | Bearer token validated on `POST /v1/chat/completions`. When unset, auth is skipped (local dev only). |
| `VAPI_ENABLED` | Set to `false` to disable the VAPI route entirely. |

## Local development with ngrok

VAPI needs a public HTTPS URL to reach your machine.

```bash
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — tunnel
ngrok http 8787
```

Note the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app`).

### Smoke-test the adapter (no phone)

```bash
export VAPI_LLM_API_KEY=test-key   # optional locally

curl -XPOST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "model": "chiron-voice",
    "messages": [{"role": "user", "content": "find free food bank events in Markham"}]
  }'
```

Expected: JSON with `choices[0].message.content` containing a spoken-friendly reply.

Test event creation flow:

```bash
# Turn 1 — describe event
curl -s -XPOST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chiron-voice",
    "messages": [{"role": "user", "content": "I want to publish a food bank fundraiser in Markham on June 20th"}]
  }' | jq -r '.choices[0].message.content'

# Turn 2 — confirm (include prior turns in messages[])
curl -s -XPOST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chiron-voice",
    "messages": [
      {"role": "user", "content": "I want to publish a food bank fundraiser in Markham on June 20th"},
      {"role": "assistant", "content": "Here is what I have... Should I publish this now?"},
      {"role": "user", "content": "Yes, publish it"}
    ]
  }' | jq -r '.choices[0].message.content'
```

## VAPI dashboard setup

Complete these steps in the [VAPI dashboard](https://dashboard.vapi.ai).

### 1. Create a Custom LLM credential

1. Go to **Settings → Integrations → Custom LLM**
2. **URL:** your backend base + `/v1`
   - Local dev: `https://<ngrok-id>.ngrok-free.app/v1`
   - Production: `https://api.<yourdomain>/v1`
3. **Authentication:** API Key
4. **API Key:** same value as `VAPI_LLM_API_KEY` in your backend `.env`

### 2. Create the assistant

Use the dashboard UI or import the reference config at
[`infra/vapi/assistant.json`](../infra/vapi/assistant.json).

Key settings:

| Setting | Value |
| ------- | ----- |
| Model provider | Custom LLM (your credential) |
| Model name | `chiron-voice` (arbitrary label) |
| System prompt | Leave empty or minimal — Chiron injects its own system prompt |
| First message | `Hi, I'm Chiron. I can help you find community events or publish a new one. What can I do for you?` |
| Voice | Your preferred TTS (e.g. ElevenLabs) |
| Transcriber | Your preferred STT (e.g. Deepgram) |
| Streaming | Off (non-streaming only for now) |

Example assistant payload (PATCH `/assistant/{id}` via VAPI API):

```json
{
  "name": "Chiron Voice",
  "firstMessage": "Hi, I'm Chiron. I can help you find community events or publish a new one. What can I do for you?",
  "model": {
    "provider": "custom-llm",
    "url": "https://api.<yourdomain>/v1",
    "model": "chiron-voice",
    "temperature": 0.3,
    "messages": []
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "<your-voice-id>"
  },
  "transcriber": {
    "provider": "deepgram",
    "model": "nova-2",
    "language": "en"
  }
}
```

Replace `url` with your Custom LLM credential URL if configured via credential ID
instead of inline URL.

### 3. Attach your phone number

1. Go to **Phone Numbers** in the VAPI dashboard
2. Select your existing number
3. Set **Assistant** to the Chiron assistant you created
4. Save

### 4. Test call flows

| Scenario | What to say | Expected behavior |
| -------- | ----------- | ----------------- |
| Search | "What food bank events are in Markham?" | Agent searches and reads back up to 3 matches |
| Recommend | "Suggest something free for seniors this weekend" | Agent recommends upcoming events |
| Create | "I want to publish a fundraiser on June 20th at 6pm in Markham" | Agent collects missing fields, reads back summary, asks to confirm |
| Confirm | "Yes, publish it" | Agent calls `create_event` and confirms title + date |

## Production checklist

- [ ] Backend deployed with public HTTPS ([deploy.md](./deploy.md))
- [ ] `VAPI_LLM_API_KEY` set in production env (never leave auth open in prod)
- [ ] `OPENAI_API_KEY` and `SUPABASE_*` configured
- [ ] VAPI Custom LLM credential points to `https://api.<yourdomain>/v1`
- [ ] Phone number linked to Chiron assistant
- [ ] Test call: search + create + confirm

## Architecture notes

- **Single agent brain:** VAPI handles audio; Chiron handles tools, prompts, and DB.
- **Confirmation gate:** `create_event` rejects unless `confirmed: true`, forcing the LLM to get explicit verbal agreement before publishing.
- **Latency:** Tool-calling may take a few seconds per turn. Keep assistant `responseDelay` reasonable; SSE streaming is planned for a future iteration.
- **Message history:** VAPI sends the full transcript each turn; the backend keeps the last 20 user/assistant messages.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| 401 from backend | Check `VAPI_LLM_API_KEY` matches the credential in VAPI dashboard |
| 501 streaming error | Disable streaming on the VAPI assistant |
| Agent says it can't publish | Ensure you're on voice channel (Custom LLM route always uses `voice`) and caller confirmed with "yes" |
| Events don't persist | Configure `SUPABASE_URL` + keys in backend env |
| Slow responses | Normal during tool calls; consider shorter first message and gpt-4o-mini |
