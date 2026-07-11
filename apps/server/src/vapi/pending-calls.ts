import { env } from "../config";

/** Maps VAPI call id → profile to update when the call ends. */
const pendingByCallId = new Map<
  string,
  { profileId: string; eventTitle?: string }
>();

export function trackPendingCall(
  callId: string,
  profileId: string,
  eventTitle?: string,
): void {
  pendingByCallId.set(callId, { profileId, eventTitle });
}

export function consumePendingCall(
  callId: string,
): { profileId: string; eventTitle?: string } | null {
  const entry = pendingByCallId.get(callId);
  if (!entry) return null;
  pendingByCallId.delete(callId);
  return entry;
}

export function peekPendingCall(
  callId: string,
): { profileId: string; eventTitle?: string } | null {
  return pendingByCallId.get(callId) ?? null;
}
