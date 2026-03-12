import OpenAI from "openai";
import type { LLMProvider, LLMRequestOptions, LLMResponse } from "./types.js";
import { withRetry } from "../utils/retry.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async createMessage(options: LLMRequestOptions): Promise<LLMResponse> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

    // Prepend system message if provided
    if (options.system) {
      messages.push({ role: "system", content: options.system });
    }

    for (const msg of options.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const response = await withRetry(() =>
      this.client.chat.completions.create({
        model: options.model,
        max_tokens: options.maxTokens,
        messages,
      })
    );

    const text = response.choices[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
