import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { dbMode } from "@/lib/config";
import { getLlmClient, type LlmClient } from "@/lib/agent/llm";
import { systemPrompt } from "@/lib/agent/prompts";
import { toolDefinitions, executeTool } from "@/lib/agent/tools";
import { planWithoutLLM } from "@/lib/agent/mock-planner";
import type {
  AgentResult,
  ChatMessage,
  UiAction,
} from "@/lib/agent/types";

const MAX_TOOL_ROUNDS = 4;

/**
 * The orchestrator. Given the running chat, it drives an OpenAI-compatible
 * tool-calling loop against whichever provider is active (hosted OpenAI or a
 * local model), and falls back to a deterministic rule-based planner when no
 * model is configured OR when a live model call fails. All paths converge on
 * the same AgentResult contract.
 */
export async function runAgent(history: ChatMessage[]): Promise<AgentResult> {
  const llm = getLlmClient();

  if (!llm) return mockResult(history);

  try {
    return await runWithModel(llm, history);
  } catch (err) {
    console.error(
      `[agent] ${llm.provider} model call failed — falling back to mock planner:`,
      err,
    );
    return mockResult(history);
  }
}

async function runWithModel(
  llm: LlmClient,
  history: ChatMessage[],
): Promise<AgentResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(new Date()) },
    ...history.map(
      (m): ChatCompletionMessageParam => ({ role: m.role, content: m.content }),
    ),
  ];

  const actions: UiAction[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await llm.client.chat.completions.create({
      model: llm.model,
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
      temperature: 0.3,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) break;

    // No tool calls → final answer.
    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return {
        message: choice.content ?? "",
        actions,
        mode: { llm: llm.provider, db: dbMode() },
      };
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

  return {
    message: closing.choices[0]?.message?.content ?? "Here's what I found.",
    actions,
    mode: { llm: llm.provider, db: dbMode() },
  };
}

async function mockResult(history: ChatMessage[]): Promise<AgentResult> {
  const { message, actions } = await planWithoutLLM(history);
  return { message, actions, mode: { llm: "mock", db: dbMode() } };
}
