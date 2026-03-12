import { describe, it, expect } from "vitest";
import { detectProvider, createProvider } from "../src/providers/index.js";

describe("detectProvider", () => {
  it("maps claude-* models to anthropic", () => {
    expect(detectProvider("claude-sonnet-4-20250514")).toBe("anthropic");
    expect(detectProvider("claude-haiku-35-20241022")).toBe("anthropic");
    expect(detectProvider("claude-opus-4-20250514")).toBe("anthropic");
  });

  it("maps gpt-* models to openai", () => {
    expect(detectProvider("gpt-4o")).toBe("openai");
    expect(detectProvider("gpt-4o-mini")).toBe("openai");
    expect(detectProvider("gpt-3.5-turbo")).toBe("openai");
  });

  it("maps o-series models to openai", () => {
    expect(detectProvider("o1")).toBe("openai");
    expect(detectProvider("o1-mini")).toBe("openai");
    expect(detectProvider("o3-mini")).toBe("openai");
    expect(detectProvider("o4-mini")).toBe("openai");
  });

  it("is case-insensitive", () => {
    expect(detectProvider("Claude-Sonnet-4-20250514")).toBe("anthropic");
    expect(detectProvider("GPT-4o")).toBe("openai");
  });

  it("throws on unknown models with helpful message", () => {
    expect(() => detectProvider("gemini-pro")).toThrow("Unknown model");
    expect(() => detectProvider("gemini-pro")).toThrow("More providers coming soon");
    expect(() => detectProvider("llama-3")).toThrow("Unknown model");
  });
});

describe("createProvider", () => {
  it("throws when anthropic key is missing for claude model", () => {
    expect(() => createProvider("claude-sonnet-4-20250514", {})).toThrow(
      "Anthropic API key required"
    );
  });

  it("throws when openai key is missing for gpt model", () => {
    expect(() => createProvider("gpt-4o", {})).toThrow("OpenAI API key required");
  });

  it("creates provider when correct key is present", () => {
    const anthropicProvider = createProvider("claude-sonnet-4-20250514", {
      anthropicApiKey: "sk-ant-test-key",
    });
    expect(anthropicProvider).toBeDefined();
    expect(anthropicProvider.createMessage).toBeTypeOf("function");

    const openaiProvider = createProvider("gpt-4o", {
      openaiApiKey: "sk-test-key",
    });
    expect(openaiProvider).toBeDefined();
    expect(openaiProvider.createMessage).toBeTypeOf("function");
  });

  it("does not require the other key when only one provider is used", () => {
    // Using Anthropic model — should not need OpenAI key
    expect(() =>
      createProvider("claude-sonnet-4-20250514", { anthropicApiKey: "sk-ant-test" })
    ).not.toThrow();

    // Using OpenAI model — should not need Anthropic key
    expect(() => createProvider("gpt-4o", { openaiApiKey: "sk-test" })).not.toThrow();
  });
});
