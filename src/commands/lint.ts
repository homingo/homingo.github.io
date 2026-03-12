import { readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import Table from "cli-table3";
import matter from "gray-matter";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { createDualProviders, detectProvider } from "../providers/index.js";
import type { TrackedProvider } from "../providers/index.js";
import { PairCache } from "../cache/pair-cache.js";
import { parseSkills } from "../skills/parser.js";
import { selectPairs, selectNeighbors } from "../shadow-router/pair-selector.js";
import { PromptGenerator } from "../shadow-router/generator.js";
import { RoutingSimulator } from "../shadow-router/simulator.js";
import { scorePair } from "../shadow-router/scorer.js";
import { DescriptionRewriter } from "../rewriter/rewriter.js";
import type { RewriteContext } from "../rewriter/rewriter.js";
import { ShardAnalyzer } from "../shard/analyzer.js";
import { writeShardPlan } from "../shard/writer.js";
import { RunCollector } from "../reporting/run-metadata.js";
import { saveRun, loadRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import type { Skill, PairConflictReport, ShardPlan } from "../types.js";
import type {
  LintData,
  LintRewriteSuggestion,
  LintMergeRecommendation,
  ShardFinding,
} from "../reporting/html-renderer.js";

interface LintOptions {
  prompts?: string;
  threshold?: string;
  model?: string;
  simModel?: string;
  cache?: boolean;
  concurrency?: string;
  json?: boolean;
  fix?: boolean | string;
  dryRun?: boolean;
  enhanced?: boolean;
  skillsDir?: string;
  open?: boolean;
  skill?: string;
  pair?: string;
  neighbors?: string;
  force?: boolean;
}

export async function lintCommand(options: LintOptions): Promise<void> {
  const config = loadConfig();
  const skillsDir = resolvePath(options.skillsDir || config.skillsDir);
  const model = options.model || config.model;
  const simModel = options.simModel ?? config.simModel;
  const promptsPerPair = parseInt(options.prompts || "10", 10);
  const threshold = parseInt(options.threshold || "90", 10);
  const concurrency = parseInt(options.concurrency || "5", 10);

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

  // Validate mutual exclusivity of --skill and --pair
  if (options.skill && options.pair) {
    console.error(chalk.red("Cannot use --skill and --pair together. Choose one."));
    process.exit(1);
  }

  // --fix <run-id> — resume from a previous run's failures
  if (typeof options.fix === "string") {
    if (options.skill || options.pair) {
      console.error(
        chalk.red(
          "Cannot use --skill or --pair with --fix <run-id>. The pairs come from the stored run."
        )
      );
      process.exit(1);
    }
    await runFixFromRun(options, skills, {
      skillsDir,
      model,
      simModel,
      promptsPerPair,
      threshold,
      concurrency,
      config,
    });
    return;
  }

  // Route to the correct mode
  if (options.pair) {
    await runPairLint(options, skills, {
      skillsDir,
      model,
      simModel,
      promptsPerPair,
      threshold,
      concurrency,
      config,
    });
  } else if (options.skill) {
    await runSingleSkillLint(options, skills, {
      skillsDir,
      model,
      simModel,
      promptsPerPair,
      threshold,
      concurrency,
      config,
    });
  } else {
    await runFleetLint(options, skills, {
      skillsDir,
      model,
      simModel,
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
  simModel?: string;
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
  const dual = createDualProviders(ctx.model, ctx.config, ctx.simModel);
  const { primaryTracked, simTracked } = dual;
  const simLabel =
    dual.simModel !== ctx.model ? `${dual.simModel} (${dual.simModelSource})` : ctx.model;
  console.log(
    chalk.dim(`Model: ${ctx.model} | Sim: ${simLabel} | Prompts/pair: ${ctx.promptsPerPair}\n`)
  );

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
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);
  if (dual.simModel !== ctx.model) collector.setSimModel(dual.simModel);

  const generator = new PromptGenerator({ provider: primaryTracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: simTracked,
    model: dual.simModel,
    concurrency: ctx.concurrency,
  });

  // Set up cache
  const useCache = options.cache !== false;
  const cache = useCache ? new PairCache() : null;
  if (cache) cache.prune();

  // Phase 1: Test all pairs
  const { failingReports, passingCount, errorCount, cacheHits } = await testPairs(
    selectedPairs.map((p) => ({ skillA: p.skillA, skillB: p.skillB })),
    skills,
    generator,
    simulator,
    ctx,
    cache,
    dual.simModel
  );

  if (cacheHits > 0) {
    console.log(chalk.dim(`  ${cacheHits} pair${cacheHits !== 1 ? "s" : ""} loaded from cache`));
  }

  // Summary after testing
  let summary =
    `\n${chalk.bold("Results")}: ${chalk.green(`${passingCount} passed`)}` +
    `, ${chalk.red(`${failingReports.length} failed`)}`;
  if (errorCount > 0) {
    summary += `, ${chalk.yellow(`${errorCount} errored`)}`;
  }
  console.log(summary);

  // Phase 2: Rewrite suggestions (iterative when --fix)
  let finalFailing = failingReports;
  let finalPassing = passingCount;
  let rewriteSuggestions: RewriteResult[];
  let mergeRecommendations: LintMergeRecommendation[];

  if (options.fix && failingReports.length > 0) {
    const iterResult = await iterativeRewriteLoop(
      failingReports,
      passingCount,
      skills,
      generator,
      simulator,
      primaryTracked,
      ctx,
      options
    );
    finalFailing = iterResult.failingReports;
    finalPassing = iterResult.passingCount;
    rewriteSuggestions = iterResult.rewriteSuggestions;
    mergeRecommendations = iterResult.mergeRecommendations;
  } else {
    const result = await generateRewrites(failingReports, skills, primaryTracked, ctx, options);
    rewriteSuggestions = result.rewrites;
    mergeRecommendations = result.merges;
  }

  // Phase 3: Scope overload checks on all skills
  const analyzer = new ShardAnalyzer({ provider: primaryTracked, model: ctx.model });
  const shardFindings = await runShardAnalysis(skills, analyzer, options.force ?? false, options);

  // Apply shard plans (rewrites already applied in iterative loop when --fix)
  if (options.fix) {
    await applyShardsOnly(shardFindings, ctx.skillsDir);
  } else if (
    !options.json &&
    (rewriteSuggestions.length > 0 ||
      mergeRecommendations.length > 0 ||
      shardFindings.some((f) => f.plan))
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
    selectedPairs.length > 0 ? Math.round((finalPassing / selectedPairs.length) * 100) : 100;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const lintData: LintData = {
    failingReports: finalFailing,
    passingCount: finalPassing,
    rewriteSuggestions: consolidateRewrites(rewriteSuggestions),
    appliedRewrites: !!options.fix,
    mergeRecommendations,
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: skills.map((s) => s.name).join(", "),
    neighborsTested: selectedPairs.length,
    passingCount: finalPassing,
    failingCount: finalFailing.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: options.fix ? shardFindings.some((f) => f.plan) : false,
  });
  if (cacheHits > 0) collector.setCacheHits(cacheHits);

  const reportDir = resolvePath(ctx.config.output.reportDir);
  const metadata = collector.finalize(dual.combinedUsage());
  const stored = saveRun("lint", metadata, lintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (failingReports.length > 0 || overloaded.length > 0 || errorCount > 0) {
    process.exitCode = 1;
  }
}

// ── Pair lint (--pair skillA,skillB) ──────────────────────────

async function runPairLint(options: LintOptions, skills: Skill[], ctx: LintContext): Promise<void> {
  const pairValue = options.pair!;

  // Parse and validate pair names
  if (!pairValue.includes(",")) {
    console.error(
      chalk.red(`Invalid --pair format: "${pairValue}"\n`) +
        `Expected: --pair skillA,skillB (comma-separated)`
    );
    process.exit(1);
  }

  const [nameA, nameB] = pairValue.split(",").map((s) => s.trim());
  if (!nameA || !nameB) {
    console.error(
      chalk.red(`Invalid --pair format: "${pairValue}"\n`) +
        `Expected: --pair skillA,skillB (comma-separated)`
    );
    process.exit(1);
  }

  const skillA = skills.find(
    (s) => s.name === nameA || s.name.toLowerCase() === nameA.toLowerCase()
  );
  const skillB = skills.find(
    (s) => s.name === nameB || s.name.toLowerCase() === nameB.toLowerCase()
  );

  if (!skillA) {
    console.error(
      chalk.red(`Skill "${nameA}" not found.\n`) +
        `Available skills: ${skills.map((s) => s.name).join(", ")}`
    );
    process.exit(1);
  }
  if (!skillB) {
    console.error(
      chalk.red(`Skill "${nameB}" not found.\n`) +
        `Available skills: ${skills.map((s) => s.name).join(", ")}`
    );
    process.exit(1);
  }

  const dual = createDualProviders(ctx.model, ctx.config, ctx.simModel);
  const { primaryTracked, simTracked } = dual;
  const simLabel =
    dual.simModel !== ctx.model ? `${dual.simModel} (${dual.simModelSource})` : ctx.model;
  console.log(`\nLinting pair: ${chalk.bold(skillA.name)} ↔ ${chalk.bold(skillB.name)}`);
  console.log(
    chalk.dim(
      `Threshold: ${ctx.threshold}% | Model: ${ctx.model} | Sim: ${simLabel} | Prompts/pair: ${ctx.promptsPerPair}\n`
    )
  );

  if (options.dryRun) {
    console.log(chalk.bold("Dry run — pair that would be tested:\n"));
    console.log(`  ${skillA.name} ↔ ${skillB.name}`);
    printDryRunScopeChecks([skillA, skillB]);
    console.log(chalk.dim(`\nNo API calls made.`));
    return;
  }

  const providerName = detectProvider(ctx.model);
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);
  if (dual.simModel !== ctx.model) collector.setSimModel(dual.simModel);

  const generator = new PromptGenerator({ provider: primaryTracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: simTracked,
    model: dual.simModel,
    concurrency: ctx.concurrency,
  });

  // Set up cache
  const useCache = options.cache !== false;
  const cache = useCache ? new PairCache() : null;
  if (cache) cache.prune();

  // Phase 1: Test the pair
  const { failingReports, passingCount, errorCount, cacheHits } = await testPairs(
    [{ skillA, skillB }],
    skills,
    generator,
    simulator,
    ctx,
    cache,
    dual.simModel
  );

  if (cacheHits > 0) {
    console.log(chalk.dim(`  ${cacheHits} pair${cacheHits !== 1 ? "s" : ""} loaded from cache`));
  }

  // Summary after testing
  let summary =
    `\n${chalk.bold("Results")}: ${chalk.green(`${passingCount} passed`)}` +
    `, ${chalk.red(`${failingReports.length} failed`)}`;
  if (errorCount > 0) {
    summary += `, ${chalk.yellow(`${errorCount} errored`)}`;
  }
  console.log(summary);

  // Phase 2: Rewrite suggestions (iterative when --fix)
  let finalFailing = failingReports;
  let finalPassing = passingCount;
  let rewriteSuggestions: RewriteResult[];
  let mergeRecommendations: LintMergeRecommendation[];

  if (options.fix && failingReports.length > 0) {
    const iterResult = await iterativeRewriteLoop(
      failingReports,
      passingCount,
      skills,
      generator,
      simulator,
      primaryTracked,
      ctx,
      options
    );
    finalFailing = iterResult.failingReports;
    finalPassing = iterResult.passingCount;
    rewriteSuggestions = iterResult.rewriteSuggestions;
    mergeRecommendations = iterResult.mergeRecommendations;
  } else {
    const result = await generateRewrites(failingReports, skills, primaryTracked, ctx, options);
    rewriteSuggestions = result.rewrites;
    mergeRecommendations = result.merges;
  }

  // Phase 3: Scope overload check on both skills
  const analyzer = new ShardAnalyzer({ provider: primaryTracked, model: ctx.model });
  const shardFindings = await runShardAnalysis(
    [skillA, skillB],
    analyzer,
    options.force ?? false,
    options
  );

  // Apply shard plans (rewrites already applied in iterative loop when --fix)
  if (options.fix) {
    await applyShardsOnly(shardFindings, ctx.skillsDir);
  } else if (
    !options.json &&
    (rewriteSuggestions.length > 0 ||
      mergeRecommendations.length > 0 ||
      shardFindings.some((f) => f.plan))
  ) {
    console.log(
      chalk.dim(
        "\nThese are suggestions only — no files have been modified.\n" +
          "Use --fix to apply rewrites and shard plans."
      )
    );
  }

  // Save report
  const overallAccuracy = finalPassing > 0 ? 100 : 0;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const lintData: LintData = {
    failingReports: finalFailing,
    passingCount: finalPassing,
    rewriteSuggestions: consolidateRewrites(rewriteSuggestions),
    appliedRewrites: !!options.fix,
    mergeRecommendations,
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: `${skillA.name},${skillB.name}`,
    neighborsTested: 1,
    passingCount: finalPassing,
    failingCount: finalFailing.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: options.fix ? shardFindings.some((f) => f.plan) : false,
  });
  if (cacheHits > 0) collector.setCacheHits(cacheHits);

  const reportDir = resolvePath(ctx.config.output.reportDir);
  const metadata = collector.finalize(dual.combinedUsage());
  const stored = saveRun("lint", metadata, lintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (failingReports.length > 0 || overloaded.length > 0 || errorCount > 0) {
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

  const dual = createDualProviders(ctx.model, ctx.config, ctx.simModel);
  const { primaryTracked, simTracked } = dual;
  const simLabel =
    dual.simModel !== ctx.model ? `${dual.simModel} (${dual.simModelSource})` : ctx.model;
  console.log(`\nLinting ${chalk.bold(target.name)} against ${neighbors.length} neighbors`);
  console.log(
    chalk.dim(
      `Threshold: ${ctx.threshold}% | Model: ${ctx.model} | Sim: ${simLabel} | Prompts/pair: ${ctx.promptsPerPair}\n`
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
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);
  if (dual.simModel !== ctx.model) collector.setSimModel(dual.simModel);

  const generator = new PromptGenerator({ provider: primaryTracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: simTracked,
    model: dual.simModel,
    concurrency: ctx.concurrency,
  });

  // Set up cache
  const useCache = options.cache !== false;
  const cache = useCache ? new PairCache() : null;
  if (cache) cache.prune();

  // Phase 1: Test against neighbors
  const { failingReports, passingCount, errorCount, cacheHits } = await testPairs(
    neighbors.map((n) => ({ skillA: n.skillA, skillB: n.skillB })),
    skills,
    generator,
    simulator,
    ctx,
    cache,
    dual.simModel
  );

  if (cacheHits > 0) {
    console.log(chalk.dim(`  ${cacheHits} pair${cacheHits !== 1 ? "s" : ""} loaded from cache`));
  }

  // Summary after testing
  let summary =
    `\n${chalk.bold("Results")}: ${chalk.green(`${passingCount} passed`)}` +
    `, ${chalk.red(`${failingReports.length} failed`)}`;
  if (errorCount > 0) {
    summary += `, ${chalk.yellow(`${errorCount} errored`)}`;
  }
  console.log(summary);

  // Phase 2: Rewrite suggestions (iterative when --fix)
  let finalFailing = failingReports;
  let finalPassing = passingCount;
  let rewriteSuggestions: RewriteResult[];
  let mergeRecommendations: LintMergeRecommendation[];

  if (options.fix && failingReports.length > 0) {
    const iterResult = await iterativeRewriteLoop(
      failingReports,
      passingCount,
      skills,
      generator,
      simulator,
      primaryTracked,
      ctx,
      options
    );
    finalFailing = iterResult.failingReports;
    finalPassing = iterResult.passingCount;
    rewriteSuggestions = iterResult.rewriteSuggestions;
    mergeRecommendations = iterResult.mergeRecommendations;
  } else {
    const result = await generateRewrites(failingReports, skills, primaryTracked, ctx, options);
    rewriteSuggestions = result.rewrites;
    mergeRecommendations = result.merges;
  }

  // Phase 3: Scope overload check on target skill
  const analyzer = new ShardAnalyzer({ provider: primaryTracked, model: ctx.model });
  const shardFindings = await runShardAnalysis([target], analyzer, options.force ?? false, options);

  // Apply shard plans (rewrites already applied in iterative loop when --fix)
  if (options.fix) {
    await applyShardsOnly(shardFindings, ctx.skillsDir);
  } else if (
    !options.json &&
    (rewriteSuggestions.length > 0 ||
      mergeRecommendations.length > 0 ||
      shardFindings.some((f) => f.plan))
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
  const overallAccuracy = totalPairs > 0 ? Math.round((finalPassing / totalPairs) * 100) : 100;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const lintData: LintData = {
    failingReports: finalFailing,
    passingCount: finalPassing,
    rewriteSuggestions: consolidateRewrites(rewriteSuggestions),
    appliedRewrites: !!options.fix,
    mergeRecommendations,
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: target.name,
    neighborsTested: totalPairs,
    passingCount: finalPassing,
    failingCount: finalFailing.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: options.fix ? shardFindings.some((f) => f.plan) : false,
  });
  if (cacheHits > 0) collector.setCacheHits(cacheHits);

  const reportDir = resolvePath(ctx.config.output.reportDir);
  const metadata = collector.finalize(dual.combinedUsage());
  const stored = saveRun("lint", metadata, lintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (failingReports.length > 0 || overloaded.length > 0 || errorCount > 0) {
    process.exitCode = 1;
  }
}

// ── Fix from previous run (--fix <run-id>) ───────────────────

async function runFixFromRun(
  options: LintOptions,
  skills: Skill[],
  ctx: LintContext
): Promise<void> {
  const runId = options.fix as string;
  const reportDir = resolvePath(ctx.config.output.reportDir);

  console.log(`\nLoading previous lint run: ${chalk.bold(runId)}`);

  let storedData;
  try {
    storedData = loadRun("lint", runId, reportDir);
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  const lintData = storedData.data as LintData;

  if (lintData.failingReports.length === 0) {
    console.log(chalk.green("Previous run had no failing pairs. Nothing to fix."));
    return;
  }

  // Validate that all skills from failing pairs still exist
  const missingSkills: string[] = [];
  for (const report of lintData.failingReports) {
    if (!skills.find((s) => s.name === report.skillA)) missingSkills.push(report.skillA);
    if (!skills.find((s) => s.name === report.skillB)) missingSkills.push(report.skillB);
  }
  const uniqueMissing = [...new Set(missingSkills)];
  if (uniqueMissing.length > 0) {
    console.error(
      chalk.red(`Skills not found in current fleet: ${uniqueMissing.join(", ")}.\n`) +
        `These skills may have been renamed or removed since the previous run.`
    );
    process.exit(1);
  }

  console.log(
    `Found ${chalk.bold(String(lintData.failingReports.length))} failing pair${lintData.failingReports.length !== 1 ? "s" : ""} from previous run`
  );
  for (const r of lintData.failingReports) {
    console.log(chalk.dim(`  ${r.skillA} ↔ ${r.skillB} (${r.routingAccuracy}%)`));
  }
  console.log(chalk.dim(`\nSkipping initial test — jumping straight to iterative fix.\n`));

  const dual = createDualProviders(ctx.model, ctx.config, ctx.simModel);
  const { primaryTracked, simTracked } = dual;
  const providerName = detectProvider(ctx.model);
  const collector = new RunCollector("lint", sanitizeLintArgs(options), ctx.model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);
  if (dual.simModel !== ctx.model) collector.setSimModel(dual.simModel);

  const generator = new PromptGenerator({ provider: primaryTracked, model: ctx.model });
  const simulator = new RoutingSimulator({
    provider: simTracked,
    model: dual.simModel,
    concurrency: ctx.concurrency,
  });

  // Jump straight into iterative rewrite loop
  const iterResult = await iterativeRewriteLoop(
    lintData.failingReports,
    lintData.passingCount,
    skills,
    generator,
    simulator,
    primaryTracked,
    ctx,
    options
  );

  // Scope overload checks on skills involved in failing pairs
  const involvedSkillNames = new Set<string>();
  for (const report of lintData.failingReports) {
    involvedSkillNames.add(report.skillA);
    involvedSkillNames.add(report.skillB);
  }
  const skillsToCheck = skills.filter((s) => involvedSkillNames.has(s.name));

  const analyzer = new ShardAnalyzer({ provider: primaryTracked, model: ctx.model });
  const shardFindings = await runShardAnalysis(
    skillsToCheck,
    analyzer,
    options.force ?? false,
    options
  );
  await applyShardsOnly(shardFindings, ctx.skillsDir);

  // Save report
  const totalPairs = lintData.failingReports.length + lintData.passingCount;
  const overallAccuracy =
    totalPairs > 0 ? Math.round((iterResult.passingCount / totalPairs) * 100) : 100;
  const overloaded = shardFindings.filter((f) => f.isOverloaded);

  const newLintData: LintData = {
    failingReports: iterResult.failingReports,
    passingCount: iterResult.passingCount,
    rewriteSuggestions: consolidateRewrites(iterResult.rewriteSuggestions),
    appliedRewrites: true, // runFixFromRun always applies rewrites
    mergeRecommendations: iterResult.mergeRecommendations,
    shardFindings,
  };

  collector.setResult({
    type: "lint",
    targetSkill: [...involvedSkillNames].join(", "),
    neighborsTested: lintData.failingReports.length,
    passingCount: iterResult.passingCount,
    failingCount: iterResult.failingReports.length,
    overallAccuracy,
    overloadedSkills: overloaded.length,
    shardPlansGenerated: shardFindings.filter((f) => f.plan).length,
    shardsApplied: shardFindings.some((f) => f.plan),
  });

  const metadata = collector.finalize(dual.combinedUsage());
  const stored = saveRun("lint", metadata, newLintData, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));

  if (iterResult.failingReports.length > 0 || overloaded.length > 0) {
    process.exitCode = 1;
  }
}

// ── Shared helpers ────────────────────────────────────────────

interface PairInput {
  skillA: Skill;
  skillB: Skill;
}

interface IterativeResult {
  failingReports: PairConflictReport[];
  passingCount: number;
  rewriteSuggestions: RewriteResult[];
  mergeRecommendations: LintMergeRecommendation[];
  totalIterations: number;
}

/**
 * Iterative rewrite loop for --fix mode.
 * Uses pair-level coordinated rewrites: the LLM sees BOTH descriptions
 * and can return "rewrite" (one or both) or "merge" verdicts.
 * Tracks per-pair accuracy across iterations for escalation context.
 */
async function iterativeRewriteLoop(
  initialFailingReports: PairConflictReport[],
  initialPassingCount: number,
  allSkills: Skill[],
  generator: PromptGenerator,
  simulator: RoutingSimulator,
  primaryTracked: TrackedProvider,
  ctx: LintContext,
  options: LintOptions
): Promise<IterativeResult> {
  const maxIterations = ctx.config.shadowRouter.maxIterations;
  let failingReports = initialFailingReports;
  let passingCount = initialPassingCount;
  const allRewrites: RewriteResult[] = [];
  const allMerges: LintMergeRecommendation[] = [];
  let iteration = 0;

  // Track accuracy by pair key for escalation context
  const previousAccuracyByPair = new Map<string, number>();
  for (const report of initialFailingReports) {
    previousAccuracyByPair.set(pairKey(report.skillA, report.skillB), report.routingAccuracy);
  }

  while (failingReports.length > 0 && iteration < maxIterations) {
    iteration++;
    console.log(
      chalk.bold(`\n── Iteration ${iteration}/${maxIterations} ──`) +
        chalk.dim(` ${failingReports.length} failing pair${failingReports.length !== 1 ? "s" : ""}`)
    );

    // Generate coordinated rewrites per pair
    const { rewrites, merges } = await generatePairRewrites(
      failingReports,
      allSkills,
      primaryTracked,
      ctx,
      options,
      { iteration, previousAccuracyByPair }
    );

    // Accumulate merges — remove merged pairs from the failing list
    if (merges.length > 0) {
      allMerges.push(...merges);
      const mergedPairKeys = new Set(merges.map((m) => pairKey(m.skillA, m.skillB)));
      failingReports = failingReports.filter(
        (r) => !mergedPairKeys.has(pairKey(r.skillA, r.skillB))
      );
      console.log(
        chalk.cyan(
          `  ${merges.length} pair${merges.length !== 1 ? "s" : ""} recommended for merge (removed from rewrite loop)`
        )
      );
    }

    if (rewrites.length === 0 && failingReports.length > 0) {
      console.log(chalk.yellow("No rewrite suggestions generated — stopping iteration."));
      break;
    }

    if (rewrites.length === 0) break;

    // Apply rewrites to disk AND update in-memory descriptions
    for (const rewrite of rewrites) {
      applyRewrite(rewrite.skill, rewrite.rewrittenDescription);
      rewrite.skill.description = rewrite.rewrittenDescription;
      console.log(chalk.green(`  ✓ Applied rewrite for ${rewrite.skillName}`));
    }
    allRewrites.push(...rewrites);

    if (failingReports.length === 0) break;

    // Re-test only the still-failing pairs (merges already removed)
    const pairsToRetest: PairInput[] = failingReports.map((r) => {
      const skillA = allSkills.find((s) => s.name === r.skillA)!;
      const skillB = allSkills.find((s) => s.name === r.skillB)!;
      return { skillA, skillB };
    });

    console.log(
      chalk.dim(
        `\nRe-testing ${pairsToRetest.length} pair${pairsToRetest.length !== 1 ? "s" : ""}...`
      )
    );
    const retestResult = await testPairs(pairsToRetest, allSkills, generator, simulator, ctx);

    // Update per-pair accuracy tracking for next iteration's escalation
    for (const report of retestResult.failingReports) {
      const key = pairKey(report.skillA, report.skillB);
      const prev = previousAccuracyByPair.get(key);
      if (prev !== undefined) {
        previousAccuracyByPair.set(key, report.routingAccuracy);
      }
    }

    const newlyPassing = failingReports.length - retestResult.failingReports.length;
    passingCount += newlyPassing;
    failingReports = retestResult.failingReports;

    if (newlyPassing > 0) {
      console.log(
        chalk.green(`  ${newlyPassing} pair${newlyPassing !== 1 ? "s" : ""} now passing`)
      );
    }
    if (failingReports.length > 0) {
      console.log(
        chalk.yellow(
          `  ${failingReports.length} pair${failingReports.length !== 1 ? "s" : ""} still failing`
        )
      );
    }
  }

  if (failingReports.length === 0 && allMerges.length === 0) {
    console.log(
      chalk.green(`\nAll pairs passing after ${iteration} iteration${iteration !== 1 ? "s" : ""}.`)
    );
  } else if (failingReports.length === 0 && allMerges.length > 0) {
    console.log(
      chalk.green(
        `\nAll rewritable pairs passing after ${iteration} iteration${iteration !== 1 ? "s" : ""}.`
      ) +
        chalk.cyan(
          ` ${allMerges.length} merge recommendation${allMerges.length !== 1 ? "s" : ""} to review.`
        )
    );
  } else {
    console.log(
      chalk.yellow(
        `\n${failingReports.length} pair${failingReports.length !== 1 ? "s" : ""} still failing after ${iteration} iteration${iteration !== 1 ? "s" : ""}.`
      )
    );
    if (allMerges.length > 0) {
      console.log(
        chalk.cyan(
          `${allMerges.length} merge recommendation${allMerges.length !== 1 ? "s" : ""} to review.`
        )
      );
    }
  }

  return {
    failingReports,
    passingCount,
    rewriteSuggestions: allRewrites,
    mergeRecommendations: allMerges,
    totalIterations: iteration,
  };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":::");
}

async function testPairs(
  pairs: PairInput[],
  allSkills: Skill[],
  generator: PromptGenerator,
  simulator: RoutingSimulator,
  ctx: LintContext,
  cache?: PairCache | null,
  simModel?: string
): Promise<{
  failingReports: PairConflictReport[];
  passingCount: number;
  errorCount: number;
  cacheHits: number;
}> {
  const failingReports: PairConflictReport[] = [];
  let passingCount = 0;
  let errorCount = 0;
  let cacheHits = 0;
  const effectiveSimModel = simModel ?? ctx.model;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const pairLabel = `${pair.skillA.name} ↔ ${pair.skillB.name}`;
    const spinner = ora(`[${i + 1}/${pairs.length}] Testing: ${pairLabel}`).start();

    try {
      // Check cache first
      if (cache) {
        const hash = PairCache.hashPair(
          pair.skillA.name,
          pair.skillA.description,
          pair.skillB.name,
          pair.skillB.description,
          ctx.promptsPerPair,
          effectiveSimModel
        );
        const cached = cache.get(hash);
        if (cached) {
          const report = cached.report;
          const passed = report.routingAccuracy >= ctx.threshold;
          if (passed) {
            passingCount++;
            spinner.succeed(
              `${pairLabel} — ${chalk.green("PASS")} (${report.routingAccuracy}%) ${chalk.dim("(cached)")}`
            );
          } else {
            failingReports.push(report);
            spinner.fail(
              `${pairLabel} — ${chalk.red("FAIL")} (${report.routingAccuracy}%, need ${ctx.threshold}%) ${chalk.dim("(cached)")}`
            );
          }
          cacheHits++;
          continue;
        }
      }

      const prompts = await generator.generate(pair.skillA, pair.skillB, ctx.promptsPerPair);
      // Only present the two skills being tested — the question is "does the router
      // distinguish A from B?", not "does A win against all 109 skills?".
      // Presenting the full manifest causes small/cheap models to pick a third skill
      // (a genuine better match in the fleet) and score 0% on every prompt.
      const decisions = await simulator.simulateBatch(
        prompts,
        [pair.skillA, pair.skillB],
        (completed, total) => {
          spinner.text = `[${i + 1}/${pairs.length}] ${pairLabel} — routing ${completed}/${total}`;
        }
      );

      const report = scorePair(pair.skillA.name, pair.skillB.name, decisions);
      const passed = report.routingAccuracy >= ctx.threshold;

      // Store in cache
      if (cache) {
        const hash = PairCache.hashPair(
          pair.skillA.name,
          pair.skillA.description,
          pair.skillB.name,
          pair.skillB.description,
          ctx.promptsPerPair,
          effectiveSimModel
        );
        cache.set(hash, {
          promptsPerPair: ctx.promptsPerPair,
          simModel: effectiveSimModel,
          report,
        });
      }

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
      errorCount++;
      spinner.fail(`${pairLabel} — ${chalk.red("ERROR")}: ${(err as Error).message}`);
    }
  }

  return { failingReports, passingCount, errorCount, cacheHits };
}

interface RewriteResult {
  skillName: string;
  originalDescription: string;
  rewrittenDescription: string;
  reasoning: string;
  conflictsWith: string[];
  skill: Skill;
}

/**
 * Consolidate a flat list of per-iteration RewriteResults into per-skill
 * LintRewriteSuggestions with full evolution history.
 *
 * For --fix runs: multiple RewriteResult entries per skill (one per iteration)
 * are merged into a single suggestion with history[].
 *
 * For suggestion-only runs: one entry per skill, history has one element.
 */
function consolidateRewrites(rewrites: RewriteResult[]): LintRewriteSuggestion[] {
  const bySkill = new Map<string, LintRewriteSuggestion>();
  for (const r of rewrites) {
    const existing = bySkill.get(r.skillName);
    if (!existing) {
      bySkill.set(r.skillName, {
        skillName: r.skillName,
        originalDescription: r.originalDescription, // true original (before any iteration)
        rewrittenDescription: r.rewrittenDescription,
        reasoning: r.reasoning,
        conflictsWith: [...r.conflictsWith],
        history: [{ description: r.rewrittenDescription, reasoning: r.reasoning }],
      });
    } else {
      // Subsequent iteration: extend the history and update the final description
      existing.rewrittenDescription = r.rewrittenDescription;
      existing.reasoning = r.reasoning;
      existing.history!.push({ description: r.rewrittenDescription, reasoning: r.reasoning });
      for (const c of r.conflictsWith) {
        if (!existing.conflictsWith.includes(c)) existing.conflictsWith.push(c);
      }
    }
  }
  return [...bySkill.values()];
}

interface PairRewriteIterationContext {
  iteration: number;
  previousAccuracyByPair: Map<string, number>;
}

interface GeneratePairRewritesResult {
  rewrites: RewriteResult[];
  merges: LintMergeRecommendation[];
}

async function generatePairRewrites(
  failingReports: PairConflictReport[],
  skills: Skill[],
  primaryTracked: TrackedProvider,
  ctx: LintContext,
  options: LintOptions,
  iterContext?: PairRewriteIterationContext
): Promise<GeneratePairRewritesResult> {
  if (failingReports.length === 0) return { rewrites: [], merges: [] };

  console.log(
    `\n${chalk.bold("Generating coordinated rewrites")} for ${failingReports.length} failing pair${failingReports.length !== 1 ? "s" : ""}...\n`
  );

  const rewriter = new DescriptionRewriter({ provider: primaryTracked, model: ctx.model });
  const rewrites: RewriteResult[] = [];
  const merges: LintMergeRecommendation[] = [];

  // Track updated descriptions within this batch so pair (A,C) sees A's
  // rewrite from pair (A,B) processed earlier in the same batch
  const updatedDescriptions = new Map<string, string>();

  for (const report of failingReports) {
    const skillA = skills.find((s) => s.name === report.skillA)!;
    const skillB = skills.find((s) => s.name === report.skillB)!;

    // Use updated descriptions from earlier in this batch, if available
    const effectiveA = { ...skillA };
    const effectiveB = { ...skillB };
    if (updatedDescriptions.has(skillA.name)) {
      effectiveA.description = updatedDescriptions.get(skillA.name)!;
    }
    if (updatedDescriptions.has(skillB.name)) {
      effectiveB.description = updatedDescriptions.get(skillB.name)!;
    }

    const key = pairKey(report.skillA, report.skillB);
    const previousAccuracy = iterContext?.previousAccuracyByPair.get(key);

    const rewriteContext: RewriteContext = {
      iteration: iterContext?.iteration ?? 1,
      previousAccuracy,
      currentAccuracy: report.routingAccuracy,
    };

    const pairLabel = `${report.skillA} ↔ ${report.skillB}`;
    const spinner = ora(`Analyzing pair: ${pairLabel}`).start();

    try {
      const result = await rewriter.rewritePair(effectiveA, effectiveB, report, rewriteContext);

      if (result.verdict === "merge" && result.merge) {
        merges.push({
          skillA: report.skillA,
          skillB: report.skillB,
          mergedName: result.merge.mergedName,
          mergedDescription: result.merge.mergedDescription,
          reasoning: result.reasoning,
          accuracy: report.routingAccuracy,
        });
        spinner.succeed(
          `${pairLabel} — ${chalk.cyan("MERGE")} recommended → ${chalk.bold(result.merge.mergedName)}`
        );
        if (!options.json) {
          console.log(chalk.dim(`  Reasoning: ${result.reasoning}`));
          console.log("");
        }
      } else if (result.verdict === "rewrite" && result.rewrites) {
        for (const rw of result.rewrites) {
          const skill = skills.find((s) => s.name === rw.skillName);
          if (!skill) continue;

          // Track the updated description for later pairs in this batch
          updatedDescriptions.set(rw.skillName, rw.rewrittenDescription);

          const otherSkill = rw.skillName === report.skillA ? report.skillB : report.skillA;
          rewrites.push({
            skillName: rw.skillName,
            originalDescription: rw.originalDescription,
            rewrittenDescription: rw.rewrittenDescription,
            reasoning: result.reasoning,
            conflictsWith: [otherSkill],
            skill,
          });

          if (!options.json) {
            printDiff(rw.originalDescription, rw.rewrittenDescription, rw.skillName);
          }
        }
        spinner.succeed(
          `${pairLabel} — ${chalk.green("REWRITE")} (${result.rewrites.length} skill${result.rewrites.length !== 1 ? "s" : ""})`
        );
        if (!options.json) {
          console.log(chalk.dim(`  Reasoning: ${result.reasoning}`));
          console.log("");
        }
      }
    } catch (err) {
      spinner.fail(`Rewrite failed for ${pairLabel}: ${(err as Error).message}`);
    }
  }

  return { rewrites, merges };
}

/**
 * Non-fix mode: generate rewrite suggestions (read-only) for failing pairs.
 * Uses the same pair-level approach but doesn't apply anything.
 */
async function generateRewrites(
  failingReports: PairConflictReport[],
  skills: Skill[],
  primaryTracked: TrackedProvider,
  ctx: LintContext,
  options: LintOptions
): Promise<{ rewrites: RewriteResult[]; merges: LintMergeRecommendation[] }> {
  return generatePairRewrites(failingReports, skills, primaryTracked, ctx, options);
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

async function applyShardsOnly(shardFindings: ShardFinding[], skillsDir: string): Promise<void> {
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
    prompts: options.prompts ?? "10",
    threshold: options.threshold ?? "90",
    fix: options.fix ?? false,
    fixFromRun: typeof options.fix === "string" ? options.fix : null,
    dryRun: options.dryRun ?? false,
    enhanced: options.enhanced ?? false,
    skill: options.skill ?? null,
    pair: options.pair ?? null,
    neighbors: options.neighbors ?? "5",
    force: options.force ?? false,
  };
}
