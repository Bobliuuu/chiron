import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  capabilitiesFor,
  type AgentProfile,
  type AgentRequest,
  type AgentResult,
  type Channel,
  type ChannelCapabilities,
  type ChatMessage,
  type UiAction,
} from "@chiron/shared";
import { dbMode } from "../config";
import { getLlmClient, type LlmClient } from "./llm";
import { systemPrompt } from "./prompts";
import { toolsFor, executeTool } from "./tools";
import { planWithoutLLM } from "./mock-planner";

const MAX_TOOL_ROUNDS = 4;

/**
 * The orchestrator. Given the running chat AND the channel it came from, it
 * drives an OpenAI-compatible tool-calling loop against whichever provider is
 * active (hosted OpenAI or a local model), and falls back to a deterministic
 * rule-based planner when no model is configured OR when a live model call
 * fails. All paths converge on the same AgentResult contract.
 *
 * The channel decides how the agent behaves:
 *   - web (rich UI): offers draft_event and surfaces cards + the creation form.
 *   - voice/whatsapp/email (prose-only): no structured UI — the agent asks
 *     questions and describes results in words; UI actions are dropped.
 */
export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const caps = capabilitiesFor(req.channel);
  const llm = getLlmClient();

  if (!llm) return mockResult(req.messages, req.channel, caps, req.profile);

  try {
    return await runWithModel(llm, req.messages, req.channel, caps, req.profile);
  } catch (err) {
    console.error(
      `[agent] ${llm.provider} model call failed — falling back to mock planner:`,
      err,
    );
    return mockResult(req.messages, req.channel, caps, req.profile);
  }
}

async function runWithModel(
  llm: LlmClient,
  history: ChatMessage[],
  channel: Channel,
  caps: ChannelCapabilities,
  profile?: AgentProfile | null,
): Promise<AgentResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(new Date(), caps, profile) },
    ...history.map(
      (m): ChatCompletionMessageParam => ({ role: m.role, content: m.content }),
    ),
  ];

  const tools = toolsFor(caps);
  const actions: UiAction[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await llm.client.chat.completions.create({
      model: llm.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) break;

    // No tool calls → final answer.
    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return finalize(choice.content ?? "", actions, llm.provider, channel, caps);
    }

    // Record the assistant's tool-call turn, then execute each call.
    messages.push(choice as ChatCompletionMessageParam);
    for (const call of choice.tool_calls) {
      if (call.type !== "function") continue;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
      } catch {
        parsedArgs = {};
      }

      const outcome = await executeTool(call.function.name, parsedArgs);
      actions.push(...outcome.actions);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: outcome.forModel,
      });
    }
  }

  // Ran out of tool rounds — ask the model for a closing summary with tools off.
  const closing = await llm.client.chat.completions.create({
    model: llm.model,
    messages,
    temperature: 0.3,
  });

  return finalize(
    closing.choices[0]?.message?.content ?? "Here's what I found.",
    actions,
    llm.provider,
    channel,
    caps,
  );
}

async function mockResult(
  history: ChatMessage[],
  channel: Channel,
  caps: ChannelCapabilities,
  profile?: AgentProfile | null,
): Promise<AgentResult> {
  const { message, actions } = await planWithoutLLM(history, caps, profile);
  return finalize(message, actions, "mock", channel, caps);
}

/**
 * Assemble the final result. On prose-only channels we drop UI actions entirely
 * — those frontends consume only `message`.
 */
function finalize(
  message: string,
  actions: UiAction[],
  llm: "openai" | "local" | "mock",
  channel: Channel,
  caps: ChannelCapabilities,
): AgentResult {
  return {
    message,
    actions: caps.richUi ? actions : [],
    mode: { llm, db: dbMode(), channel },
  };
}
