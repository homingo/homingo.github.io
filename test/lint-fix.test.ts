import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";
import matter from "gray-matter";
import { applyRewrite } from "../src/commands/lint.js";
import type { Skill } from "../src/types.js";

function createSkillFile(dir: string, name: string, description: string, body: string): string {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const filePath = join(skillDir, "SKILL.md");
  const content = `---\nname: ${name}\ndescription: "${description}"\n---\n\n${body}\n`;
  writeFileSync(filePath, content);
  return filePath;
}

describe("applyRewrite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "homingo-lint-fix-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates the description in frontmatter", () => {
    const filePath = createSkillFile(
      tempDir,
      "tax-optimizer",
      "Handles tax document analysis and deduction optimization.",
      "# Tax Optimizer\n\nAnalyze tax documents."
    );

    const skill: Skill = {
      name: "tax-optimizer",
      description: "Handles tax document analysis and deduction optimization.",
      filePath,
    };

    const newDesc =
      "Processes tax returns, W-2s, and 1099s for deduction optimization. Does NOT handle invoice parsing or expense tracking.";
    applyRewrite(skill, newDesc);

    const updated = readFileSync(filePath, "utf-8");
    // Use gray-matter to parse the description since YAML may wrap long strings
    const parsed = matter(updated);
    expect(parsed.data.description).toBe(newDesc);
    expect(parsed.data.description).not.toBe(
      "Handles tax document analysis and deduction optimization."
    );
  });

  it("preserves the name field in frontmatter", () => {
    const filePath = createSkillFile(
      tempDir,
      "invoice-summary",
      "Processes invoices and billing documents.",
      "# Invoice Summary\n\nExtract key data from invoices."
    );

    const skill: Skill = {
      name: "invoice-summary",
      description: "Processes invoices and billing documents.",
      filePath,
    };

    applyRewrite(skill, "Updated description for invoice handling.");

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain("name: invoice-summary");
    expect(updated).toContain("Updated description for invoice handling.");
  });

  it("preserves the markdown body content", () => {
    const body = "# My Skill\n\nThis is the body content.\n\n## Details\n\nMore info here.";
    const filePath = createSkillFile(tempDir, "my-skill", "Original description.", body);

    const skill: Skill = {
      name: "my-skill",
      description: "Original description.",
      filePath,
    };

    applyRewrite(skill, "New improved description.");

    const updated = readFileSync(filePath, "utf-8");
    expect(updated).toContain("# My Skill");
    expect(updated).toContain("This is the body content.");
    expect(updated).toContain("## Details");
    expect(updated).toContain("More info here.");
  });

  it("handles descriptions containing quotes", () => {
    const filePath = createSkillFile(
      tempDir,
      "quoted-skill",
      "Handles basic tasks.",
      "# Quoted Skill"
    );

    const skill: Skill = {
      name: "quoted-skill",
      description: "Handles basic tasks.",
      filePath,
    };

    applyRewrite(skill, 'Handles "special" documents with "quoted" terms.');

    const updated = readFileSync(filePath, "utf-8");
    // gray-matter handles YAML quoting automatically
    expect(updated).toContain("special");
    expect(updated).toContain("quoted");
  });

  it("does not modify other files in the same directory", () => {
    const filePath1 = createSkillFile(tempDir, "skill-a", "Description A.", "# Skill A");
    const filePath2 = createSkillFile(tempDir, "skill-b", "Description B.", "# Skill B");

    const skill: Skill = {
      name: "skill-a",
      description: "Description A.",
      filePath: filePath1,
    };

    applyRewrite(skill, "Updated description A.");

    // skill-b should be untouched
    const fileB = readFileSync(filePath2, "utf-8");
    expect(fileB).toContain("Description B.");
    expect(fileB).not.toContain("Updated description A.");
  });

  it("produces a file that gray-matter can re-parse correctly", () => {
    const filePath = createSkillFile(
      tempDir,
      "roundtrip",
      "Original description.",
      "# Roundtrip Test"
    );

    const skill: Skill = {
      name: "roundtrip",
      description: "Original description.",
      filePath,
    };

    const newDesc = "Handles financial document analysis. Does NOT handle tax preparation.";
    applyRewrite(skill, newDesc);

    // Re-parse the file and verify
    const updated = readFileSync(filePath, "utf-8");
    const parsed = matter(updated);
    expect(parsed.data.name).toBe("roundtrip");
    expect(parsed.data.description).toBe(newDesc);
  });
});
