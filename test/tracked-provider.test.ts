import { describe, it, expect } from "vitest";
import { TrackedProvider } from "../src/providers/tracked-provider.js";
import type { LLMProvider, LLMResponse } from "../src/providers/types.js";

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    createMessage: async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    },
  };
}

const defaultResponse: LLMResponse = {
  text: "hello",
  usage: { inputTokens: 100, outputTokens: 50 },
};

describe("TrackedProvider", () => {
  it("delegates createMessage to inner provider", async () => {
    const inner = mockProvider([defaultResponse]);
    const tracked = new TrackedProvider(inner);

    const result = await tracked.createMessage({
      model: "test",
      maxTokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.text).toBe("hello");
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it("starts with zero usage and zero call count", () => {
    const inner = mockProvider([defaultResponse]);
    const tracked = new TrackedProvider(inner);

    expect(tracked.totalUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(tracked.callCount).toBe(0);
  });

  it("accumulates usage across multiple calls", async () => {
    const inner = mockProvider([
      { text: "a", usage: { inputTokens: 100, outputTokens: 50 } },
      { text: "b", usage: { inputTokens: 200, outputTokens: 75 } },
      { text: "c", usage: { inputTokens: 150, outputTokens: 60 } },
    ]);
    const tracked = new TrackedProvider(inner);

    await tracked.createMessage({
      model: "t",
      maxTokens: 10,
      messages: [{ role: "user", content: "1" }],
    });
    await tracked.createMessage({
      model: "t",
      maxTokens: 10,
      messages: [{ role: "user", content: "2" }],
    });
    await tracked.createMessage({
      model: "t",
      maxTokens: 10,
      messages: [{ role: "user", content: "3" }],
    });

    expect(tracked.totalUsage).toEqual({ inputTokens: 450, outputTokens: 185 });
    expect(tracked.callCount).toBe(3);
  });

  it("returns a copy of totalUsage (not a reference)", async () => {
    const inner = mockProvider([defaultResponse]);
    const tracked = new TrackedProvider(inner);

    await tracked.createMessage({
      model: "t",
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });

    const usage1 = tracked.totalUsage;
    const usage2 = tracked.totalUsage;
    expect(usage1).toEqual(usage2);
    expect(usage1).not.toBe(usage2); // different object references
  });

  it("propagates errors from inner provider", async () => {
    const inner: LLMProvider = {
      createMessage: async () => {
        throw new Error("API rate limit");
      },
    };
    const tracked = new TrackedProvider(inner);

    await expect(
      tracked.createMessage({
        model: "t",
        maxTokens: 10,
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow("API rate limit");

    // Failed calls should NOT increment usage
    expect(tracked.totalUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(tracked.callCount).toBe(0);
  });
});
