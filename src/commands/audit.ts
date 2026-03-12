import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { createProvider, detectProvider, TrackedProvider } from "../providers/index.js";
import { parseSkills } from "../skills/parser.js";
import { selectPairs } from "../shadow-router/pair-selector.js";
import { PromptGenerator } from "../shadow-router/generator.js";
import { RoutingSimulator } from "../shadow-router/simulator.js";
import { scorePair, scoreFleet } from "../shadow-router/scorer.js";
import { RunCollector } from "../reporting/run-metadata.js";
import { saveRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import type { PairConflictReport } from "../types.js";

interface AuditOptions {
  allPairs?: boolean;
  prompts?: string;
  model?: string;
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
  const promptsPerPair = parseInt(options.prompts || "50", 10);

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

  console.log(
    `\nTesting ${chalk.bold(String(selectedPairs.length))} pairs` +
      ` (of ${totalPossiblePairs} possible)` +
      (skippedPairs > 0 ? ` — ${skippedPairs} low-overlap pairs skipped` : "")
  );

  const estimatedCalls = selectedPairs.length * (promptsPerPair + 1);
  console.log(chalk.dim(`Estimated API calls: ~${estimatedCalls} (model: ${model})\n`));

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

  // Generate prompts and simulate routing for each pair
  const providerName = detectProvider(model);
  const innerProvider = createProvider(model, config);
  const tracked = new TrackedProvider(innerProvider);
  const collector = new RunCollector("audit", sanitizeArgs(options), model, providerName);
  collector.setSkillCount(skills.length);
  collector.setSkills(skills);

  const generator = new PromptGenerator({ provider: tracked, model });
  const concurrency = parseInt(options.concurrency || "10", 10);
  const simulator = new RoutingSimulator({ provider: tracked, model, concurrency });

  const pairReports: PairConflictReport[] = [];

  for (let i = 0; i < selectedPairs.length; i++) {
    const pair = selectedPairs[i];
    const pairLabel = `${pair.skillA.name} ↔ ${pair.skillB.name}`;
    const spinner = ora(`[${i + 1}/${selectedPairs.length}] Testing: ${pairLabel}`).start();

    try {
      // Generate adversarial prompts
      const prompts = await generator.generate(pair.skillA, pair.skillB, promptsPerPair);

      // Run routing simulation
      const decisions = await simulator.simulateBatch(prompts, skills, (completed, total) => {
        spinner.text = `[${i + 1}/${selectedPairs.length}] ${pairLabel} — routing ${completed}/${total}`;
      });

      // Score the pair
      const report = scorePair(pair.skillA.name, pair.skillB.name, decisions);
      pairReports.push(report);

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
  const metadata = collector.finalize(tracked);
  const stored = saveRun("audit", metadata, fleetReport, reportDir);

  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));
}

function sanitizeArgs(options: AuditOptions): Record<string, unknown> {
  return {
    allPairs: options.allPairs ?? false,
    prompts: options.prompts ?? "50",
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
