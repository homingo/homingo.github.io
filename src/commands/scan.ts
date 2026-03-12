import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { parseSkills } from "../skills/parser.js";
import { selectPairs } from "../shadow-router/pair-selector.js";
import type { SkillPair } from "../shadow-router/pair-selector.js";
import { ShardAnalyzer } from "../shard/analyzer.js";
import type { OverloadResult } from "../shard/analyzer.js";
import type { RunMetadata, ScanResult } from "../reporting/run-metadata.js";
import { saveRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import type { LLMProvider } from "../providers/types.js";
import type { Skill, DuplicateSkill } from "../types.js";

interface ScanOptions {
  allPairs?: boolean;
  json?: boolean;
  enhanced?: boolean;
  skillsDir?: string;
  open?: boolean;
}

interface OverloadFinding {
  skillName: string;
  descriptionLength: number;
  reason: string;
  result: OverloadResult;
}

export interface ScanData {
  overlapPairs: ScanPairEntry[];
  overloadFindings: OverloadFinding[];
  duplicateFindings: DuplicateSkill[];
  healthScore: number;
  totalSkills: number;
  totalPossiblePairs: number;
}

export interface ScanPairEntry {
  skillA: string;
  skillB: string;
  overlapScore: number;
  reason: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

function overlapSeverity(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 0.5) return "CRITICAL";
  if (score >= 0.35) return "HIGH";
  if (score >= 0.2) return "MEDIUM";
  return "LOW";
}

const SEVERITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 1.0,
  HIGH: 0.75,
  MEDIUM: 0.35,
  LOW: 0,
};

function computeHealthScore(
  _totalPairs: number,
  pairs: ScanPairEntry[],
  totalSkills: number,
  overloadedSkills: number,
  duplicateSkills: number
): number {
  // Count unique skills involved in conflicts, weighted by worst severity per skill
  const skillWorstSeverity = new Map<string, number>();
  for (const p of pairs) {
    const w = SEVERITY_WEIGHTS[p.severity] ?? 0;
    if (w === 0) continue;
    for (const name of [p.skillA, p.skillB]) {
      skillWorstSeverity.set(name, Math.max(skillWorstSeverity.get(name) ?? 0, w));
    }
  }
  const weightedConflictingSkills = [...skillWorstSeverity.values()].reduce((a, b) => a + b, 0);

  // Normalize against total skills, not total pairs
  // 60% conflict ratio, 25% overload ratio, 15% duplicate ratio
  const conflictRatio = totalSkills > 0 ? weightedConflictingSkills / totalSkills : 0;
  const overloadRatio = totalSkills > 0 ? overloadedSkills / totalSkills : 0;
  const duplicateRatio = totalSkills > 0 ? duplicateSkills / totalSkills : 0;

  const rawScore = 100 - (conflictRatio * 60 + overloadRatio * 25 + duplicateRatio * 15);
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

function getGitCommitHash(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export async function scanCommand(options: ScanOptions): Promise<void> {
  const startTime = Date.now();
  const config = loadConfig();
  const skillsDir = resolvePath(options.skillsDir || config.skillsDir);

  // Parse skills
  const parseSpinner = ora("Parsing skills...").start();
  let skills: Skill[];
  let duplicateFindings: DuplicateSkill[];
  try {
    ({ skills, duplicates: duplicateFindings } = await parseSkills(skillsDir));
    parseSpinner.succeed(
      duplicateFindings.length > 0
        ? `Found ${skills.length} skills (${duplicateFindings.length} duplicate name${duplicateFindings.length !== 1 ? "s" : ""} detected)`
        : `Found ${skills.length} skills`
    );
  } catch (err) {
    parseSpinner.fail((err as Error).message);
    process.exit(1);
  }

  if (skills.length < 2) {
    console.log(chalk.yellow("Need at least 2 skills to run scan."));
    process.exit(0);
  }

  // Run heuristic pair selection
  const pairSpinner = ora("Analyzing skill overlaps...").start();
  const pairResult = selectPairs(skills, options.allPairs, options.enhanced ?? false);
  const { selectedPairs, totalPossiblePairs } = pairResult;
  pairSpinner.succeed(`Analyzed ${totalPossiblePairs} possible pairs`);

  // Build overlap entries with severity
  const overlapPairs: ScanPairEntry[] = selectedPairs.map((pair: SkillPair) => ({
    skillA: pair.skillA.name,
    skillB: pair.skillB.name,
    overlapScore: pair.overlapScore,
    reason: pair.reason,
    severity: overlapSeverity(pair.overlapScore),
  }));

  // Run scope overload analysis
  const overloadSpinner = ora("Checking scope overload...").start();
  // Dummy provider — analyzeOverload is pure heuristic, never calls the LLM
  const dummyProvider: LLMProvider = {
    createMessage: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
  };
  const analyzer = new ShardAnalyzer({
    provider: dummyProvider,
    model: "scan-local",
  });

  const overloadFindings: OverloadFinding[] = [];
  for (const skill of skills) {
    const result = analyzer.analyzeOverload(skill);
    if (result.isOverloaded) {
      overloadFindings.push({
        skillName: skill.name,
        descriptionLength: result.descriptionLength,
        reason: result.reason,
        result,
      });
    }
  }
  overloadSpinner.succeed(
    overloadFindings.length > 0
      ? `${overloadFindings.length} skill${overloadFindings.length !== 1 ? "s" : ""} flagged as overloaded`
      : "No scope overload detected"
  );

  // Compute health score (all severities contribute, weighted)
  const conflictingPairs = overlapPairs.filter(
    (p) => p.severity === "CRITICAL" || p.severity === "HIGH"
  ).length;
  const healthScore = computeHealthScore(
    totalPossiblePairs,
    overlapPairs,
    skills.length,
    overloadFindings.length,
    duplicateFindings.length
  );

  const scanData: ScanData = {
    overlapPairs,
    overloadFindings,
    duplicateFindings,
    healthScore,
    totalSkills: skills.length,
    totalPossiblePairs,
  };

  // Output
  if (options.json) {
    console.log(JSON.stringify(scanData, null, 2));
  } else {
    printScanReport(scanData);
  }

  // Build RunMetadata directly (no RunCollector — no API calls to track)
  const durationMs = Date.now() - startTime;
  const scanResult: ScanResult = {
    type: "scan",
    totalSkills: skills.length,
    totalPossiblePairs,
    conflictingPairs,
    overloadedSkills: overloadFindings.length,
    duplicateSkills: duplicateFindings.length,
    healthScore,
  };

  const metadata: RunMetadata = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    command: "scan",
    args: sanitizeArgs(options),
    model: "local-heuristic",
    provider: "anthropic", // placeholder — scan makes no API calls
    skillCount: skills.length,
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
    tokens: { input: 0, output: 0, total: 0 },
    gitCommitHash: getGitCommitHash(),
    result: scanResult,
  };

  const reportDir = resolvePath(config.output.reportDir);
  const stored = saveRun("scan", metadata, scanData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  // Exit code 1 if issues found (CI-friendly)
  if (conflictingPairs > 0 || overloadFindings.length > 0 || duplicateFindings.length > 0) {
    process.exit(1);
  }
}

function sanitizeArgs(options: ScanOptions): Record<string, unknown> {
  return {
    allPairs: options.allPairs ?? false,
    enhanced: options.enhanced ?? false,
  };
}

function printScanReport(data: ScanData): void {
  const scoreColor =
    data.healthScore >= 80 ? chalk.green : data.healthScore >= 50 ? chalk.yellow : chalk.red;

  console.log(`\n${chalk.bold("Homingo Scan Report")}`);
  console.log(
    `Skills: ${data.totalSkills} | ` +
      `Pairs Analyzed: ${data.totalPossiblePairs} | ` +
      `Health Score: ${scoreColor(chalk.bold(String(data.healthScore) + "/100"))}`
  );

  // Overlap pairs table
  const criticalHigh = data.overlapPairs.filter(
    (p) => p.severity === "CRITICAL" || p.severity === "HIGH"
  );
  const medium = data.overlapPairs.filter((p) => p.severity === "MEDIUM");

  if (criticalHigh.length > 0) {
    console.log(`\n${chalk.red("Conflicting Pairs")} (${criticalHigh.length}):`);
    const table = new Table({
      head: ["Skill Pair", "Overlap", "Severity", "Reason"],
      colWidths: [40, 10, 12, 45],
      style: { head: [] },
    });

    for (const pair of criticalHigh) {
      const sevColor = pair.severity === "CRITICAL" ? chalk.red : chalk.yellow;
      table.push([
        `${pair.skillA} ↔ ${pair.skillB}`,
        `${(pair.overlapScore * 100).toFixed(0)}%`,
        sevColor(pair.severity),
        pair.reason,
      ]);
    }
    console.log(table.toString());
  }

  if (medium.length > 0) {
    console.log(`\n${chalk.cyan("Medium Overlap")} (${medium.length}):`);
    const table = new Table({
      head: ["Skill Pair", "Overlap", "Reason"],
      colWidths: [40, 10, 55],
      style: { head: [] },
    });
    for (const pair of medium) {
      table.push([
        `${pair.skillA} ↔ ${pair.skillB}`,
        `${(pair.overlapScore * 100).toFixed(0)}%`,
        pair.reason,
      ]);
    }
    console.log(table.toString());
  }

  // Overload findings
  if (data.overloadFindings.length > 0) {
    console.log(
      `\n${chalk.yellow("Scope Overload")} (${data.overloadFindings.length} skill${data.overloadFindings.length !== 1 ? "s" : ""}):`
    );
    for (const finding of data.overloadFindings) {
      console.log(
        `  ${chalk.bold(finding.skillName)} (${finding.descriptionLength} chars) — ${finding.reason}`
      );
    }
  }

  // Duplicate skills
  if (data.duplicateFindings.length > 0) {
    console.log(`\n${chalk.red("Duplicate Skills")} (${data.duplicateFindings.length}):`);
    for (const dup of data.duplicateFindings) {
      console.log(
        `  ${chalk.bold(dup.name)}\n    Kept:    ${dup.keptPath}\n    Skipped: ${dup.skippedPath}`
      );
    }
  }

  // Summary / next steps
  const hasIssues =
    criticalHigh.length > 0 ||
    data.overloadFindings.length > 0 ||
    data.duplicateFindings.length > 0;

  if (!hasIssues) {
    console.log(
      `\n${chalk.green("✅ Fleet looks healthy.")} No critical overlaps or overloaded skills detected.`
    );
  } else {
    console.log(`\n${chalk.bold("Next steps")}:`);
    if (criticalHigh.length > 0) {
      console.log(
        `  ${chalk.cyan("→")} Run ${chalk.bold("homingo audit")} to measure actual routing accuracy for conflicting pairs`
      );
    }
    if (data.overloadFindings.length > 0) {
      console.log(
        `  ${chalk.cyan("→")} Run ${chalk.bold("homingo lint --fix")} to get rewrite suggestions and shard plans`
      );
    }
    if (data.duplicateFindings.length > 0) {
      console.log(
        `  ${chalk.cyan("→")} Rename or remove duplicate skills to avoid routing ambiguity`
      );
    }
  }
}
