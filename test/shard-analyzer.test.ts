import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { ShardAnalyzer } from "../src/shard/analyzer.js";
import { parseSkills } from "../src/skills/parser.js";
import type { Skill } from "../src/types.js";
import type { LLMProvider } from "../src/providers/index.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/skills");

function skill(name: string, description: string): Skill {
  return { name, description, filePath: `/skills/${name}/SKILL.md` };
}

// analyzeOverload is pure logic — mock provider is never called
const mockProvider: LLMProvider = {
  createMessage: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
};
const analyzer = new ShardAnalyzer({ provider: mockProvider, model: "dummy" });

describe("analyzeOverload", () => {
  it("flags descriptions over 1024 chars", () => {
    const longDesc = "A".repeat(1025);
    const result = analyzer.analyzeOverload(skill("big-skill", longDesc));
    expect(result.isOverloaded).toBe(true);
    expect(result.descriptionLength).toBe(1025);
    expect(result.reason).toContain("1025 chars");
  });

  it("does not flag short descriptions", () => {
    const result = analyzer.analyzeOverload(
      skill("small-skill", "Handles invoice parsing and extraction.")
    );
    expect(result.isOverloaded).toBe(false);
    expect(result.reason).toContain("acceptable scope");
  });

  it("flags descriptions with multiple semicolons", () => {
    const desc =
      "Handles invoice parsing; manages tax preparation; performs expense tracking; generates reports";
    const result = analyzer.analyzeOverload(skill("multi-intent", desc));
    expect(result.isOverloaded).toBe(true);
    expect(result.reason).toContain("semicolons");
  });

  it("flags descriptions with many distinct clauses", () => {
    const desc =
      "Processes invoices from vendors. " +
      "Extracts line items and totals from bills. " +
      "Manages payment schedules and reminders. " +
      "Generates financial reports for stakeholders. " +
      "Handles currency conversion for international payments.";
    const result = analyzer.analyzeOverload(skill("many-clauses", desc));
    expect(result.isOverloaded).toBe(true);
    expect(result.reason).toContain("clauses");
  });

  it("flags descriptions with multiple 'and [verb]' patterns", () => {
    const desc =
      "Handles invoice parsing and processes tax documents, " +
      "and manages expense reports, and generates financial summaries";
    const result = analyzer.analyzeOverload(skill("and-verbs", desc));
    expect(result.isOverloaded).toBe(true);
    expect(result.reason).toContain("and [verb]");
  });

  it("reports multiple reasons when multiple heuristics match", () => {
    const desc =
      "Handles invoice parsing; processes tax documents; manages expense reports. " +
      "Also generates financial reports for stakeholders. " +
      "Performs compliance checks and budget analysis. " +
      "Creates payment schedules and handles vendor management.";
    const result = analyzer.analyzeOverload(skill("multi-reason", desc));
    expect(result.isOverloaded).toBe(true);
    // Should report both semicolons and clause count
    expect(result.reason).toContain(";");
  });

  it("returns correct description length", () => {
    const desc = "Short description";
    const result = analyzer.analyzeOverload(skill("test", desc));
    expect(result.descriptionLength).toBe(desc.length);
  });

  it("does not flag descriptions just under 1024 chars", () => {
    const desc = "A".repeat(1024);
    const result = analyzer.analyzeOverload(skill("edge", desc));
    // 1024 chars exactly is not over the threshold
    expect(result.descriptionLength).toBe(1024);
    // Only flagged if > 1024, but might be flagged by other heuristics
    expect(result.reason).not.toContain("chars");
  });
});

describe("analyzeOverload with fixtures", () => {
  it("flags the oversized-skill fixture", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const oversized = skills.find((s) => s.name === "oversized-skill");
    expect(oversized).toBeDefined();
    const result = analyzer.analyzeOverload(oversized!);
    expect(result.isOverloaded).toBe(true);
    expect(result.descriptionLength).toBeGreaterThan(1024);
  });

  it("does not flag normal-sized fixture skills", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const normal = skills.find((s) => s.name === "invoice-summary");
    expect(normal).toBeDefined();
    const result = analyzer.analyzeOverload(normal!);
    expect(result.isOverloaded).toBe(false);
  });

  it("does not flag any of the 10 original fixture skills", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const originalSkills = skills.filter(
      (s) => s.name !== "oversized-skill" && s.name !== "no-description"
    );
    for (const s of originalSkills) {
      const result = analyzer.analyzeOverload(s);
      // None of the original 9 real skills should be overloaded
      expect(result.isOverloaded).toBe(false);
    }
  });
});
