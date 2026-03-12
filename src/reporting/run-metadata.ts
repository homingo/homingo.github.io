import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type { TrackedProvider } from "../providers/tracked-provider.js";

// ── Command names ──────────────────────────────────────────────

export type CommandName = "audit" | "lint" | "scan";

// ── Command-specific result types ──────────────────────────────

export interface AuditResult {
  type: "audit";
  fleetErrorRate: number;
  pairsTested: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export interface LintResult {
  type: "lint";
  targetSkill: string;
  neighborsTested: number;
  passingCount: number;
  failingCount: number;
  overallAccuracy: number;
  overloadedSkills: number;
  shardPlansGenerated: number;
  shardsApplied: boolean;
}

export interface ScanResult {
  type: "scan";
  totalSkills: number;
  totalPossiblePairs: number;
  conflictingPairs: number;
  overloadedSkills: number;
  duplicateSkills: number;
  healthScore: number;
}

export type CommandResult = AuditResult | LintResult | ScanResult;

// ── Run metadata ───────────────────────────────────────────────

export interface SkillEntry {
  name: string;
  description: string;
}

export interface RunMetadata {
  id: string;
  timestamp: string;
  durationMs: number;
  command: CommandName;
  args: Record<string, unknown>;
  model: string;
  provider: "anthropic" | "openai";
  skillCount: number;
  skills: SkillEntry[];
  tokens: { input: number; output: number; total: number };
  gitCommitHash: string | null;
  result: CommandResult;
}

// ── RunCollector ───────────────────────────────────────────────

export class RunCollector {
  private id: string;
  private startTime: number;
  private command: CommandName;
  private args: Record<string, unknown>;
  private model: string;
  private providerName: "anthropic" | "openai";
  private _skillCount = 0;
  private _skills: SkillEntry[] = [];
  private _result: CommandResult | null = null;

  constructor(
    command: CommandName,
    args: Record<string, unknown>,
    model: string,
    providerName: "anthropic" | "openai"
  ) {
    this.id = randomUUID();
    this.startTime = Date.now();
    this.command = command;
    this.args = args;
    this.model = model;
    this.providerName = providerName;
  }

  setSkillCount(n: number): void {
    this._skillCount = n;
  }

  setSkills(skills: Array<{ name: string; description: string }>): void {
    this._skills = skills.map((s) => ({ name: s.name, description: s.description }));
  }

  setResult(result: CommandResult): void {
    this._result = result;
  }

  finalize(tracked: TrackedProvider): RunMetadata {
    if (!this._result) {
      throw new Error("RunCollector.finalize() called before setResult()");
    }

    const usage = tracked.totalUsage;
    const durationMs = Date.now() - this.startTime;

    return {
      id: this.id,
      timestamp: new Date().toISOString(),
      durationMs,
      command: this.command,
      args: this.args,
      model: this.model,
      provider: this.providerName,
      skillCount: this._skillCount,
      skills: this._skills,
      tokens: {
        input: usage.inputTokens,
        output: usage.outputTokens,
        total: usage.inputTokens + usage.outputTokens,
      },
      gitCommitHash: getGitCommitHash(),
      result: this._result,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────

function getGitCommitHash(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}
