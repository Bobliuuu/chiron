import { env } from "../config";
import { logVerbose } from "../log";
import { trackPendingCall } from "./pending-calls";

export interface OrganizerCallInput {
  organizerName: string;
  organizerPhone: string;
  eventTitle: string;
  questions: string[];
  callerName?: string | null;
}

export interface OutboundCallInput {
  customerName: string;
  customerPhone: string;
  firstMessage: string;
  systemPrompt: string;
  assistantName: string;
  profileId?: string;
  eventTitle?: string;
  maxDurationSeconds?: number;
}

export interface OutboundCallResult {
  placed: boolean;
  callId?: string;
  mock?: boolean;
  error?: string;
}

/**
 * Place a VAPI outbound phone call. When credentials are missing, returns mock
 * success for local demos.
 */
export async function placeOutboundCall(
  input: OutboundCallInput,
): Promise<OutboundCallResult> {
  if (!env.vapiApiKey || !env.vapiPhoneNumberId) {
    const callId = `mock_${Date.now()}`;
    if (input.profileId) {
      trackPendingCall(callId, input.profileId, input.eventTitle);
    }
    logVerbose(
      "vapi",
      `mock outbound call to ${input.customerName} (${input.customerPhone})`,
    );
    return { placed: true, mock: true, callId };
  }

  const webhookConfig = env.vapiWebhookBaseUrl
    ? {
        serverUrl: `${env.vapiWebhookBaseUrl}/api/vapi/webhook`,
        serverMessages: ["end-of-call-report"],
      }
    : {};

  const body: Record<string, unknown> = {
    phoneNumberId: env.vapiPhoneNumberId,
    customer: {
      number: input.customerPhone,
      name: input.customerName,
      numberE164CheckEnabled: true,
    },
    // Always include provider when overriding model — VAPI rejects a bare
    // `{ messages }` object (and Custom LLM inbound assistants aren't valid
    // for outbound telephony anyway).
    assistantOverrides: {
      firstMessage: input.firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [{ role: "system", content: input.systemPrompt }],
      },
      maxDurationSeconds: input.maxDurationSeconds ?? 300,
      ...webhookConfig,
    },
  };

  if (env.vapiOutboundAssistantId) {
    body.assistantId = env.vapiOutboundAssistantId;
  } else {
    body.assistant = {
      name: input.assistantName,
      firstMessage: input.firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [{ role: "system", content: input.systemPrompt }],
      },
      voice: {
        provider: "11labs",
        voiceId: env.vapiVoiceId || "21m00Tcm4TlvDq8ikWAM",
      },
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
      },
      ...webhookConfig,
    };
  }

  try {
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.vapiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      return {
        placed: false,
        error: `VAPI call failed (${res.status}): ${detail.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { id?: string };
    const callId = data.id ?? `unknown_${Date.now()}`;
    if (input.profileId) {
      trackPendingCall(callId, input.profileId, input.eventTitle);
    }
    logVerbose("vapi", `outbound call placed id=${callId}`);
    return { placed: true, callId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Outbound call failed.";
    return { placed: false, error: message };
  }
}

/** Place an outbound call to an event organizer with the caller's questions. */
export async function callEventOrganizer(
  input: OrganizerCallInput,
): Promise<OutboundCallResult> {
  const { organizerName, organizerPhone, eventTitle, questions, callerName } =
    input;

  const questionList = questions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const caller = callerName?.trim() || "a community member";
  const firstMessage = `Hi ${organizerName.split(" ")[0]}, this is Chiron calling on behalf of ${caller}. They had a few questions about your event "${eventTitle}". Do you have a moment?`;
  const systemPrompt = `You are Chiron, calling an event organizer on behalf of a community member.

Event: "${eventTitle}"
Organizer: ${organizerName}
Caller: ${caller}

Your job:
1. Briefly introduce yourself and confirm they can talk.
2. Ask these questions one at a time, in order:
${questionList}
3. Listen carefully and repeat back key answers.
4. Thank them and end the call politely.

Keep it short and professional. Do not invent answers — only report what the organizer says.`;

  return placeOutboundCall({
    customerName: organizerName,
    customerPhone: organizerPhone,
    firstMessage,
    systemPrompt,
    assistantName: "Chiron Organizer Outreach",
  });
}
