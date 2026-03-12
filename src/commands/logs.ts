import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { loadConfig, resolvePath } from "../config.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import { refreshLogsViewer, regenerateReports } from "../reporting/storage.js";
import type { CommandName, RunMetadata } from "../reporting/run-metadata.js";

interface LogsOptions {
  json?: boolean;
  open?: boolean;
  regenerate?: boolean;
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  const config = loadConfig();
  const reportDir = resolvePath(config.output.reportDir);

  const commands: CommandName[] = ["audit", "lint", "scan"];

  // Collect run metadata for summary / --json output
  const runsByCommand: Record<CommandName, RunMetadata[]> = {
    audit: [],
    lint: [],
    scan: [],
  };
  let totalRuns = 0;

  for (const cmd of commands) {
    const commandDir = join(reportDir, cmd);
    if (!existsSync(commandDir)) continue;

    const jsonFiles = readdirSync(commandDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 10);

    for (const jsonFile of jsonFiles) {
      try {
        const raw = readFileSync(join(commandDir, jsonFile), "utf-8");
        const parsed = JSON.parse(raw) as { metadata: RunMetadata };
        runsByCommand[cmd].push(parsed.metadata);
        totalRuns++;
      } catch {
        // Skip corrupted files
      }
    }
  }

  if (totalRuns === 0) {
    console.log(chalk.yellow("No runs recorded yet. Run a command first (scan, audit, lint)."));
    return;
  }

  if (options.regenerate) {
    const count = regenerateReports(reportDir);
    console.log(
      chalk.green(`Regenerated ${count} HTML report${count !== 1 ? "s" : ""} from stored data.`)
    );
  }

  if (options.json) {
    const flat = Object.values(runsByCommand)
      .flat()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    console.log(JSON.stringify(flat, null, 2));
    return;
  }

  // Regenerate the viewer (same function called after every saveRun)
  refreshLogsViewer(reportDir);
  const viewerPath = join(reportDir, "logs-viewer.html");

  console.log(
    `Found ${chalk.bold(String(totalRuns))} run${totalRuns !== 1 ? "s" : ""} across ${commands.length} commands`
  );

  for (const cmd of commands) {
    if (runsByCommand[cmd].length > 0) {
      console.log(
        `  ${chalk.cyan(cmd)}: ${runsByCommand[cmd].length} run${runsByCommand[cmd].length !== 1 ? "s" : ""}`
      );
    }
  }

  if (options.open !== false && !isHeadless()) {
    openInBrowser(viewerPath);
  }
  console.log(chalk.dim(`\nViewer: ${viewerPath}`));
}
