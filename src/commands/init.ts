import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { confirm, input, password, select } from "@inquirer/prompts";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH, resolvePath } from "../config.js";
import type { HomingoConfig } from "../types.js";

type ProviderChoice = "anthropic" | "openai" | "both";

const ANTHROPIC_MODELS = [
  { name: "claude-sonnet-4-20250514 (recommended)", value: "claude-sonnet-4-20250514" },
  { name: "claude-haiku-35-20241022 (faster, cheaper)", value: "claude-haiku-35-20241022" },
  { name: "claude-opus-4-20250514 (most capable)", value: "claude-opus-4-20250514" },
];

const OPENAI_MODELS = [
  { name: "gpt-4o (recommended)", value: "gpt-4o" },
  { name: "gpt-4o-mini (faster, cheaper)", value: "gpt-4o-mini" },
  { name: "o3-mini (reasoning)", value: "o3-mini" },
];

const SAMPLE_SKILL = `---
name: example-skill
description: "Summarizes customer support tickets, extracting key issues, sentiment, and recommended actions."
---

# Example Skill

This is a sample skill created by \`homingo init\`.

- **name**: A unique kebab-case identifier for this skill
- **description**: What this skill does (used for routing decisions)

## Getting Started

1. Edit this file or create your own skills
2. One directory per skill, each with a \`SKILL.md\`
3. Run \`homingo audit\` to check for routing conflicts
`;

export async function initCommand(directory: string, configPath?: string): Promise<void> {
  const configFile = configPath ?? DEFAULT_CONFIG_PATH;

  // Phase 1: Global configuration
  console.log(chalk.bold("\n  Homingo Configuration\n"));

  // Load existing config if present
  let existing: Partial<HomingoConfig> | undefined;
  if (existsSync(configFile)) {
    try {
      existing = JSON.parse(readFileSync(configFile, "utf-8"));
      console.log(chalk.dim(`  Existing configuration found at ${configFile}\n`));
    } catch {
      // Malformed file — start fresh
    }
  }

  // Prompt for provider
  const providerChoice = (await select({
    message: "Which LLM provider?",
    choices: [
      { name: "Anthropic (Claude)", value: "anthropic" },
      { name: "OpenAI (GPT, o-series)", value: "openai" },
      { name: "Both", value: "both" },
      { name: "Google Gemini (coming soon)", value: "gemini", disabled: true },
    ],
    default: inferProviderDefault(existing),
  })) as ProviderChoice;

  // Prompt for API key(s) based on provider selection
  let anthropicApiKey: string | undefined;
  let openaiApiKey: string | undefined;

  if (providerChoice === "anthropic" || providerChoice === "both") {
    anthropicApiKey = await promptForApiKey("Anthropic API key:", existing?.anthropicApiKey);
  }

  if (providerChoice === "openai" || providerChoice === "both") {
    openaiApiKey = await promptForApiKey("OpenAI API key:", existing?.openaiApiKey);
  }

  // Prompt for model — show provider-appropriate choices
  const modelChoices = getModelChoices(providerChoice);
  const defaultModel = getDefaultModel(providerChoice, existing?.model);

  const model = await select({
    message: "Default model:",
    choices: modelChoices,
    default: defaultModel,
  });

  // Prompt for shadow router settings
  const promptsPerPair = await input({
    message: "Prompts per pair:",
    default: String(
      existing?.shadowRouter?.promptsPerPair ?? DEFAULT_CONFIG.shadowRouter.promptsPerPair
    ),
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1) return "Must be a positive number";
      return true;
    },
  });

  const accuracyThreshold = await input({
    message: "Accuracy threshold (%):",
    default: String(
      existing?.shadowRouter?.accuracyThreshold ?? DEFAULT_CONFIG.shadowRouter.accuracyThreshold
    ),
    validate: (v) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n < 1 || n > 100) return "Must be between 1 and 100";
      return true;
    },
  });

  // Prompt for skills directory
  const skillsDir = await input({
    message: "Skills directory:",
    default: existing?.skillsDir ?? DEFAULT_CONFIG.skillsDir,
  });

  // Prompt for output settings
  const reportDir = await input({
    message: "Report output directory:",
    default: existing?.output?.reportDir ?? DEFAULT_CONFIG.output.reportDir,
  });

  const format = await select({
    message: "Report format:",
    choices: [
      { name: "both (JSON + Markdown)", value: "both" as const },
      { name: "json", value: "json" as const },
      { name: "markdown", value: "markdown" as const },
    ],
    default: existing?.output?.format ?? DEFAULT_CONFIG.output.format,
  });

  // Assemble and write config
  const config: HomingoConfig = {
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(openaiApiKey ? { openaiApiKey } : {}),
    model,
    skillsDir,
    shadowRouter: {
      promptsPerPair: parseInt(promptsPerPair, 10),
      minPrompts: existing?.shadowRouter?.minPrompts ?? DEFAULT_CONFIG.shadowRouter.minPrompts,
      accuracyThreshold: parseInt(accuracyThreshold, 10),
      maxIterations:
        existing?.shadowRouter?.maxIterations ?? DEFAULT_CONFIG.shadowRouter.maxIterations,
    },
    output: {
      reportDir,
      format,
    },
  };

  mkdirSync(dirname(configFile), { recursive: true });
  writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
  console.log(chalk.green(`\n  Configuration saved to ${configFile}`));

  // Phase 2: Project scaffolding
  const targetDir = resolvePath(directory || ".");

  if (!existsSync(targetDir)) {
    console.error(chalk.red(`\n  Directory not found: ${targetDir}`));
    process.exit(1);
  }

  const stat = statSync(targetDir);
  if (!stat.isDirectory()) {
    console.error(chalk.red(`\n  Not a directory: ${targetDir}`));
    process.exit(1);
  }

  const created: string[] = [];

  // Resolve skillsDir: ~/foo and /abs/foo are used directly; ./foo is relative to targetDir
  const resolvedSkillsDir = resolvePath(skillsDir);
  const isAbsoluteSkillsDir = skillsDir.startsWith("~") || skillsDir.startsWith("/");
  const skillsDirPath = isAbsoluteSkillsDir ? resolvedSkillsDir : join(targetDir, skillsDir);
  mkdirSync(skillsDirPath, { recursive: true });

  const hasExistingSkills = hasSkillFiles(skillsDirPath);

  if (hasExistingSkills) {
    console.log(
      chalk.yellow(`  Skipped: sample skill (${skillsDirPath}/ already contains skills)`)
    );
  } else {
    const sampleSkillDir = join(skillsDirPath, "example-skill");
    mkdirSync(sampleSkillDir, { recursive: true });
    const sampleSkillPath = join(sampleSkillDir, "SKILL.md");
    writeFileSync(sampleSkillPath, SAMPLE_SKILL);
    created.push(join(skillsDirPath, "example-skill", "SKILL.md"));
  }

  // Print summary
  console.log("");

  if (created.length > 0) {
    console.log(chalk.bold("  Created:"));
    for (const file of created) {
      console.log(chalk.green(`    ${file}`));
    }
  }

  console.log(chalk.bold("\n  Next steps:\n"));
  console.log(`    Run: ${chalk.cyan(`homingo audit`)}`);
  console.log("");
}

/** Prompt for an API key, with option to keep existing one. */
async function promptForApiKey(message: string, existingKey?: string): Promise<string> {
  if (existingKey) {
    const masked = existingKey.slice(0, 7) + "..." + existingKey.slice(-4);
    const keepKey = await confirm({
      message: `Keep current key? (${masked})`,
      default: true,
    });
    if (keepKey) return existingKey;
  }

  return password({
    message,
    mask: "*",
    validate: (v) => (v.trim() === "" ? "API key is required" : true),
  });
}

/** Infer provider default from existing config. */
function inferProviderDefault(existing?: Partial<HomingoConfig>): ProviderChoice {
  if (!existing) return "anthropic";
  const hasAnthropic = !!existing.anthropicApiKey;
  const hasOpenai = !!existing.openaiApiKey;
  if (hasAnthropic && hasOpenai) return "both";
  if (hasOpenai) return "openai";
  return "anthropic";
}

/** Get model choices for the selected provider. */
function getModelChoices(provider: ProviderChoice) {
  switch (provider) {
    case "anthropic":
      return ANTHROPIC_MODELS;
    case "openai":
      return OPENAI_MODELS;
    case "both":
      return [...ANTHROPIC_MODELS, ...OPENAI_MODELS];
  }
}

/** Get default model for the selected provider, respecting existing config. */
function getDefaultModel(provider: ProviderChoice, existingModel?: string): string {
  // If existing model is valid for the selected provider, keep it
  if (existingModel) {
    const choices = getModelChoices(provider);
    if (choices.some((c) => c.value === existingModel)) {
      return existingModel;
    }
  }
  // Otherwise, first option is always the recommended default
  return getModelChoices(provider)[0].value;
}

function hasSkillFiles(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillPath = join(dir, entry.name, "SKILL.md");
      if (existsSync(skillPath)) return true;
    }
  }
  return false;
}
