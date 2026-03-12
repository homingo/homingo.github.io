import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable errors and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("429 rate limited")).mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on status code errors", async () => {
    const error = Object.assign(new Error("API error"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("invalid input"));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow("invalid input");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("429 rate limited"));
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow(
      "429 rate limited"
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries on network errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on 500 server errors", async () => {
    const error = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
  });

  it("retries on 503 errors", async () => {
    const error = Object.assign(new Error("Service Unavailable"), { status: 503 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
  });

  it("retries on overloaded errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("API is overloaded"))
      .mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
  });

  it("respects Retry-After header from error object", async () => {
    const error = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { "retry-after": "2" },
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const start = Date.now();
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    // Should wait at least 2000ms (Retry-After: 2 seconds)
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  });

  it("respects retry-after-ms header", async () => {
    const error = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { "retry-after-ms": "500" },
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const start = Date.now();
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    // Should wait at least 500ms
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });

  it("respects Retry-After from Headers object with .get()", async () => {
    const headers = new Map([["retry-after", "1"]]);
    const error = Object.assign(new Error("rate limited"), {
      status: 429,
      headers: { get: (key: string) => headers.get(key) ?? null },
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const start = Date.now();
    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    const elapsed = Date.now() - start;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it("falls back to exponential backoff when no Retry-After header", async () => {
    const error = Object.assign(new Error("rate limited"), { status: 429 });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    // No Retry-After → uses exponential backoff (very short with baseDelayMs: 1)
  });
});
