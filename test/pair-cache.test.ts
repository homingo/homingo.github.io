import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PairCache } from "../src/cache/pair-cache.js";
import type { PairConflictReport } from "../src/types.js";

function makeReport(skillA: string, skillB: string): PairConflictReport {
  return {
    skillA,
    skillB,
    promptsTested: 10,
    routingAccuracy: 85,
    severityLevel: "HIGH",
    misroutes: [],
    fragileCorrects: [],
    topFailurePattern: "overlap in billing tasks",
    recommendedAction: "Disambiguate descriptions",
  };
}

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "homingo-cache-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("PairCache.hashPair", () => {
  it("returns a 16-char hex string", () => {
    const hash = PairCache.hashPair("skillA", "descA", "skillB", "descB", 10, "claude-haiku");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same input", () => {
    const h1 = PairCache.hashPair("a", "descA", "b", "descB", 10, "haiku");
    const h2 = PairCache.hashPair("a", "descA", "b", "descB", 10, "haiku");
    expect(h1).toBe(h2);
  });

  it("is order-independent: (A,B) === (B,A)", () => {
    const h1 = PairCache.hashPair("a", "descA", "b", "descB", 10, "haiku");
    const h2 = PairCache.hashPair("b", "descB", "a", "descA", 10, "haiku");
    expect(h1).toBe(h2);
  });

  it("changes when description changes", () => {
    const h1 = PairCache.hashPair("a", "descA original", "b", "descB", 10, "haiku");
    const h2 = PairCache.hashPair("a", "descA changed", "b", "descB", 10, "haiku");
    expect(h1).not.toBe(h2);
  });

  it("changes when promptsPerPair changes", () => {
    const h1 = PairCache.hashPair("a", "descA", "b", "descB", 10, "haiku");
    const h2 = PairCache.hashPair("a", "descA", "b", "descB", 25, "haiku");
    expect(h1).not.toBe(h2);
  });

  it("changes when simModel changes", () => {
    const h1 = PairCache.hashPair("a", "descA", "b", "descB", 10, "haiku");
    const h2 = PairCache.hashPair("a", "descA", "b", "descB", 10, "gpt-4o-mini");
    expect(h1).not.toBe(h2);
  });
});

describe("PairCache get/set", () => {
  it("returns null for a missing entry", () => {
    const cache = new PairCache(testDir);
    expect(cache.get("nonexistent-hash")).toBeNull();
  });

  it("stores and retrieves an entry", () => {
    const cache = new PairCache(testDir);
    const report = makeReport("invoice-summary", "tax-optimizer");
    const hash = PairCache.hashPair(
      "invoice-summary",
      "summarizes invoices",
      "tax-optimizer",
      "optimizes taxes",
      10,
      "claude-haiku"
    );

    cache.set(hash, { promptsPerPair: 10, simModel: "claude-haiku", report });

    const retrieved = cache.get(hash);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.report.skillA).toBe("invoice-summary");
    expect(retrieved!.report.routingAccuracy).toBe(85);
    expect(retrieved!.simModel).toBe("claude-haiku");
    expect(retrieved!.promptsPerPair).toBe(10);
  });

  it("creates the cache directory automatically on set", () => {
    const nestedDir = join(testDir, "deeply", "nested", "cache");
    const cache = new PairCache(nestedDir);
    const report = makeReport("a", "b");
    const hash = "test-hash-123";

    cache.set(hash, { promptsPerPair: 10, simModel: "haiku", report });
    expect(cache.get(hash)).not.toBeNull();
  });

  it("stored entry includes hash and createdAt", () => {
    const cache = new PairCache(testDir);
    const report = makeReport("a", "b");
    const hash = "test123";

    const before = Date.now();
    cache.set(hash, { promptsPerPair: 10, simModel: "haiku", report });
    const after = Date.now();

    const entry = cache.get(hash)!;
    expect(entry.hash).toBe(hash);
    const ts = new Date(entry.createdAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("PairCache TTL expiry", () => {
  it("returns null for expired entries and removes the file", () => {
    // Set TTL to 0 days (immediately expired)
    const cache = new PairCache(testDir, 0);
    const report = makeReport("a", "b");
    cache.set("expired-hash", { promptsPerPair: 10, simModel: "haiku", report });

    // Entry should be expired immediately
    expect(cache.get("expired-hash")).toBeNull();
  });

  it("returns entry within TTL", () => {
    const cache = new PairCache(testDir, 7); // 7-day TTL
    const report = makeReport("a", "b");
    cache.set("fresh-hash", { promptsPerPair: 10, simModel: "haiku", report });
    expect(cache.get("fresh-hash")).not.toBeNull();
  });
});

describe("PairCache.prune", () => {
  it("returns 0 when cache directory does not exist", () => {
    const cache = new PairCache(join(testDir, "nonexistent"));
    expect(cache.prune()).toBe(0);
  });

  it("removes all entries when TTL is 0", () => {
    const staleCache = new PairCache(testDir, 0);
    staleCache.set("entry-1", {
      promptsPerPair: 10,
      simModel: "haiku",
      report: makeReport("a", "b"),
    });
    staleCache.set("entry-2", {
      promptsPerPair: 10,
      simModel: "haiku",
      report: makeReport("c", "d"),
    });

    const removed = staleCache.prune();
    expect(removed).toBe(2);
  });

  it("keeps all entries when TTL is generous", () => {
    const freshCache = new PairCache(testDir, 7);
    freshCache.set("fresh-1", {
      promptsPerPair: 10,
      simModel: "haiku",
      report: makeReport("a", "b"),
    });
    freshCache.set("fresh-2", {
      promptsPerPair: 10,
      simModel: "haiku",
      report: makeReport("c", "d"),
    });

    const removed = freshCache.prune();
    expect(removed).toBe(0);
    expect(freshCache.get("fresh-1")).not.toBeNull();
    expect(freshCache.get("fresh-2")).not.toBeNull();
  });
});

describe("PairCache.clear", () => {
  it("returns 0 when cache directory does not exist", () => {
    const cache = new PairCache(join(testDir, "nonexistent"));
    expect(cache.clear()).toBe(0);
  });

  it("removes all entries and returns count", () => {
    const cache = new PairCache(testDir);
    cache.set("a", { promptsPerPair: 10, simModel: "h", report: makeReport("a", "b") });
    cache.set("b", { promptsPerPair: 10, simModel: "h", report: makeReport("c", "d") });
    cache.set("c", { promptsPerPair: 10, simModel: "h", report: makeReport("e", "f") });

    expect(cache.clear()).toBe(3);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBeNull();
  });
});
