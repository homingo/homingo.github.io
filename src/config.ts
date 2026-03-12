import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { HomingoConfig } from "./types.js";

/** Expand leading ~ to the user's home directory, then resolve to absolute. */
export function resolvePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(join(homedir(), p.slice(2)));
  return resolve(p);
}

export const DEFAULT_CONFIG_PATH = join(homedir(), ".homingo", "config.json");

export const DEFAULT_CONFIG: Omit<HomingoConfig, "anthropicApiKey" | "openaiApiKey"> = {
  model: "claude-sonnet-4-20250514",
  skillsDir: "./skills",
  shadowRouter: {
    promptsPerPair: 10,
    minPrompts: 5,
    accuracyThreshold: 90,
    maxIterations: 5,
  },
  output: {
    reportDir: join(homedir(), ".homingo", "reports"),
    format: "both",
  },
};

export function loadConfig(configPath?: string): HomingoConfig {
  const filePath = configPath ?? DEFAULT_CONFIG_PATH;

  // 1. Read config file if it exists
  let fileConfig: Partial<HomingoConfig> & {
    shadowRouter?: Partial<HomingoConfig["shadowRouter"]>;
    output?: Partial<HomingoConfig["output"]>;
  } = {};
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch {
      console.warn(`Warning: ${filePath} is malformed, using defaults`);
    }
  }

  // 2. Env vars override config file (CI/CD + dev .env support)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || fileConfig.anthropicApiKey;
  const openaiApiKey = process.env.OPENAI_API_KEY || fileConfig.openaiApiKey;

  if (!anthropicApiKey && !openaiApiKey) {
    console.error(
      "Error: No API key found.\n" +
        "Run `homingo init` to configure, or set ANTHROPIC_API_KEY / OPENAI_API_KEY environment variable."
    );
    process.exit(1);
  }

  // 3. Resolve skillsDir: ~/foo → /home/user/foo, ./foo → /cwd/foo, /abs → /abs
  const resolvedSkillsDir = resolvePath(fileConfig.skillsDir ?? DEFAULT_CONFIG.skillsDir);

  // 4. Deep-merge: defaults <- config file <- env overrides
  return {
    anthropicApiKey,
    openaiApiKey,
    model: fileConfig.model ?? DEFAULT_CONFIG.model,
    ...(fileConfig.simModel ? { simModel: fileConfig.simModel } : {}),
    skillsDir: resolvedSkillsDir,
    shadowRouter: {
      ...DEFAULT_CONFIG.shadowRouter,
      ...fileConfig.shadowRouter,
    },
    output: {
      ...DEFAULT_CONFIG.output,
      ...fileConfig.output,
    },
  };
}
