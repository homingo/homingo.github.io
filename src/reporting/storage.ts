import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { CommandName, RunMetadata } from "./run-metadata.js";
import { generateHtml } from "./html-renderer.js";
import { generateLogsViewer } from "./logs-viewer.js";
import type { LogsByCommand, LogEntry } from "./logs-viewer.js";

const MAX_RUNS_PER_COMMAND = 10;

export interface StoredRun {
  metadataPath: string;
  htmlPath: string;
}

/**
 * Persist a run's metadata + command data as JSON and generate an HTML report.
 * Returns paths to both files.
 */
export function saveRun(
  command: CommandName,
  metadata: RunMetadata,
  commandData: unknown,
  reportDir: string
): StoredRun {
  const commandDir = join(reportDir, command);
  mkdirSync(commandDir, { recursive: true });

  // Filename: timestamp (colons → hyphens) + short ID
  const safeTimestamp = metadata.timestamp.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
  const shortId = metadata.id.slice(0, 8);
  const baseName = `${safeTimestamp}-${shortId}`;

  const metadataPath = join(commandDir, `${baseName}.json`);
  const htmlPath = join(commandDir, `${baseName}.html`);

  // Write JSON
  writeFileSync(metadataPath, JSON.stringify({ metadata, data: commandData }, null, 2));

  // Generate and write HTML
  const html = generateHtml(command, metadata, commandData);
  writeFileSync(htmlPath, html);

  // Enforce retention — keep last N runs
  enforceRetention(commandDir, MAX_RUNS_PER_COMMAND);

  // Regenerate the logs viewer so it's always up-to-date
  refreshLogsViewer(reportDir);

  return { metadataPath, htmlPath };
}

/**
 * Delete the oldest runs beyond `maxRuns`, identified by .json files.
 * Deletes both .json and .html for each evicted run.
 */
export function enforceRetention(commandDir: string, maxRuns: number): void {
  if (!existsSync(commandDir)) return;

  const jsonFiles = readdirSync(commandDir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // lexicographic = chronological for ISO timestamps

  if (jsonFiles.length <= maxRuns) return;

  const toRemove = jsonFiles.slice(0, jsonFiles.length - maxRuns);
  for (const jsonFile of toRemove) {
    const jsonPath = join(commandDir, jsonFile);
    const htmlFile = jsonFile.replace(/\.json$/, ".html");
    const htmlPath = join(commandDir, htmlFile);

    try {
      unlinkSync(jsonPath);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(htmlPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Scan all command directories and regenerate the top-level logs-viewer.html.
 * Called automatically after every saveRun so the viewer is always current.
 */
export function refreshLogsViewer(reportDir: string): void {
  const commands: CommandName[] = ["audit", "lint", "scan"];
  const allRuns: LogsByCommand = { audit: [], lint: [], scan: [] };

  for (const cmd of commands) {
    const commandDir = join(reportDir, cmd);
    if (!existsSync(commandDir)) continue;

    const jsonFiles = readdirSync(commandDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse() // newest first
      .slice(0, MAX_RUNS_PER_COMMAND);

    for (const jsonFile of jsonFiles) {
      const jsonPath = join(commandDir, jsonFile);
      const htmlFile = jsonFile.replace(/\.json$/, ".html");
      const htmlPath = join(commandDir, htmlFile);

      try {
        const raw = readFileSync(jsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { metadata: RunMetadata };
        const entry: LogEntry = { metadata: parsed.metadata, htmlPath };
        allRuns[cmd].push(entry);
      } catch {
        // Skip corrupted files
      }
    }
  }

  const viewerHtml = generateLogsViewer(allRuns);
  writeFileSync(join(reportDir, "logs-viewer.html"), viewerHtml);
}

/**
 * Re-render every stored HTML report from its JSON source.
 * Useful after template changes so existing reports pick up new markup (e.g. nav buttons).
 * Returns the number of reports regenerated.
 */
export function regenerateReports(reportDir: string): number {
  const commands: CommandName[] = ["audit", "lint", "scan"];
  let count = 0;

  for (const cmd of commands) {
    const commandDir = join(reportDir, cmd);
    if (!existsSync(commandDir)) continue;

    const jsonFiles = readdirSync(commandDir).filter((f) => f.endsWith(".json"));

    for (const jsonFile of jsonFiles) {
      const jsonPath = join(commandDir, jsonFile);
      const htmlFile = jsonFile.replace(/\.json$/, ".html");
      const htmlPath = join(commandDir, htmlFile);

      try {
        const raw = readFileSync(jsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { metadata: RunMetadata; data: unknown };
        const html = generateHtml(cmd, parsed.metadata, parsed.data);
        writeFileSync(htmlPath, html);
        count++;
      } catch {
        // Skip corrupted files
      }
    }
  }

  return count;
}
