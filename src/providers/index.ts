import chalk from "chalk";
import type { LLMProvider, TokenUsage } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { TrackedProvider } from "./tracked-provider.js";

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

// ── Cheap model auto-derivation ──────────────────────────────

/**
 * Auto-derive a cheaper/faster model for prompt generation (test data).
 * Prompt generation only needs to produce ambiguous test inputs, so we can
 * use a less capable but much cheaper model. The primary model is reserved
 * for routing simulation — the actual behavior we want to test.
 */
export function getCheapModel(primaryModel: string): string {
  const lower = primaryModel.toLowerCase();

  // Claude: sonnet/opus → haiku (5-10x cheaper)
  if (lower.startsWith("claude-sonnet") || lower.startsWith("claude-opus")) {
    return "claude-haiku-4-5-20251001";
  }
  // Claude haiku is already cheap — keep it
  if (lower.startsWith("claude-haiku")) return primaryModel;

  // OpenAI: gpt-4o → gpt-4o-mini
  if (lower === "gpt-4o" || lower.startsWith("gpt-4o-2")) return "gpt-4o-mini";
  // OpenAI o-series → gpt-4o-mini
  if (/^o[1-9]/.test(lower)) return "gpt-4o-mini";
  // Already cheap
  if (lower.startsWith("gpt-4o-mini")) return primaryModel;

  // Unknown model — keep the same (safe fallback)
  return primaryModel;
}

// ── Dual provider setup ───────────────────────────────────────

export type GenModelSource = "flag" | "config" | "auto" | "same";

export interface DualProviders {
  /** TrackedProvider for routing simulation — uses the primary (deployment) model */
  primaryTracked: TrackedProvider;
  /** TrackedProvider for prompt generation / test data (may be the same instance as primaryTracked) */
  genTracked: TrackedProvider;
  /** Effective model used for prompt generation */
  genModel: string;
  /** How the gen model was determined */
  genModelSource: GenModelSource;
  /** Combined token usage across both providers */
  combinedUsage(): TokenUsage;
  /** Combined call count across both providers */
  combinedCallCount(): number;
}

/**
 * Create primary + generation providers with automatic cheap-model derivation.
 *
 * The primary model is used for routing simulation (the behavior under test).
 * A cheaper model is auto-derived for prompt generation (test data creation).
 *
 * Resolution order for gen model:
 *   "same"    → force primary model (no separate gen provider)
 *   override  → use the explicitly provided model string
 *   (auto)    → derive via getCheapModel(primaryModel)
 *
 * If the auto-derived gen model needs an API key that isn't configured,
 * falls back to the primary model with a warning.
 */
export function createDualProviders(
  primaryModel: string,
  config: ProviderConfig,
  genModelOverride?: string
): DualProviders {
  const primaryInner = createProvider(primaryModel, config);
  const primaryTracked = new TrackedProvider(primaryInner);

  // Resolve effective gen model (cheaper model for prompt generation)
  let genModel: string;
  let genModelSource: GenModelSource;

  if (genModelOverride === "same") {
    genModel = primaryModel;
    genModelSource = "same";
  } else if (genModelOverride) {
    genModel = genModelOverride;
    genModelSource = "flag";
  } else {
    genModel = getCheapModel(primaryModel);
    genModelSource = genModel === primaryModel ? "same" : "auto";
  }

  // If gen model is the same as primary, share the TrackedProvider
  if (genModel === primaryModel) {
    return {
      primaryTracked,
      genTracked: primaryTracked,
      genModel,
      genModelSource,
      combinedUsage: () => ({ ...primaryTracked.totalUsage }),
      combinedCallCount: () => primaryTracked.callCount,
    };
  }

  // Different model — check if the required API key exists
  let genTracked: TrackedProvider;
  try {
    const genInner = createProvider(genModel, config);
    genTracked = new TrackedProvider(genInner);
  } catch {
    // Missing API key for the gen model — fall back to primary with a warning
    console.warn(
      chalk.yellow(
        `  Warning: gen model "${genModel}" requires a missing API key. Falling back to primary model.`
      )
    );
    genModel = primaryModel;
    genModelSource = "same";
    return {
      primaryTracked,
      genTracked: primaryTracked,
      genModel,
      genModelSource,
      combinedUsage: () => ({ ...primaryTracked.totalUsage }),
      combinedCallCount: () => primaryTracked.callCount,
    };
  }

  return {
    primaryTracked,
    genTracked,
    genModel,
    genModelSource,
    combinedUsage: () => ({
      inputTokens: primaryTracked.totalUsage.inputTokens + genTracked.totalUsage.inputTokens,
      outputTokens: primaryTracked.totalUsage.outputTokens + genTracked.totalUsage.outputTokens,
    }),
    combinedCallCount: () => primaryTracked.callCount + genTracked.callCount,
  };
}
