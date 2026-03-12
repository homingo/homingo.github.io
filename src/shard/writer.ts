import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShardPlan, ShardedSkill } from "../types.js";

export interface WriteResult {
  filesWritten: string[];
}

/**
 * Writes shard plan to disk as SKILL.md files.
 * Creates one directory per sub-skill + one for the orchestrator.
 * Does NOT delete the original skill — the user does that manually.
 */
export function writeShardPlan(plan: ShardPlan, outputDir: string): WriteResult {
  const filesWritten: string[] = [];

  // Write each sub-skill
  for (const subSkill of plan.subSkills) {
    const filePath = writeSkillFile(subSkill, outputDir);
    filesWritten.push(filePath);
  }

  // Write the orchestrator
  const orchestratorPath = writeSkillFile(plan.orchestrator, outputDir);
  filesWritten.push(orchestratorPath);

  return { filesWritten };
}

function writeSkillFile(skill: ShardedSkill, outputDir: string): string {
  const skillDir = join(outputDir, skill.name);
  mkdirSync(skillDir, { recursive: true });

  const negativeTriggerLines =
    skill.negativeTriggers.length > 0
      ? `\n${skill.negativeTriggers.map((t) => `- ${t}`).join("\n")}\n`
      : "";

  const roleLabel = skill.role === "orchestrator" ? "Orchestrator" : "Sub-skill";
  const titleName = skill.name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const content = `---
name: ${skill.name}
description: "${escapeYamlString(skill.description)}"
---

# ${titleName}

${skill.description}

## Role
${roleLabel}

## Intents
${skill.intents.map((i) => `- ${i}`).join("\n")}
${negativeTriggerLines ? `\n## Negative Triggers${negativeTriggerLines}` : ""}`;

  const filePath = join(skillDir, "SKILL.md");
  writeFileSync(filePath, content);
  return filePath;
}

function escapeYamlString(str: string): string {
  return str.replace(/"/g, '\\"');
}
