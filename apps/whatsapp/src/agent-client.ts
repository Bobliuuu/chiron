import type { AgentRequest, AgentResult, ChatMessage } from "@chiron/shared";
import { env } from "./config";

/** POST the running conversation to the shared Chiron backend. */
export async function chat(messages: ChatMessage[]): Promise<AgentResult> {
  const url = `${env.chironApiUrl}/api/chat`;
  const body: AgentRequest = { channel: "whatsapp", messages };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[agent-client] fetch failed:", err);
    throw new Error("Could not reach the Chiron backend.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[agent-client] backend ${res.status}:`, text);
    throw new Error("The assistant hit an error. Please try again.");
  }

  return (await res.json()) as AgentResult;
}
