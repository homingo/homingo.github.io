#!/usr/bin/env node

import { createRequire } from "module";
import { Command } from "commander";
import { auditCommand } from "./commands/audit.js";
import { lintCommand } from "./commands/lint.js";
import { scanCommand } from "./commands/scan.js";
import { initCommand } from "./commands/init.js";
import { logsCommand } from "./commands/logs.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("homingo")
  .description(
    "Homingo — the homing instinct for your AI skills. Detect, diagnose, and fix routing drift."
  )
  .version(version);

program
  .command("audit")
  .description("Read-only diagnostic — detect routing conflicts across your skill fleet")
  .option("--skills-dir <dir>", "Path to skills directory (overrides config)")
  .option("--all-pairs", "Test every skill pair (expensive, thorough)")
  .option("--prompts <count>", "Prompts per pair (default: 10)", "10")
  .option("--model <model>", "Model to use for prompt generation and rewrites")
  .option(
    "--sim-model <model>",
    "Model for routing simulation (default: auto-derived cheaper model)"
  )
  .option("--no-cache", "Bypass pair result cache")
  .option("--json", "Output JSON only (no terminal table)")
  .option("--concurrency <n>", "Max parallel API calls (default: 5)", "5")
  .option("--dry-run", "Show pairs that would be tested without making API calls")
  .option("--enhanced", "Use bigram matching for improved overlap detection")
  .option("--no-open", "Don't auto-open HTML report in browser")
  .action(auditCommand);

program
  .command("scan")
  .description("Instant fleet health check — runs locally in seconds, no API calls")
  .option("--skills-dir <dir>", "Path to skills directory (overrides config)")
  .option("--all-pairs", "Analyze every skill pair (default: top overlapping pairs)")
  .option("--enhanced", "Use bigram matching for improved overlap detection")
  .option("--json", "Output JSON only")
  .option("--no-open", "Don't auto-open HTML report in browser")
  .action(scanCommand);

program
  .command("lint")
  .description("Pre-deploy validation — test routing, detect scope overload, suggest fixes")
  .option("--skills-dir <dir>", "Path to skills directory (overrides config)")
  .option("--skill <name>", "Test a single skill against its neighbors (instead of full fleet)")
  .option("--pair <a,b>", "Test a specific skill pair (comma-separated names)")
  .option("--prompts <count>", "Prompts per pair (default: 10)", "10")
  .option("--threshold <pct>", "Accuracy threshold to pass (default: 90)", "90")
  .option("--neighbors <n>", "Max neighbors to test in --skill mode (default: 5)", "5")
  .option("--model <model>", "Model to use for prompt generation and rewrites")
  .option(
    "--sim-model <model>",
    "Model for routing simulation (default: auto-derived cheaper model)"
  )
  .option("--no-cache", "Bypass pair result cache")
  .option("--concurrency <n>", "Max parallel API calls (default: 5)", "5")
  .option("--json", "Output JSON only")
  .option("--dry-run", "Show pairs that would be tested without making API calls")
  .option(
    "--fix [run-id]",
    "Iteratively rewrite and re-test until pairs pass (optionally resume from a previous run)"
  )
  .option("--force", "Run scope overload checks even on skills under threshold")
  .option("--enhanced", "Use bigram matching for improved overlap detection")
  .option("--no-open", "Don't auto-open HTML report in browser")
  .action(lintCommand);

program
  .command("init [directory]")
  .description("Set up Homingo configuration and scaffold a skills directory")
  .action((directory) => initCommand(directory));

program
  .command("logs")
  .description("View run history — browse past scan, audit, and lint results")
  .option("--no-open", "Don't auto-open in browser")
  .option("--json", "Output run metadata as JSON")
  .option("--regenerate", "Re-render all HTML reports from stored data (picks up template changes)")
  .action(logsCommand);

program.parse();
