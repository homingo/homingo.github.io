import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequestOptions, LLMResponse } from "./types.js";
import { withRetry } from "../utils/retry.js";

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async createMessage(options: LLMRequestOptions): Promise<LLMResponse> {
    const messages = options.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const response = await withRetry(() =>
      this.client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens,
        messages,
        ...(options.system ? { system: options.system } : {}),
      })
    );

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
