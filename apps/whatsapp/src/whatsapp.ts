import { env } from "./config";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const MAX_MESSAGE_LENGTH = 4096;

/** Split a long reply into WhatsApp-sized chunks. */
export function splitMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen / 2) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Send a text reply to a WhatsApp user via the Meta Cloud API. */
export async function sendText(to: string, text: string): Promise<void> {
  if (!env.accessToken || !env.phoneNumberId) {
    throw new Error("WhatsApp credentials are not configured.");
  }

  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    const res = await fetch(`${GRAPH_API}/${env.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: chunk },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[whatsapp] send failed ${res.status}:`, errBody);
      throw new Error("Failed to send WhatsApp message.");
    }
  }
}

/** Mark an inbound message as read (best-effort). */
export async function markRead(messageId: string): Promise<void> {
  if (!env.accessToken || !env.phoneNumberId) return;

  try {
    await fetch(`${GRAPH_API}/${env.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (err) {
    console.warn("[whatsapp] markRead failed:", err);
  }
}
