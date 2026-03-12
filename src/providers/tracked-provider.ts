import type { LLMProvider, LLMRequestOptions, LLMResponse, TokenUsage } from "./types.js";

/**
 * Wraps any LLMProvider, delegating all calls while accumulating
 * token usage and call count across the run.
 */
export class TrackedProvider implements LLMProvider {
  private inner: LLMProvider;
  private _totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private _callCount = 0;

  constructor(inner: LLMProvider) {
    this.inner = inner;
  }

  async createMessage(options: LLMRequestOptions): Promise<LLMResponse> {
    const response = await this.inner.createMessage(options);
    this._totalUsage.inputTokens += response.usage.inputTokens;
    this._totalUsage.outputTokens += response.usage.outputTokens;
    this._callCount++;
    return response;
  }

  get totalUsage(): TokenUsage {
    return { ...this._totalUsage };
  }

  get callCount(): number {
    return this._callCount;
  }
}
