import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { parseSkills } from "../src/skills/parser.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/skills");

describe("parseSkills", () => {
  it("parses all skill files from fixtures directory", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    expect(skills.length).toBe(11);
  });

  it("extracts name from frontmatter", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual([
      "code-review",
      "contract-drafting",
      "document-summary",
      "expense-tracker",
      "invoice-summary",
      "legal-compliance",
      "legal-review",
      "no-description",
      "oversized-skill",
      "security-audit",
      "tax-optimizer",
    ]);
  });

  it("extracts description from frontmatter", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const taxSkill = skills.find((s) => s.name === "tax-optimizer");
    expect(taxSkill).toBeDefined();
    expect(taxSkill!.description).toContain("tax");
    expect(taxSkill!.description).toContain("deduction");
  });

  it("parses new fixture skills correctly", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);

    const securityAudit = skills.find((s) => s.name === "security-audit");
    expect(securityAudit).toBeDefined();
    expect(securityAudit!.description).toContain("security vulnerabilities");
    expect(securityAudit!.description).toContain("compliance");

    const contractDrafting = skills.find((s) => s.name === "contract-drafting");
    expect(contractDrafting).toBeDefined();
    expect(contractDrafting!.description).toContain("contracts");
    expect(contractDrafting!.description).toContain("clauses");

    const expenseTracker = skills.find((s) => s.name === "expense-tracker");
    expect(expenseTracker).toBeDefined();
    expect(expenseTracker!.description).toContain("expenses");
    expect(expenseTracker!.description).toContain("deductible");
  });

  it("stores file path for each skill", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    for (const skill of skills) {
      expect(skill.filePath).toContain("SKILL.md");
      expect(skill.filePath).toContain(skill.name);
    }
  });

  it("handles skill with no description", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const noDesc = skills.find((s) => s.name === "no-description");
    expect(noDesc).toBeDefined();
    expect(noDesc!.description).toBe("");
  });

  it("warns about skills with no description", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await parseSkills(FIXTURES_DIR);
    expect(warnSpy).toHaveBeenCalled();
    const warning = warnSpy.mock.calls[0][0] as string;
    expect(warning).toContain("no-description");
    expect(warning).toContain("no description");
    warnSpy.mockRestore();
  });

  it("throws for non-existent directory", async () => {
    await expect(parseSkills("/nonexistent/path")).rejects.toThrow("Skills directory not found");
  });

  it("throws for directory with no SKILL.md files", async () => {
    const emptyDir = resolve(import.meta.dirname, "fixtures/empty-dir");
    await expect(parseSkills(emptyDir)).rejects.toThrow("No SKILL.md files");
  });
});
