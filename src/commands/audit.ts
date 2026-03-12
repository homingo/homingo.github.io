import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { createDualProviders, detectProvider } from "../providers/index.js";
import { parseSkills } from "../skills/parser.js";
import { selectPairs } from "../shadow-router/pair-selector.js";
import { PromptGenerator } from "../shadow-router/generator.js";
import { RoutingSimulator } from "../shadow-router/simulator.js";
import { scorePair, scoreFleet } from "../shadow-router/scorer.js";
import { RunCollector } from "../reporting/run-metadata.js";
import { saveRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import { PairCache } from "../cache/pair-cache.js";
import type { PairConflictReport } from "../types.js";

interface AuditOptions {
  allPairs?: boolean;
  prompts?: string;
  model?: string;
  simModel?: string;
  cache?: boolean;
  json?: boolean;
  concurrency?: string;
  dryRun?: boolean;
  enhanced?: boolean;
  skillsDir?: string;
  open?: boolean;
}

export async function auditCommand(options: AuditOptions): Promise<void> {
  const config = loadConfig();
  const skillsDir = resolvePath(options.skillsDir || config.skillsDir);
  const model = options.model || config.model;
  const promptsPerPair = parseInt(options.prompts || "10", 10);

  // Parse skills
  const parseSpinner = ora("Parsing skills...").start();
  let skills;
  try {
    ({ skills } = await parseSkills(skillsDir));
    parseSpinner.succeed(`Found ${skills.length} skills`);
  } catch (err) {
    parseSpinner.fail((err as Error).message);
    process.exit(1);
  }

  if (skills.length < 2) {
    console.log(chalk.yellow("Need at least 2 skills to detect conflicts."));
    process.exit(0);
  }

  // Select pairs
  const pairResult = selectPairs(skills, options.allPairs, options.enhanced ?? false);
  const { selectedPairs, skippedPairs, totalPossiblePairs } = pairResult;

  if (selectedPairs.length === 0) {
    console.log(chalk.green("No overlapping skill pairs detected. Fleet looks clean."));
    process.exit(0);
  }

  // Set up dual providers (primary for generation, sim for routing)
  const simModelOverride = options.simModel ?? config.simModel;
  const dual = createDualProviders(model, config, simModelOverride);
  const { primaryTracked, simTracked, simModel, simModelSource } = dual;

  const simLabel =
    simModel !== model ? `${simModel} (${simModelSource})` : `${model} (same as primary)`;

  console.log(
    `\nTesting ${chalk.bold(String(selectedPairs.length))} pairs` +
      ` (of ${totalPossiblePairs} possible)` +
      (skippedPairs > 0 ? ` — ${skippedPairs} low-overlap pairs skipped` : "")
  );
  console.log(chalk.dim(`Model: ${model} | Sim: ${simLabel} | Prompts/pair: ${promptsPerPair}\n`));

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
    console.log(chalk.dim(`\nNo API calls made.`));
    return;
  }

  const providerName = detectProvider(model);
  const collector = new RunCollector("audit", sanitizeArgs(options), model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);
  if (simModel !== model) collector.setSimModel(simModel);

  const generator = new PromptGenerator({ provider: primaryTracked, model });
  const concurrency = parseInt(options.concurrency || "5", 10);
  const simulator = new RoutingSimulator({ provider: simTracked, model: simModel, concurrency });

  // Set up cache
  const useCache = options.cache !== false;
  const cache = useCache ? new PairCache() : null;
  if (cache) cache.prune();
  let cacheHits = 0;

  const pairReports: PairConflictReport[] = [];

  for (let i = 0; i < selectedPairs.length; i++) {
    const pair = selectedPairs[i];
    const pairLabel = `${pair.skillA.name} ↔ ${pair.skillB.name}`;
    const spinner = ora(`[${i + 1}/${selectedPairs.length}] Testing: ${pairLabel}`).start();

    try {
      // Check cache first
      if (cache) {
        const hash = PairCache.hashPair(
          pair.skillA.name,
          pair.skillA.description,
          pair.skillB.name,
          pair.skillB.description,
          promptsPerPair,
          simModel
        );
        const cached = cache.get(hash);
        if (cached) {
          pairReports.push(cached.report);
          cacheHits++;
          const report = cached.report;
          const severityColor =
            report.severityLevel === "CRITICAL"
              ? chalk.red
              : report.severityLevel === "HIGH"
                ? chalk.yellow
                : report.severityLevel === "MEDIUM"
                  ? chalk.cyan
                  : chalk.green;
          spinner.succeed(
            `${pairLabel} — ${severityColor(report.severityLevel)} (${report.routingAccuracy}% accuracy) ${chalk.dim("(cached)")}`
          );
          continue;
        }
      }

      // Generate adversarial prompts (primary model)
      const prompts = await generator.generate(pair.skillA, pair.skillB, promptsPerPair);

      // Run routing simulation (sim model).
      // Only present the two skills being tested — the question is "does the router
      // distinguish A from B?", not "does A win against the entire fleet?".
      // Presenting the full manifest causes small/cheap models to pick a third skill
      // and score 0% on every prompt, even for clearly distinct pairs.
      const decisions = await simulator.simulateBatch(
        prompts,
        [pair.skillA, pair.skillB],
        (completed, total) => {
          spinner.text = `[${i + 1}/${selectedPairs.length}] ${pairLabel} — routing ${completed}/${total}`;
        }
      );

      // Score the pair
      const report = scorePair(pair.skillA.name, pair.skillB.name, decisions);
      pairReports.push(report);

      // Store in cache
      if (cache) {
        const hash = PairCache.hashPair(
          pair.skillA.name,
          pair.skillA.description,
          pair.skillB.name,
          pair.skillB.description,
          promptsPerPair,
          simModel
        );
        cache.set(hash, { promptsPerPair, simModel, report });
      }

      const severityColor =
        report.severityLevel === "CRITICAL"
          ? chalk.red
          : report.severityLevel === "HIGH"
            ? chalk.yellow
            : report.severityLevel === "MEDIUM"
              ? chalk.cyan
              : chalk.green;

      spinner.succeed(
        `${pairLabel} — ${severityColor(report.severityLevel)} (${report.routingAccuracy}% accuracy)`
      );
    } catch (err) {
      spinner.fail(`${pairLabel} — Error: ${(err as Error).message}`);
    }
  }

  if (cacheHits > 0) {
    console.log(chalk.dim(`  ${cacheHits} pair${cacheHits !== 1 ? "s" : ""} loaded from cache`));
  }

  if (pairReports.length === 0) {
    console.log(chalk.red("\nNo pairs were successfully tested."));
    process.exit(1);
  }

  // Generate fleet report
  const reportDir = resolvePath(config.output.reportDir);
  const fleetReport = scoreFleet(pairReports, skills.length, model, "");

  // Output to terminal
  if (options.json) {
    console.log(JSON.stringify(fleetReport, null, 2));
  } else {
    printReport(fleetReport);
  }

  // Save report + HTML
  collector.setResult({
    type: "audit",
    fleetErrorRate: fleetReport.estimatedFleetErrorRate,
    pairsTested: fleetReport.totalPairsTested,
    criticalCount: fleetReport.criticalPairs.length,
    highCount: fleetReport.highPairs.length,
    mediumCount: fleetReport.mediumPairs.length,
    lowCount: fleetReport.lowPairs.length,
  });
  if (cacheHits > 0) collector.setCacheHits(cacheHits);
  const metadata = collector.finalize(dual.combinedUsage());
  const stored = saveRun("audit", metadata, fleetReport, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));
}

function sanitizeArgs(options: AuditOptions): Record<string, unknown> {
  return {
    allPairs: options.allPairs ?? false,
    prompts: options.prompts ?? "10",
    dryRun: options.dryRun ?? false,
    enhanced: options.enhanced ?? false,
  };
}

function printReport(report: import("../types.js").FleetAuditReport): void {
  const date = report.generatedAt.slice(0, 10);

  console.log(`\n${chalk.bold("Homingo Audit Report")} — ${date}`);
  console.log(`Model: ${report.modelUsed}`);
  console.log(
    `Skills: ${report.totalSkills} | ` +
      `Pairs Tested: ${report.totalPairsTested} | ` +
      `Fleet Error Rate: ${chalk.bold(String(report.estimatedFleetErrorRate))}%`
  );

  const sections: Array<{
    label: string;
    color: (s: string) => string;
    pairs: PairConflictReport[];
  }> = [
    { label: "CRITICAL", color: chalk.red, pairs: report.criticalPairs },
    { label: "HIGH", color: chalk.yellow, pairs: report.highPairs },
    { label: "MEDIUM", color: chalk.cyan, pairs: report.mediumPairs },
    { label: "LOW", color: chalk.green, pairs: report.lowPairs },
  ];

  for (const section of sections) {
    if (section.pairs.length === 0) continue;

    console.log(`\n${section.color(section.label)} (${section.pairs.length} pairs):`);

    const table = new Table({
      head: ["Skill Pair", "Accuracy", "Action"],
      colWidths: [40, 12, 50],
      style: { head: [] },
    });

    for (const pair of section.pairs) {
      table.push([
        `${pair.skillA} ↔ ${pair.skillB}`,
        `${pair.routingAccuracy}%`,
        pair.recommendedAction,
      ]);
    }

    console.log(table.toString());
  }

  if (report.topFiveOffenders.length > 0) {
    console.log(`\n${chalk.bold("Top offenders")} (skills appearing in most conflicts):`);
    report.topFiveOffenders.forEach((name, i) => {
      console.log(`  ${i + 1}. ${name}`);
    });
  }
}
