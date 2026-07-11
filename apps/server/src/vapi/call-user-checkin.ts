import type { EventRecord } from "@chiron/shared";
import { placeOutboundCall, type OutboundCallResult } from "./outbound";

export interface UserEventCheckinInput {
  userName: string;
  userPhone: string;
  profileId: string;
  event: Pick<EventRecord, "title" | "start_time" | "city">;
}

/**
 * Outbound check-in: call a community member before an event and learn what
 * they want to get out of it (saved to their voice ontology after the call).
 */
export async function callUserEventCheckin(
  input: UserEventCheckinInput,
): Promise<OutboundCallResult> {
  const when = new Date(input.event.start_time).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const where = input.event.city ? ` in ${input.event.city}` : "";
  const firstName = input.userName.split(" ")[0];

  const firstMessage = `Hi ${firstName}, this is Chiron. Your event "${input.event.title}" is coming up on ${when}${where}. Do you have a quick moment?`;
  const systemPrompt = `You are Chiron, a friendly community assistant calling ${input.userName} before an upcoming event.

Event: "${input.event.title}"
When: ${when}${where}

Your job:
1. Confirm they can talk briefly.
2. Tell them the event is coming up soon.
3. Ask what they want to get out of this event — what they're hoping for, what would make it worthwhile for them.
4. Ask one follow-up if their answer is vague (e.g. "anything else you're hoping for?").
5. Thank them warmly and end the call.

Keep it conversational and short (under 3 minutes). Do not pitch other events. Listen more than you talk.`;

  return placeOutboundCall({
    customerName: input.userName,
    customerPhone: input.userPhone,
    firstMessage,
    systemPrompt,
    assistantName: "Chiron Event Check-in",
    profileId: input.profileId,
    eventTitle: input.event.title,
    maxDurationSeconds: 240,
  });
}
