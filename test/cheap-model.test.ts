import { describe, it, expect, vi, afterEach } from "vitest";
import { getCheapModel, createDualProviders } from "../src/providers/index.js";

describe("getCheapModel", () => {
  it("maps claude-sonnet to claude-haiku", () => {
    expect(getCheapModel("claude-sonnet-4-20250514")).toBe("claude-haiku-4-5-20251001");
    expect(getCheapModel("claude-sonnet-3-5-20241022")).toBe("claude-haiku-4-5-20251001");
  });

  it("maps claude-opus to claude-haiku", () => {
    expect(getCheapModel("claude-opus-4-20250514")).toBe("claude-haiku-4-5-20251001");
    expect(getCheapModel("claude-opus-3-5-20240229")).toBe("claude-haiku-4-5-20251001");
  });

  it("returns same model for claude-haiku (already cheap)", () => {
    expect(getCheapModel("claude-haiku-35-20241022")).toBe("claude-haiku-35-20241022");
    expect(getCheapModel("claude-haiku-3-20240307")).toBe("claude-haiku-3-20240307");
  });

  it("maps gpt-4o to gpt-4o-mini", () => {
    expect(getCheapModel("gpt-4o")).toBe("gpt-4o-mini");
    expect(getCheapModel("gpt-4o-2024-11-20")).toBe("gpt-4o-mini");
  });

  it("maps o-series to gpt-4o-mini", () => {
    expect(getCheapModel("o1")).toBe("gpt-4o-mini");
    expect(getCheapModel("o1-mini")).toBe("gpt-4o-mini");
    expect(getCheapModel("o3-mini")).toBe("gpt-4o-mini");
    expect(getCheapModel("o4-mini")).toBe("gpt-4o-mini");
  });

  it("returns same model for gpt-4o-mini (already cheap)", () => {
    expect(getCheapModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(getCheapModel("gpt-4o-mini-2024-07-18")).toBe("gpt-4o-mini-2024-07-18");
  });

  it("returns same model for unknown models (safe fallback)", () => {
    expect(getCheapModel("some-future-model-xyz")).toBe("some-future-model-xyz");
    expect(getCheapModel("gemini-pro")).toBe("gemini-pro");
  });

  it("is case-insensitive", () => {
    expect(getCheapModel("Claude-Sonnet-4-20250514")).toBe("claude-haiku-4-5-20251001");
    expect(getCheapModel("GPT-4o")).toBe("gpt-4o-mini");
  });
});

describe("createDualProviders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const anthropicConfig = { anthropicApiKey: "sk-ant-test" };
  const dualConfig = { anthropicApiKey: "sk-ant-test", openaiApiKey: "sk-openai-test" };

  it("returns auto-derived gen model when no override", () => {
    const dual = createDualProviders("claude-sonnet-4-20250514", anthropicConfig);
    expect(dual.genModel).toBe("claude-haiku-4-5-20251001");
    expect(dual.genModelSource).toBe("auto");
  });

  it("uses override when genModelOverride is provided", () => {
    const dual = createDualProviders(
      "claude-sonnet-4-20250514",
      anthropicConfig,
      "claude-haiku-3-20240307"
    );
    expect(dual.genModel).toBe("claude-haiku-3-20240307");
    expect(dual.genModelSource).toBe("flag");
  });

  it("treats 'same' override as same-model instruction", () => {
    const dual = createDualProviders("claude-sonnet-4-20250514", anthropicConfig, "same");
    expect(dual.genModel).toBe("claude-sonnet-4-20250514");
    expect(dual.genModelSource).toBe("same");
  });

  it("shares one TrackedProvider when gen model equals primary", () => {
    // haiku → haiku, both same
    const dual = createDualProviders("claude-haiku-35-20241022", anthropicConfig);
    expect(dual.genModel).toBe("claude-haiku-35-20241022");
    expect(dual.genModelSource).toBe("same");
    expect(dual.primaryTracked).toBe(dual.genTracked); // same reference
  });

  it("uses separate TrackedProviders for different models", () => {
    const dual = createDualProviders("claude-sonnet-4-20250514", anthropicConfig);
    expect(dual.primaryTracked).not.toBe(dual.genTracked);
  });

  it("combinedUsage() sums both providers", () => {
    const dual = createDualProviders("claude-sonnet-4-20250514", anthropicConfig);
    const usage = dual.combinedUsage();
    expect(usage).toHaveProperty("inputTokens");
    expect(usage).toHaveProperty("outputTokens");
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  it("falls back to primary when gen provider key is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Primary is Claude (anthropic key ✓), gen override is gpt-4o-mini (openai key ✗)
    // → should fall back to primary with a warning
    const dual = createDualProviders(
      "claude-sonnet-4-20250514",
      anthropicConfig, // only anthropic key, no openai key
      "gpt-4o-mini" // would need openai key
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Falling back"));
    expect(dual.genModel).toBe("claude-sonnet-4-20250514"); // fell back to primary
    expect(dual.genModelSource).toBe("same");
    expect(dual.primaryTracked).toBe(dual.genTracked); // same instance
    vi.restoreAllMocks();
  });

  it("cross-provider dual setup works when both keys present", () => {
    // claude primary + gpt-4o-mini gen
    const dual = createDualProviders("claude-sonnet-4-20250514", dualConfig, "gpt-4o-mini");
    expect(dual.genModel).toBe("gpt-4o-mini");
    expect(dual.genModelSource).toBe("flag");
    expect(dual.primaryTracked).not.toBe(dual.genTracked);
  });
});
