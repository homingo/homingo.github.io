import type { LLMProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export type {
  LLMProvider,
  LLMRequestOptions,
  LLMMessage,
  LLMResponse,
  TokenUsage,
} from "./types.js";
export { TrackedProvider } from "./tracked-provider.js";

export type ProviderName = "anthropic" | "openai";

export interface ProviderConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

/**
 * Detect provider from model name.
 *   claude-*          → anthropic
 *   gpt-*, o1*, o3*, o4*  → openai
 */
export function detectProvider(model: string): ProviderName {
  const lower = model.toLowerCase();
  if (lower.startsWith("claude")) return "anthropic";
  if (lower.startsWith("gpt-")) return "openai";
  if (/^o[1-9]/.test(lower)) return "openai";

  throw new Error(
    `Unknown model "${model}". Supported prefixes: claude-* (Anthropic), gpt-*/o1/o3/o4 (OpenAI).\n` +
      `More providers coming soon.`
  );
}

/**
 * Create an LLMProvider for the given model.
 * Auto-detects provider from model name and selects the correct API key.
 */
export function createProvider(model: string, config: ProviderConfig): LLMProvider {
  const providerName = detectProvider(model);

  switch (providerName) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new Error(
          "Anthropic API key required for Claude models.\n" +
            "Run `homingo init` or set ANTHROPIC_API_KEY environment variable."
        );
      }
      return new AnthropicProvider(config.anthropicApiKey);
    }
    case "openai": {
      if (!config.openaiApiKey) {
        throw new Error(
          "OpenAI API key required for GPT/O-series models.\n" +
            "Run `homingo init` or set OPENAI_API_KEY environment variable."
        );
      }
      return new OpenAIProvider(config.openaiApiKey);
    }
  }
}
