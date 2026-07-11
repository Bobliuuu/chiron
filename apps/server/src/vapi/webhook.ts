import type { Context } from "hono";
import { appendVoiceOntology } from "../data/profiles";
import { logVerbose } from "../log";
import { extractOntologyFromCall } from "../pipeline/voice-ontology";
import { consumePendingCall, peekPendingCall } from "./pending-calls";

interface VapiWebhookBody {
  message?: {
    type?: string;
    call?: { id?: string };
    artifact?: {
      transcript?: string;
      summary?: string;
      messages?: { role?: string; message?: string }[];
    };
    summary?: string;
    transcript?: string;
  };
}

/**
 * VAPI server URL webhook. Persists end-of-call transcripts into the caller's
 * voice ontology for demo user-matching flows.
 */
export async function handleVapiWebhook(c: Context): Promise<Response> {
  let body: VapiWebhookBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const type = body.message?.type;
  if (type !== "end-of-call-report") {
    return c.json({ ok: true });
  }

  const callId = body.message?.call?.id;
  if (!callId) {
    return c.json({ ok: true });
  }

  const pending = peekPendingCall(callId);
  if (!pending) {
    logVerbose("vapi", `webhook: no pending profile for call ${callId}`);
    return c.json({ ok: true });
  }

  const artifact = body.message?.artifact;
  const transcript =
    artifact?.transcript ??
    body.message?.transcript ??
    artifact?.messages
      ?.map((m) => `${m.role ?? "unknown"}: ${m.message ?? ""}`)
      .join("\n") ??
    null;
  const summary = artifact?.summary ?? body.message?.summary ?? null;

  const record = extractOntologyFromCall({
    callId,
    eventTitle: pending.eventTitle,
    transcript,
    summary,
  });

  await appendVoiceOntology(pending.profileId, record);
  consumePendingCall(callId);
  logVerbose(
    "vapi",
    `webhook: saved ontology for profile ${pending.profileId}`,
    `goals=${record.event_goals?.join(", ") ?? "-"}`,
  );

  return c.json({ ok: true });
}
