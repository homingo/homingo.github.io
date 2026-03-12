import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import { loadConfig, resolvePath } from "../config.js";
import { parseSkills } from "../skills/parser.js";
import { selectNeighbors, selectPairs, tokenizeOrdered } from "../shadow-router/pair-selector.js";
import { ShardAnalyzer } from "../shard/analyzer.js";
import { saveRun } from "../reporting/storage.js";
import { isHeadless, openInBrowser } from "../reporting/opener.js";
import type { RunMetadata, MapResult } from "../reporting/run-metadata.js";
import type { LLMProvider } from "../providers/types.js";
import type { Skill } from "../types.js";

interface MapOptions {
  skillsDir?: string;
  enhanced?: boolean;
  json?: boolean;
  open?: boolean;
}

export interface MapSkillProfile {
  name: string;
  clusterId: string;
  overlapDegree: number;
  nearestNeighbors: Array<{ name: string; score: number }>;
  overloaded: boolean;
}

export interface MapCluster {
  id: string;
  label: string;
  size: number;
  skills: string[];
  representativeKeywords: string[];
}

export interface MergeCandidate {
  skillA: string;
  skillB: string;
  overlapScore: number;
  reason: string;
}

export interface MapData {
  totalSkills: number;
  clusters: MapCluster[];
  skillProfiles: MapSkillProfile[];
  mergeCandidates: MergeCandidate[];
  overlapHubs: Array<{ name: string; overlapDegree: number }>;
  overloadedSkills: Array<{ name: string; reason: string; descriptionLength: number }>;
}

const CLUSTER_THRESHOLD = 0.18;
const MERGE_THRESHOLD = 0.35;

export async function mapCommand(options: MapOptions): Promise<void> {
  const startTime = Date.now();
  const config = loadConfig();
  const skillsDir = resolvePath(options.skillsDir || config.skillsDir);

  const parseSpinner = ora("Parsing skills...").start();
  let skills: Skill[];
  try {
    ({ skills } = await parseSkills(skillsDir));
    parseSpinner.succeed(`Found ${skills.length} skills`);
  } catch (err) {
    parseSpinner.fail((err as Error).message);
    process.exit(1);
  }

  if (skills.length === 0) {
    console.log(chalk.yellow("No skills found to map."));
    process.exit(0);
  }

  const overlapSpinner = ora("Building capability map...").start();
  const allPairs = selectPairs(skills, true, options.enhanced ?? false).selectedPairs;
  const dummyProvider: LLMProvider = {
    createMessage: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
  };
  const analyzer = new ShardAnalyzer({ provider: dummyProvider, model: "map-local" });
  const overloadedSkills = skills
    .map((skill) => {
      const result = analyzer.analyzeOverload(skill);
      return result.isOverloaded
        ? { name: skill.name, reason: result.reason, descriptionLength: result.descriptionLength }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const adjacency = buildAdjacency(skills, allPairs);
  const clusters = buildClusters(skills, adjacency);
  const clusterBySkill = new Map<string, string>();
  for (const cluster of clusters) {
    for (const name of cluster.skills) clusterBySkill.set(name, cluster.id);
  }

  const skillProfiles: MapSkillProfile[] = skills
    .map((skill) => {
      const neighbors = selectNeighbors(skill, skills, 3, options.enhanced ?? false).map((p) => ({
        name: p.skillB.name,
        score: Math.round(p.overlapScore * 1000) / 1000,
      }));
      return {
        name: skill.name,
        clusterId: clusterBySkill.get(skill.name) || "cluster-0",
        overlapDegree: adjacency.get(skill.name)?.length || 0,
        nearestNeighbors: neighbors,
        overloaded: overloadedSkills.some((entry) => entry.name === skill.name),
      };
    })
    .sort((a, b) => b.overlapDegree - a.overlapDegree || a.name.localeCompare(b.name));

  const mergeCandidates = allPairs
    .filter((pair) => pair.overlapScore >= MERGE_THRESHOLD)
    .slice(0, 10)
    .map((pair) => ({
      skillA: pair.skillA.name,
      skillB: pair.skillB.name,
      overlapScore: Math.round(pair.overlapScore * 1000) / 1000,
      reason: pair.reason,
    }));

  const overlapHubs = skillProfiles
    .filter((profile) => profile.overlapDegree > 0)
    .slice(0, 10)
    .map((profile) => ({ name: profile.name, overlapDegree: profile.overlapDegree }));

  const mapData: MapData = {
    totalSkills: skills.length,
    clusters,
    skillProfiles,
    mergeCandidates,
    overlapHubs,
    overloadedSkills,
  };
  overlapSpinner.succeed(
    `${clusters.length} cluster${clusters.length !== 1 ? "s" : ""}, ${mergeCandidates.length} merge candidate${mergeCandidates.length !== 1 ? "s" : ""}`
  );

  if (options.json) {
    console.log(JSON.stringify(mapData, null, 2));
  } else {
    printMapReport(mapData);
  }

  const durationMs = Date.now() - startTime;
  const result: MapResult = {
    type: "map",
    totalSkills: skills.length,
    clusters: clusters.length,
    mergeCandidates: mergeCandidates.length,
    overloadedSkills: overloadedSkills.length,
    overlapHubs: overlapHubs.length,
  };
  const metadata: RunMetadata = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    durationMs,
    command: "map",
    args: sanitizeArgs(options),
    model: "local-heuristic",
    provider: "anthropic",
    skillCount: skills.length,
    skills: skills.map((s) => ({ name: s.name, description: s.description })),
    tokens: { input: 0, output: 0, total: 0 },
    gitCommitHash: getGitCommitHash(),
    result,
  };

  const reportDir = resolvePath(config.output.reportDir);
  const stored = saveRun("map", metadata, mapData, reportDir);
  if (options.open !== false && !isHeadless()) {
    openInBrowser(stored.htmlPath);
  }
  console.log(chalk.dim(`\nReport: ${stored.htmlPath}`));
}

function sanitizeArgs(options: MapOptions): Record<string, unknown> {
  return {
    enhanced: options.enhanced ?? false,
  };
}

function buildAdjacency(
  skills: Skill[],
  pairs: ReturnType<typeof selectPairs>["selectedPairs"]
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>(skills.map((skill) => [skill.name, []]));
  for (const pair of pairs) {
    if (pair.overlapScore < CLUSTER_THRESHOLD) continue;
    adjacency.get(pair.skillA.name)?.push(pair.skillB.name);
    adjacency.get(pair.skillB.name)?.push(pair.skillA.name);
  }
  return adjacency;
}

function buildClusters(skills: Skill[], adjacency: Map<string, string[]>): MapCluster[] {
  const skillByName = new Map(skills.map((skill) => [skill.name, skill]));
  const visited = new Set<string>();
  const clusters: MapCluster[] = [];

  for (const skill of skills) {
    if (visited.has(skill.name)) continue;

    const queue = [skill.name];
    const members: string[] = [];
    visited.add(skill.name);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      members.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    members.sort();
    const representativeKeywords = summarizeKeywords(
      members.map((name) => skillByName.get(name)?.description || "").join(" ")
    );
    clusters.push({
      id: `cluster-${clusters.length + 1}`,
      label: representativeKeywords.join(", ") || members[0] || "misc",
      size: members.length,
      skills: members,
      representativeKeywords,
    });
  }

  return clusters.sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
}

function summarizeKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenizeOrdered(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([token]) => token);
}

function printMapReport(data: MapData): void {
  console.log(`\n${chalk.bold("Homingo Map Report")}`);
  console.log(
    `Skills: ${data.totalSkills} | ` +
      `Clusters: ${data.clusters.length} | ` +
      `Merge Candidates: ${data.mergeCandidates.length} | ` +
      `Overlap Hubs: ${data.overlapHubs.length}`
  );

  if (data.clusters.length > 0) {
    const clusterTable = new Table({
      head: ["Cluster", "Size", "Representative Keywords", "Skills"],
      colWidths: [14, 8, 28, 55],
      style: { head: [] },
    });
    for (const cluster of data.clusters.slice(0, 10)) {
      clusterTable.push([
        cluster.id,
        String(cluster.size),
        cluster.representativeKeywords.join(", "),
        cluster.skills.join(", "),
      ]);
    }
    console.log(`\n${chalk.bold("Capability Clusters")}`);
    console.log(clusterTable.toString());
  }

  if (data.overlapHubs.length > 0) {
    const hubTable = new Table({
      head: ["Skill", "Overlap Degree"],
      colWidths: [40, 20],
      style: { head: [] },
    });
    for (const hub of data.overlapHubs) {
      hubTable.push([hub.name, String(hub.overlapDegree)]);
    }
    console.log(`\n${chalk.bold("Overlap Hubs")}`);
    console.log(hubTable.toString());
  }
}

function getGitCommitHash(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}
