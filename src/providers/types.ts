export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  model: string;
  maxTokens: number;
  messages: LLMMessage[];
  /** System prompt — Anthropic maps to separate param; OpenAI prepends as system message. */
  system?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  text: string;
  usage: TokenUsage;
}

export interface LLMProvider {
  createMessage(options: LLMRequestOptions): Promise<LLMResponse>;
}
