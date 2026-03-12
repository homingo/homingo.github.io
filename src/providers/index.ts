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

// ── Sim model auto-derivation ─────────────────────────────────

/**
 * Auto-derive a cheaper/faster model for routing simulation.
 * The sim model only needs to do simple classification, so we can
 * use a less capable but much cheaper model for those calls.
 */
export function getSimModel(primaryModel: string): string {
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

export type SimModelSource = "flag" | "config" | "auto" | "same";

export interface DualProviders {
  /** TrackedProvider for prompt generation, rewriting, shard analysis */
  primaryTracked: TrackedProvider;
  /** TrackedProvider for routing simulation (may be the same instance as primaryTracked) */
  simTracked: TrackedProvider;
  /** Effective model used for simulation */
  simModel: string;
  /** How the sim model was determined */
  simModelSource: SimModelSource;
  /** Combined token usage across both providers */
  combinedUsage(): TokenUsage;
  /** Combined call count across both providers */
  combinedCallCount(): number;
}

/**
 * Create primary + sim providers with automatic cheap-model derivation.
 *
 * Resolution order for sim model:
 *   "same"    → force primary model (no separate sim provider)
 *   override  → use the explicitly provided model string
 *   (auto)    → derive via getSimModel(primaryModel)
 *
 * If the auto-derived sim model needs an API key that isn't configured,
 * falls back to the primary model with a warning.
 */
export function createDualProviders(
  primaryModel: string,
  config: ProviderConfig,
  simModelOverride?: string
): DualProviders {
  const primaryInner = createProvider(primaryModel, config);
  const primaryTracked = new TrackedProvider(primaryInner);

  // Resolve effective sim model
  let simModel: string;
  let simModelSource: SimModelSource;

  if (simModelOverride === "same") {
    simModel = primaryModel;
    simModelSource = "same";
  } else if (simModelOverride) {
    simModel = simModelOverride;
    simModelSource = "flag";
  } else {
    simModel = getSimModel(primaryModel);
    simModelSource = simModel === primaryModel ? "same" : "auto";
  }

  // If sim model is the same as primary, share the TrackedProvider
  if (simModel === primaryModel) {
    return {
      primaryTracked,
      simTracked: primaryTracked,
      simModel,
      simModelSource,
      combinedUsage: () => ({ ...primaryTracked.totalUsage }),
      combinedCallCount: () => primaryTracked.callCount,
    };
  }

  // Different model — check if the required API key exists
  let simTracked: TrackedProvider;
  try {
    const simInner = createProvider(simModel, config);
    simTracked = new TrackedProvider(simInner);
  } catch {
    // Missing API key for the sim model — fall back to primary with a warning
    console.warn(
      chalk.yellow(
        `  Warning: sim model "${simModel}" requires a missing API key. Falling back to primary model.`
      )
    );
    simModel = primaryModel;
    simModelSource = "same";
    return {
      primaryTracked,
      simTracked: primaryTracked,
      simModel,
      simModelSource,
      combinedUsage: () => ({ ...primaryTracked.totalUsage }),
      combinedCallCount: () => primaryTracked.callCount,
    };
  }

  return {
    primaryTracked,
    simTracked,
    simModel,
    simModelSource,
    combinedUsage: () => ({
      inputTokens: primaryTracked.totalUsage.inputTokens + simTracked.totalUsage.inputTokens,
      outputTokens: primaryTracked.totalUsage.outputTokens + simTracked.totalUsage.outputTokens,
    }),
    combinedCallCount: () => primaryTracked.callCount + simTracked.callCount,
  };
}
