import OpenAI from "openai";
import {
  env,
  hasLocalLlm,
  hasOpenAI,
  resolveLlmProvider,
} from "../config";

// A single LLM abstraction over any OpenAI-compatible endpoint. The hosted
// OpenAI API and local servers (llama.cpp's llama-server, Ollama, LM Studio)
// all speak the same chat-completions + tool-calling protocol, so the
// orchestrator uses one code path and just swaps the client + model name.

export interface LlmClient {
  client: OpenAI;
  model: string;
  provider: "openai" | "local";
}

// Cache one client per provider.
const cache: Partial<Record<"openai" | "local", LlmClient>> = {};

/**
 * Returns a client for the effective provider, or null when running in mock
 * mode (no key and no local server enabled).
 */
export function getLlmClient(): LlmClient | null {
  const provider = resolveLlmProvider();

  if (provider === "openai") {
    if (!hasOpenAI()) return null;
    if (!cache.openai) {
      cache.openai = {
        client: new OpenAI({ apiKey: env.openaiApiKey }),
        model: env.openaiModel,
        provider: "openai",
      };
    }
    return cache.openai;
  }

  if (provider === "local") {
    if (!hasLocalLlm()) return null;
    if (!cache.local) {
      cache.local = {
        client: new OpenAI({
          apiKey: env.localLlmApiKey,
          baseURL: env.localLlmBaseUrl,
        }),
        model: env.localLlmModel,
        provider: "local",
      };
    }
    return cache.local;
  }

  return null;
}
