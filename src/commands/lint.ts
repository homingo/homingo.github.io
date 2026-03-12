import { readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import Table from "cli-table3";
import matter from "gray-matter";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { createProvider, detectProvider, TrackedProvider } from "../providers/index.js";
import { parseSkills } from "../skills/parser.js";
import { selectPairs, selectNeighbors } from "../shadow-router/pair-selector.js";
import { PromptGenerator } from "../shadow-router/generator.js";
import { RoutingSimulator } from "../shadow-router/simulator.js";
import { scorePair } from "../shadow-router/scorer.js";
import { DescriptionRewriter } from "../rewriter/rewriter.js";
import { ShardAnalyzer } from "../shard/analyzer.js";
import { writeShardPlan } from "../shard/writer.js";
import { RunCollector } from "../reporting/run-metadata.js";
import { saveRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import type { Skill, PairConflictReport, ShardPlan } from "../types.js";
import type { LintData, ShardFinding } from "../reporting/html-renderer.js";

interface LintOptions {
  prompts?: string;
  threshold?: string;
  model?: string;
  concurrency?: string;
  json?: boolean;
  fix?: boolean;
  dryRun?: boolean;
  enhanced?: boolean;
  skillsDir?: string;
  open?: boolean;
  skill?: string;
  neighbors?: string;
  force?: boolean;
}

export async function lintCommand(options: LintOptions): Promise<void> {
  const config = loadConfig();
  const skillsDir = resolvePath(options.skillsDir || config.skillsDir);
  const model = options.model || config.model;
  const promptsPerPair = parseInt(options.prompts || "50", 10);
  const threshold = parseInt(options.threshold || "90", 10);
  const concurrency = parseInt(options.concurrency || "10", 10);

  // Parse skills
  const parseSpinner = ora("Parsing skills...").start();
  let skills: Skill[];
  try {
    ({ skills } = await parseSkills(skillsDir));
    parseSpinner.succeed(`Found ${skills.length} skills`);
  } catch (err) {
    parseSpinner.fail((err as Error).message);
    process.exit(1);
  }

  if (skills.length < 2) {
    console.log(chalk.yellow("Need at least 2 skills to lint."));
    process.exit(0);
  }

  // Route to the correct mode
  if (options.skill) {
    await runSingleSkillLint(options, skills, {
      skillsDir,
      model,
      promptsPerPair,
      threshold,
      concurrency,
      config,
    });
  } else {
    await runFleetLint(options, skills, {
      skillsDir,
      model,
      promptsPerPair,
      threshold,
      concurrency,
      config,
    });
  }
}

// ── Shared context ────────────────────────────────────────────

interface LintContext {
  skillsDir: string;
  model: string;
  promptsPerPair: number;
  threshold: number;
  concurrency: number;
  config: ReturnType<typeof loadConfig>;
}

// ── Fleet-wide lint (no --skill) ──────────────────────────────

async function runFleetLint(
  options: LintOptions,
  skills: Skill[],
  ctx: LintContext
): Promise<void> {
  // Select pairs to test
  const pairResult = selectPairs(skills, false, options.enhanced ?? false);
  const { selectedPairs, totalPossiblePairs } = pairResult;

  if (selectedPairs.length === 0) {
    console.log(chalk.green("No overlapping skill pairs detected. Fleet looks clean."));
    process.exit(0);
  }

  console.log(
    `\nLinting ${chalk.bold(String(selectedPairs.length))} pairs` +
      ` (of ${totalPossiblePairs} possible) — threshold: ${ctx.threshold}%`
  );
  console.log(chalk.dim(`Model: ${ctx.model} | Prompts per pair: ${ctx.promptsPerPair}\n`));

  if (options.dryRun) {
    console.log(chalk.bold("Dry run — pairs that would be tested:\n"));
    const table = new Table({
      head: ["Skill Pair", "Overlap Score", "Reason"],
      colWidths: [40, 15, 50],
      style: { head: [] },
    });
    for (const pair of selectedPairs) {
      table.push([
        `${pair.skillA.name} ↔ ${pair.skillB.name}`,
        `${(pair.overlapScore * 100).toFixed(0)}%`,
        pair.reason,
      ]);
    }
    console.log(table.toString());

    // Dry run also shows scope checks
    printDryRunScopeChecks(skills);
    console.log(chalk.dim(`\nNo API calls made.`));
    return;
  }

  const providerName = detectProvider(ctx.model);
  const innerProvider = createProvider(ctx.model, ctx.config);
  const tracked = new TrackedProvider(innerProvider);
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);

  const generator = new PromptGenerator({ provider: tracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: tracked,
    model: ctx.model,
    concurrency: ctx.concurrency,
  });

  // Phase 1: Test all pairs
  const { failingReports, passingCount } = await testPairs(
    selectedPairs.map((p) => ({ skillA: p.skillA, skillB: p.skillB })),
    skills,
    generator,
    simulator,
    ctx
  );

  // Summary after testing
  console.log(
    `\n${chalk.bold("Results")}: ${chalk.green(`${passingCount} passed`)}` +
      `, ${chalk.red(`${failingReports.length} failed`)}`
  );

  // Phase 2: Rewrite suggestions for failing pairs
  const rewriteSuggestions = await generateRewrites(failingReports, skills, tracked, ctx, options);

  // Phase 3: Scope overload checks on all skills
  const analyzer = new ShardAnalyzer({ provider: tracked, model: ctx.model });
  const shardFindings = await runShardAnalysis(skills, analyzer, options.force ?? false, options);

  // Apply fixes
  if (options.fix) {
    await applyFixes(rewriteSuggestions, shardFindings, ctx.skillsDir);
  } else if (
    !options.json &&
    (rewriteSuggestions.length > 0 || shardFindings.some((f) => f.plan))
  ) {
    console.log(
      chalk.dim(
        "\nThese are suggestions only — no files have been modified.\n" +
          "Use --fix to apply rewrites and shard plans."
      )
    );
  }

  // Save report
  const overallAccuracy =
    selectedPairs.length > 0 ? Math.round((passingCount / selectedPairs.length) * 100) : 100;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const lintData: LintData = {
    failingReports,
    passingCount,
    rewriteSuggestions: rewriteSuggestions.map((s) => ({
      skillName: s.skillName,
      originalDescription: s.originalDescription,
      rewrittenDescription: s.rewrittenDescription,
      reasoning: s.reasoning,
      conflictsWith: s.conflictsWith,
    })),
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: skills.map((s) => s.name).join(", "),
    neighborsTested: selectedPairs.length,
    passingCount,
    failingCount: failingReports.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: options.fix ? shardFindings.some((f) => f.plan) : false,
  });

  const reportDir = resolvePath(ctx.config.output.reportDir);
  const metadata = collector.finalize(tracked);
  const stored = saveRun("lint", metadata, lintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (failingReports.length > 0 || overloaded.length > 0) {
    process.exitCode = 1;
  }
}

// ── Single-skill lint (--skill <name>) ────────────────────────

async function runSingleSkillLint(
  options: LintOptions,
  skills: Skill[],
  ctx: LintContext
): Promise<void> {
  const skillName = options.skill!;
  const maxNeighbors = parseInt(options.neighbors || "5", 10);

  // Find the target skill
  const target = skills.find(
    (s) => s.name === skillName || s.name.toLowerCase() === skillName.toLowerCase()
  );

  if (!target) {
    console.error(
      chalk.red(`Skill "${skillName}" not found.\n`) +
        `Available skills: ${skills.map((s) => s.name).join(", ")}`
    );
    process.exit(1);
  }

  // Find closest neighbors
  const neighbors = selectNeighbors(target, skills, maxNeighbors, options.enhanced ?? false);

  if (neighbors.length === 0) {
    console.log(chalk.green(`No neighbors found for "${target.name}". Fleet looks clean.`));
    process.exit(0);
  }

  console.log(`\nLinting ${chalk.bold(target.name)} against ${neighbors.length} neighbors`);
  console.log(
    chalk.dim(
      `Threshold: ${ctx.threshold}% | Prompts per pair: ${ctx.promptsPerPair} | Model: ${ctx.model}\n`
    )
  );

  if (options.dryRun) {
    console.log(chalk.bold("Dry run — neighbors that would be tested:\n"));
    const table = new Table({
      head: ["Neighbor", "Overlap Score", "Reason"],
      colWidths: [30, 15, 55],
      style: { head: [] },
    });
    for (const n of neighbors) {
      table.push([n.skillB.name, `${(n.overlapScore * 100).toFixed(0)}%`, n.reason]);
    }
    console.log(table.toString());
    printDryRunScopeChecks([target]);
    console.log(chalk.dim(`\nNo API calls made.`));
    return;
  }

  const providerName = detectProvider(ctx.model);
  const innerProvider = createProvider(ctx.model, ctx.config);
  const tracked = new TrackedProvider(innerProvider);
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);

  const generator = new PromptGenerator({ provider: tracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: tracked,
    model: ctx.model,
    concurrency: ctx.concurrency,
  });

  // Phase 1: Test against neighbors
  const { failingReports, passingCount } = await testPairs(
    neighbors.map((n) => ({ skillA: n.skillA, skillB: n.skillB })),
    skills,
    generator,
    simulator,
    ctx
  );

  // Summary after testing
  console.log(
    `\n${chalk.bold("Results")}: ${chalk.green(`${passingCount} passed`)}` +
      `, ${chalk.red(`${failingReports.length} failed`)}`
  );

  // Phase 2: Rewrite suggestions for failing pairs
  const rewriteSuggestions = await generateRewrites(failingReports, skills, tracked, ctx, options);

  // Phase 3: Scope overload check on target skill
  const analyzer = new ShardAnalyzer({ provider: tracked, model: ctx.model });
  const shardFindings = await runShardAnalysis([target], analyzer, options.force ?? false, options);

  // Apply fixes
  if (options.fix) {
    await applyFixes(rewriteSuggestions, shardFindings, ctx.skillsDir);
  } else if (
    !options.json &&
    (rewriteSuggestions.length > 0 || shardFindings.some((f) => f.plan))
  ) {
    console.log(
      chalk.dim(
        "\nThese are suggestions only — no files have been modified.\n" +
          "Use --fix to apply rewrites and shard plans."
      )
    );
  }

  // Save report
  const totalPairs = neighbors.length;
  const overallAccuracy = totalPairs > 0 ? Math.round((passingCount / totalPairs) * 100) : 100;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const lintData: LintData = {
    failingReports,
    passingCount,
    rewriteSuggestions: rewriteSuggestions.map((s) => ({
      skillName: s.skillName,
      originalDescription: s.originalDescription,
      rewrittenDescription: s.rewrittenDescription,
      reasoning: s.reasoning,
      conflictsWith: s.conflictsWith,
    })),
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: target.name,
    neighborsTested: totalPairs,
    passingCount,
    failingCount: failingReports.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: options.fix ? shardFindings.some((f) => f.plan) : false,
  });

  const reportDir = resolvePath(ctx.config.output.reportDir);
  const metadata = collector.finalize(tracked);
  const stored = saveRun("lint", metadata, lintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (failingReports.length > 0 || overloaded.length > 0) {
    process.exitCode = 1;
  }
}

// ── Shared helpers ────────────────────────────────────────────

interface PairInput {
  skillA: Skill;
  skillB: Skill;
}

async function testPairs(
  pairs: PairInput[],
  allSkills: Skill[],
  generator: PromptGenerator,
  simulator: RoutingSimulator,
  ctx: LintContext
): Promise<{ failingReports: PairConflictReport[]; passingCount: number }> {
  const failingReports: PairConflictReport[] = [];
  let passingCount = 0;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const pairLabel = `${pair.skillA.name} ↔ ${pair.skillB.name}`;
    const spinner = ora(`[${i + 1}/${pairs.length}] Testing: ${pairLabel}`).start();

    try {
      const prompts = await generator.generate(pair.skillA, pair.skillB, ctx.promptsPerPair);
      const decisions = await simulator.simulateBatch(prompts, allSkills, (completed, total) => {
        spinner.text = `[${i + 1}/${pairs.length}] ${pairLabel} — routing ${completed}/${total}`;
      });

      const report = scorePair(pair.skillA.name, pair.skillB.name, decisions);
      const passed = report.routingAccuracy >= ctx.threshold;

      if (passed) {
        passingCount++;
        spinner.succeed(`${pairLabel} — ${chalk.green("PASS")} (${report.routingAccuracy}%)`);
      } else {
        failingReports.push(report);
        spinner.fail(
          `${pairLabel} — ${chalk.red("FAIL")} (${report.routingAccuracy}%, need ${ctx.threshold}%)`
        );
      }
    } catch (err) {
      spinner.fail(`${pairLabel} — Error: ${(err as Error).message}`);
    }
  }

  return { failingReports, passingCount };
}

interface RewriteResult {
  skillName: string;
  originalDescription: string;
  rewrittenDescription: string;
  reasoning: string;
  conflictsWith: string[];
  skill: Skill;
}

async function generateRewrites(
  failingReports: PairConflictReport[],
  skills: Skill[],
  tracked: TrackedProvider,
  ctx: LintContext,
  options: LintOptions
): Promise<RewriteResult[]> {
  if (failingReports.length === 0) return [];

  console.log(`\n${chalk.bold("Generating rewrite suggestions")} for failing pairs...\n`);

  const rewriter = new DescriptionRewriter({ provider: tracked, model: ctx.model });

  // Group conflicts by skill
  const conflictsBySkill = new Map<string, PairConflictReport[]>();
  for (const report of failingReports) {
    if (!conflictsBySkill.has(report.skillA)) conflictsBySkill.set(report.skillA, []);
    if (!conflictsBySkill.has(report.skillB)) conflictsBySkill.set(report.skillB, []);
    conflictsBySkill.get(report.skillA)!.push(report);
    conflictsBySkill.get(report.skillB)!.push(report);
  }

  const rewriteTargets = pickRewriteTargets(failingReports, skills);
  const results: RewriteResult[] = [];

  for (const target of rewriteTargets) {
    const conflicts = conflictsBySkill.get(target.name) || [];
    const spinner = ora(`Rewriting: ${target.name}`).start();

    try {
      const suggestion = await rewriter.rewrite(target, conflicts);

      results.push({
        skillName: target.name,
        originalDescription: suggestion.originalDescription,
        rewrittenDescription: suggestion.rewrittenDescription,
        reasoning: suggestion.reasoning,
        conflictsWith: suggestion.conflictsWith,
        skill: target,
      });

      if (options.json) {
        spinner.succeed(`Rewrite for ${chalk.bold(target.name)}`);
        console.log(JSON.stringify(suggestion, null, 2));
      } else {
        printDiff(suggestion.originalDescription, suggestion.rewrittenDescription, target.name);
        console.log(chalk.dim(`  Reasoning: ${suggestion.reasoning}`));
        console.log(chalk.dim(`  Conflicts with: ${suggestion.conflictsWith.join(", ")}`));
      }

      spinner.succeed(`Rewrite suggestion for ${chalk.bold(target.name)}`);
      if (!options.json) console.log("");
    } catch (err) {
      spinner.fail(`Rewrite failed for ${target.name}: ${(err as Error).message}`);
    }
  }

  return results;
}

async function runShardAnalysis(
  skills: Skill[],
  analyzer: ShardAnalyzer,
  force: boolean,
  options: LintOptions
): Promise<ShardFinding[]> {
  const findings: ShardFinding[] = [];

  for (const skill of skills) {
    const overload = analyzer.analyzeOverload(skill);

    if (!overload.isOverloaded && !force) continue;

    const finding: ShardFinding = {
      skillName: skill.name,
      descriptionLength: overload.descriptionLength,
      isOverloaded: overload.isOverloaded,
      reason: overload.reason,
      overloadResult: overload,
    };

    if (overload.isOverloaded || force) {
      console.log(
        chalk.yellow(`\n"${skill.name}" is overloaded`) +
          chalk.dim(` (${overload.descriptionLength} chars)`)
      );
      console.log(chalk.dim(`Reason: ${overload.reason}`));

      const spinner = ora(`Generating shard plan for ${skill.name}...`).start();
      try {
        const plan = await analyzer.generateShardPlan(skill);
        finding.plan = plan;
        spinner.succeed(`Shard plan generated for ${chalk.bold(skill.name)}`);

        if (!options.json) {
          printShardPlan(plan);
        }
      } catch (err) {
        spinner.fail(`Shard plan failed for ${skill.name}: ${(err as Error).message}`);
      }
    }

    findings.push(finding);
  }

  if (findings.length > 0 && !options.json) {
    const overloadedCount = findings.filter((f) => f.isOverloaded).length;
    if (overloadedCount > 0) {
      console.log(
        `\n${chalk.bold("Scope overload")}: ${chalk.yellow(`${overloadedCount} skill${overloadedCount !== 1 ? "s" : ""} overloaded`)}`
      );
    }
  }

  return findings;
}

async function applyFixes(
  rewrites: RewriteResult[],
  shardFindings: ShardFinding[],
  skillsDir: string
): Promise<void> {
  let fixedCount = 0;

  // Apply description rewrites
  for (const rewrite of rewrites) {
    if (rewrite.rewrittenDescription) {
      applyRewrite(rewrite.skill, rewrite.rewrittenDescription);
      fixedCount++;
      console.log(chalk.green(`  ✓ Rewrote ${rewrite.skillName}`));
    }
  }

  // Apply shard plans
  for (const finding of shardFindings) {
    if (finding.plan) {
      console.log(chalk.bold(`\nWriting shard files for ${finding.skillName}...\n`));
      const result = writeShardPlan(finding.plan, skillsDir);
      for (const file of result.filesWritten) {
        console.log(chalk.green(`  ✓ ${file}`));
      }
      console.log(
        chalk.dim(
          `\n${result.filesWritten.length} files written.` +
            ` The original "${finding.skillName}" skill was NOT modified — remove it manually if desired.`
        )
      );
    }
  }

  if (fixedCount > 0) {
    console.log(chalk.green(`\n${fixedCount} skill description(s) updated.`));
  }

  if (rewrites.length === 0 && shardFindings.filter((f) => f.plan).length === 0) {
    console.log(chalk.dim("No fixes to apply."));
  }
}

function printDryRunScopeChecks(skills: Skill[]): void {
  console.log(chalk.bold("\nScope overload checks:"));
  for (const skill of skills) {
    const len = skill.description.length;
    const flag = len > 1024 ? chalk.yellow("⚠ overloaded") : chalk.green("✓ ok");
    console.log(`  ${skill.name}: ${len} chars ${flag}`);
  }
}

function printShardPlan(plan: ShardPlan): void {
  console.log(chalk.bold("\n  Shard Plan"));
  console.log(
    chalk.dim(`  Original: ${plan.originalSkill.name} (${plan.descriptionLength} chars)`)
  );

  console.log(chalk.bold("\n  Identified Intents:"));
  for (const intent of plan.identifiedIntents) {
    console.log(`    • ${intent}`);
  }

  console.log(chalk.bold("\n  Sub-Skills:"));
  for (const sub of plan.subSkills) {
    console.log(chalk.cyan(`\n    ${sub.name}`));
    console.log(`    ${sub.description}`);
    if (sub.negativeTriggers.length > 0) {
      console.log(chalk.dim(`    Negative triggers:`));
      for (const trigger of sub.negativeTriggers) {
        console.log(chalk.dim(`      - ${trigger}`));
      }
    }
  }

  console.log(chalk.bold("\n  Orchestrator:"));
  console.log(chalk.cyan(`    ${plan.orchestrator.name}`));
  console.log(`    ${plan.orchestrator.description}`);
  if (plan.orchestrator.negativeTriggers.length > 0) {
    console.log(chalk.dim(`    Negative triggers:`));
    for (const trigger of plan.orchestrator.negativeTriggers) {
      console.log(chalk.dim(`      - ${trigger}`));
    }
  }
}

function pickRewriteTargets(reports: PairConflictReport[], skills: Skill[]): Skill[] {
  // Count how many conflicts each skill appears in
  const conflictCounts = new Map<string, number>();
  for (const report of reports) {
    conflictCounts.set(report.skillA, (conflictCounts.get(report.skillA) || 0) + 1);
    conflictCounts.set(report.skillB, (conflictCounts.get(report.skillB) || 0) + 1);
  }

  // Sort by conflict count descending — fix the worst offenders first
  const ranked = [...conflictCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Return unique skills, capped at 5 to keep output manageable
  const targets: Skill[] = [];
  for (const [name] of ranked) {
    const skill = skills.find((s) => s.name === name);
    if (skill && targets.length < 5) {
      targets.push(skill);
    }
  }

  return targets;
}

function printDiff(original: string, rewritten: string, skillName: string): void {
  console.log(`\n  ${chalk.bold(skillName)} description:`);
  console.log(chalk.red(`  - ${original}`));
  console.log(chalk.green(`  + ${rewritten}`));
}

export function applyRewrite(skill: Skill, newDescription: string): void {
  const raw = readFileSync(skill.filePath, "utf-8");
  const { data: frontmatter, content: body } = matter(raw);
  frontmatter.description = newDescription;
  const updated = matter.stringify(body, frontmatter);
  writeFileSync(skill.filePath, updated);
}

function sanitizeLintArgs(options: LintOptions): Record<string, unknown> {
  return {
    prompts: options.prompts ?? "50",
    threshold: options.threshold ?? "90",
    fix: options.fix ?? false,
    dryRun: options.dryRun ?? false,
    enhanced: options.enhanced ?? false,
    skill: options.skill ?? null,
    neighbors: options.neighbors ?? "5",
    force: options.force ?? false,
  };
}
