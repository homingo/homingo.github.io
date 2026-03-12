import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeShardPlan } from "../src/shard/writer.js";
import type { ShardPlan, ShardedSkill } from "../src/types.js";

function makeShardPlan(overrides?: Partial<ShardPlan>): ShardPlan {
  const subSkills: ShardedSkill[] = [
    {
      name: "finance-invoices",
      description: "Handles invoice parsing and extraction from PDFs and images.",
      role: "sub-skill",
      intents: ["invoice processing", "bill extraction"],
      negativeTriggers: ["Does NOT handle tax preparation", "Does NOT handle payroll"],
    },
    {
      name: "finance-taxes",
      description: "Manages tax document analysis, W-2 processing, and deduction optimization.",
      role: "sub-skill",
      intents: ["tax analysis", "deduction optimization"],
      negativeTriggers: ["Does NOT handle invoice parsing", "Does NOT handle expense tracking"],
    },
  ];

  const orchestrator: ShardedSkill = {
    name: "finance-orchestrator",
    description:
      "Delegates financial tasks to specialized sub-skills: finance-invoices for billing, finance-taxes for tax preparation.",
    role: "orchestrator",
    intents: ["delegates to sub-skills"],
    negativeTriggers: ["Does NOT handle any financial tasks directly"],
  };

  return {
    originalSkill: {
      name: "finance",
      description: "Handles everything financial",
      filePath: "/skills/finance/SKILL.md",
    },
    reason: "description is 1500 chars (threshold: 1024)",
    descriptionLength: 1500,
    identifiedIntents: ["invoice processing", "tax analysis"],
    subSkills,
    orchestrator,
    ...overrides,
  };
}

describe("writeShardPlan", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "homingo-shard-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a directory and SKILL.md for each sub-skill", () => {
    const plan = makeShardPlan();
    const result = writeShardPlan(plan, tempDir);

    expect(result.filesWritten).toHaveLength(3); // 2 sub-skills + 1 orchestrator

    for (const subSkill of plan.subSkills) {
      const filePath = join(tempDir, subSkill.name, "SKILL.md");
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it("creates orchestrator SKILL.md", () => {
    const plan = makeShardPlan();
    writeShardPlan(plan, tempDir);

    const orchestratorPath = join(tempDir, plan.orchestrator.name, "SKILL.md");
    expect(existsSync(orchestratorPath)).toBe(true);
  });

  it("writes valid frontmatter with name and description", () => {
    const plan = makeShardPlan();
    writeShardPlan(plan, tempDir);

    const content = readFileSync(join(tempDir, "finance-invoices", "SKILL.md"), "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("name: finance-invoices");
    expect(content).toContain("description:");
    expect(content).toContain("Handles invoice parsing");
  });

  it("includes role label in skill file", () => {
    const plan = makeShardPlan();
    writeShardPlan(plan, tempDir);

    const subContent = readFileSync(join(tempDir, "finance-invoices", "SKILL.md"), "utf-8");
    expect(subContent).toContain("Sub-skill");

    const orchContent = readFileSync(join(tempDir, "finance-orchestrator", "SKILL.md"), "utf-8");
    expect(orchContent).toContain("Orchestrator");
  });

  it("includes intents in skill file", () => {
    const plan = makeShardPlan();
    writeShardPlan(plan, tempDir);

    const content = readFileSync(join(tempDir, "finance-invoices", "SKILL.md"), "utf-8");
    expect(content).toContain("invoice processing");
    expect(content).toContain("bill extraction");
  });

  it("includes negative triggers in skill file", () => {
    const plan = makeShardPlan();
    writeShardPlan(plan, tempDir);

    const content = readFileSync(join(tempDir, "finance-invoices", "SKILL.md"), "utf-8");
    expect(content).toContain("Does NOT handle tax preparation");
    expect(content).toContain("Does NOT handle payroll");
  });

  it("returns correct file paths", () => {
    const plan = makeShardPlan();
    const result = writeShardPlan(plan, tempDir);

    expect(result.filesWritten).toContain(join(tempDir, "finance-invoices", "SKILL.md"));
    expect(result.filesWritten).toContain(join(tempDir, "finance-taxes", "SKILL.md"));
    expect(result.filesWritten).toContain(join(tempDir, "finance-orchestrator", "SKILL.md"));
  });

  it("handles sub-skills with no negative triggers", () => {
    const plan = makeShardPlan({
      subSkills: [
        {
          name: "clean-sub",
          description: "Does one thing well",
          role: "sub-skill",
          intents: ["single intent"],
          negativeTriggers: [],
        },
        {
          name: "clean-sub-2",
          description: "Does another thing well",
          role: "sub-skill",
          intents: ["another intent"],
          negativeTriggers: [],
        },
      ],
    });
    const result = writeShardPlan(plan, tempDir);

    const content = readFileSync(join(tempDir, "clean-sub", "SKILL.md"), "utf-8");
    expect(content).not.toContain("Negative Triggers");
    expect(result.filesWritten).toHaveLength(3);
  });

  it("escapes quotes in description for YAML frontmatter", () => {
    const plan = makeShardPlan({
      subSkills: [
        {
          name: "quoted-skill",
          description: 'Handles "special" documents with "quotes"',
          role: "sub-skill",
          intents: ["quoting"],
          negativeTriggers: [],
        },
        {
          name: "other-skill",
          description: "Other functionality",
          role: "sub-skill",
          intents: ["other"],
          negativeTriggers: [],
        },
      ],
    });
    writeShardPlan(plan, tempDir);

    const content = readFileSync(join(tempDir, "quoted-skill", "SKILL.md"), "utf-8");
    // Quotes in YAML should be escaped
    expect(content).toContain('\\"special\\"');
  });
});
