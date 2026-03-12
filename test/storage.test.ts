import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { saveRun, enforceRetention } from "../src/reporting/storage.js";
import type { RunMetadata } from "../src/reporting/run-metadata.js";

function makeMeta(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs: 1234,
    command: "audit",
    args: {},
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    skillCount: 10,
    tokens: { input: 100, output: 50, total: 150 },
    gitCommitHash: "abc1234",
    result: {
      type: "audit",
      fleetErrorRate: 5.2,
      pairsTested: 8,
      criticalCount: 1,
      highCount: 2,
      mediumCount: 3,
      lowCount: 2,
    },
    ...overrides,
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `homingo-storage-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeAuditData() {
  return {
    generatedAt: new Date().toISOString(),
    modelUsed: "claude-sonnet-4-20250514",
    totalSkills: 10,
    totalPairsTested: 8,
    estimatedFleetErrorRate: 5.2,
    criticalPairs: [],
    highPairs: [],
    mediumPairs: [],
    lowPairs: [],
    topFiveOffenders: [],
    exportPath: "",
  };
}

function makeLintData() {
  return {
    failingReports: [],
    passingCount: 5,
    rewriteSuggestions: [],
    shardFindings: [],
  };
}

describe("saveRun", () => {
  it("creates JSON and HTML files in command subdirectory", () => {
    const meta = makeMeta();
    const data = makeAuditData();

    const stored = saveRun("audit", meta, data, testDir);

    expect(existsSync(stored.metadataPath)).toBe(true);
    expect(existsSync(stored.htmlPath)).toBe(true);
    expect(stored.metadataPath).toContain("/audit/");
    expect(stored.htmlPath).toContain("/audit/");
    expect(stored.metadataPath).toMatch(/\.json$/);
    expect(stored.htmlPath).toMatch(/\.html$/);
  });

  it("creates directory structure if it doesn't exist", () => {
    const meta = makeMeta({ command: "lint" });
    const nestedDir = join(testDir, "nested", "reports");

    const stored = saveRun("lint", meta, makeLintData(), nestedDir);

    expect(existsSync(stored.metadataPath)).toBe(true);
    expect(stored.metadataPath).toContain("/lint/");
  });

  it("writes valid JSON metadata", () => {
    const meta = makeMeta();
    const data = makeAuditData();

    const stored = saveRun("audit", meta, data, testDir);

    const raw = readFileSync(stored.metadataPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.metadata.id).toBe(meta.id);
    expect(parsed.data.estimatedFleetErrorRate).toBe(5.2);
  });

  it("writes valid HTML with command-specific content", () => {
    const meta = makeMeta();
    const data = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 10,
      totalPairsTested: 8,
      estimatedFleetErrorRate: 5.2,
      criticalPairs: [],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: [],
      exportPath: "",
    };

    const stored = saveRun("audit", meta, data, testDir);

    const html = readFileSync(stored.htmlPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Homingo Audit Report");
    expect(html).toContain("5.2%");
  });
});

describe("enforceRetention", () => {
  it("does nothing when under the limit", () => {
    const dir = join(testDir, "audit");
    mkdirSync(dir, { recursive: true });

    // Create 3 files
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(dir, `run-${i}.json`), "{}");
      writeFileSync(join(dir, `run-${i}.html`), "<html></html>");
    }

    enforceRetention(dir, 10);

    const files = readdirSync(dir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(3);
  });

  it("removes oldest files when over the limit", () => {
    const dir = join(testDir, "audit");
    mkdirSync(dir, { recursive: true });

    // Create 5 timestamped files
    const names = [
      "2026-01-01T00-00-00Z-aaa",
      "2026-01-02T00-00-00Z-bbb",
      "2026-01-03T00-00-00Z-ccc",
      "2026-01-04T00-00-00Z-ddd",
      "2026-01-05T00-00-00Z-eee",
    ];
    for (const name of names) {
      writeFileSync(join(dir, `${name}.json`), "{}");
      writeFileSync(join(dir, `${name}.html`), "<html></html>");
    }

    enforceRetention(dir, 3);

    const remaining = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(3);
    // Should keep the 3 newest
    expect(remaining).toContain("2026-01-03T00-00-00Z-ccc.json");
    expect(remaining).toContain("2026-01-04T00-00-00Z-ddd.json");
    expect(remaining).toContain("2026-01-05T00-00-00Z-eee.json");
    // Should have removed the 2 oldest
    expect(remaining).not.toContain("2026-01-01T00-00-00Z-aaa.json");
    expect(remaining).not.toContain("2026-01-02T00-00-00Z-bbb.json");
  });

  it("removes matching HTML files when removing JSON files", () => {
    const dir = join(testDir, "audit");
    mkdirSync(dir, { recursive: true });

    // "2026-01" sorts before "2026-02" — older is removed
    writeFileSync(join(dir, "2026-01-01T00-00-00Z-aaa.json"), "{}");
    writeFileSync(join(dir, "2026-01-01T00-00-00Z-aaa.html"), "<html></html>");
    writeFileSync(join(dir, "2026-02-01T00-00-00Z-bbb.json"), "{}");
    writeFileSync(join(dir, "2026-02-01T00-00-00Z-bbb.html"), "<html></html>");

    enforceRetention(dir, 1);

    expect(existsSync(join(dir, "2026-01-01T00-00-00Z-aaa.json"))).toBe(false);
    expect(existsSync(join(dir, "2026-01-01T00-00-00Z-aaa.html"))).toBe(false);
    expect(existsSync(join(dir, "2026-02-01T00-00-00Z-bbb.json"))).toBe(true);
    expect(existsSync(join(dir, "2026-02-01T00-00-00Z-bbb.html"))).toBe(true);
  });

  it("handles non-existent directory gracefully", () => {
    expect(() => enforceRetention("/nonexistent/dir", 10)).not.toThrow();
  });
});
