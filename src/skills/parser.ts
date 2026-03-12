import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import matter from "gray-matter";
import type { Skill, DuplicateSkill } from "../types.js";

export interface ParseResult {
  skills: Skill[];
  duplicates: DuplicateSkill[];
}

function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry.name === "SKILL.md") {
      results.push(fullPath);
    }
  }
  return results;
}

export async function parseSkills(skillsDir: string): Promise<ParseResult> {
  const resolvedDir = resolve(skillsDir);

  if (!existsSync(resolvedDir)) {
    throw new Error(`Skills directory not found: ${resolvedDir}`);
  }

  const skillFiles = findSkillFiles(resolvedDir);

  if (skillFiles.length === 0) {
    throw new Error(
      `No SKILL.md files found in ${resolvedDir}\n` +
        "Expected structure: <skills-dir>/<skill-name>/SKILL.md"
    );
  }

  const skills: Skill[] = [];
  const warnings: string[] = [];

  for (const filePath of skillFiles) {
    const raw = readFileSync(filePath, "utf-8");
    const { data } = matter(raw);

    const name = data.name || basename(dirname(filePath));
    const description = data.description || "";

    if (!description) {
      warnings.push(`Warning: ${name} has no description (${filePath})`);
    }

    skills.push({
      name,
      description,
      filePath,
    });
  }

  if (warnings.length > 0) {
    console.warn(warnings.join("\n"));
  }

  // Deduplicate by name — keep the first occurrence, warn about duplicates
  const seen = new Map<string, Skill>();
  const duplicates: DuplicateSkill[] = [];
  for (const skill of skills) {
    if (seen.has(skill.name)) {
      const existing = seen.get(skill.name)!;
      duplicates.push({
        name: skill.name,
        keptPath: existing.filePath,
        skippedPath: skill.filePath,
      });
      console.warn(
        `Warning: duplicate skill name "${skill.name}" — keeping ${existing.filePath}, skipping ${skill.filePath}`
      );
    } else {
      seen.set(skill.name, skill);
    }
  }

  return { skills: [...seen.values()], duplicates };
}
