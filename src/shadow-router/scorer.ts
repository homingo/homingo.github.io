import type { RoutingDecision, PairConflictReport, FleetAuditReport } from "../types.js";

export function scorePair(
  skillA: string,
  skillB: string,
  decisions: RoutingDecision[]
): PairConflictReport {
  const correct = decisions.filter((d) => d.isCorrect);
  const misroutes = decisions.filter((d) => !d.isCorrect);
  const fragileCorrects = correct.filter((d) => d.confidence === "low");

  const accuracy = (correct.length / decisions.length) * 100;
  const severityLevel = getSeverity(accuracy);

  const topFailurePattern = synthesizeFailurePattern(misroutes);
  const recommendedAction = getRecommendedAction(severityLevel);

  return {
    skillA,
    skillB,
    promptsTested: decisions.length,
    routingAccuracy: Math.round(accuracy * 10) / 10,
    severityLevel,
    misroutes,
    fragileCorrects,
    topFailurePattern,
    recommendedAction,
  };
}

export function scoreFleet(
  pairReports: PairConflictReport[],
  totalSkills: number,
  modelUsed: string,
  exportPath: string
): FleetAuditReport {
  const totalPrompts = pairReports.reduce((s, r) => s + r.promptsTested, 0);
  const totalCorrect = pairReports.reduce(
    (s, r) => s + Math.round((r.routingAccuracy / 100) * r.promptsTested),
    0
  );
  const estimatedFleetErrorRate =
    totalPrompts > 0 ? Math.round((1 - totalCorrect / totalPrompts) * 100 * 10) / 10 : 0;

  const critical = pairReports.filter((r) => r.severityLevel === "CRITICAL");
  const high = pairReports.filter((r) => r.severityLevel === "HIGH");
  const medium = pairReports.filter((r) => r.severityLevel === "MEDIUM");
  const low = pairReports.filter((r) => r.severityLevel === "LOW");

  const skillConflictCounts = new Map<string, number>();
  for (const report of pairReports) {
    if (report.severityLevel === "LOW") continue;
    skillConflictCounts.set(report.skillA, (skillConflictCounts.get(report.skillA) || 0) + 1);
    skillConflictCounts.set(report.skillB, (skillConflictCounts.get(report.skillB) || 0) + 1);
  }

  const topFiveOffenders = [...skillConflictCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  return {
    generatedAt: new Date().toISOString(),
    modelUsed,
    totalSkills,
    totalPairsTested: pairReports.length,
    estimatedFleetErrorRate,
    criticalPairs: critical,
    highPairs: high,
    mediumPairs: medium,
    lowPairs: low,
    topFiveOffenders,
    exportPath,
  };
}

function getSeverity(accuracy: number): PairConflictReport["severityLevel"] {
  if (accuracy >= 90) return "LOW";
  if (accuracy >= 70) return "MEDIUM";
  if (accuracy >= 50) return "HIGH";
  return "CRITICAL";
}

function synthesizeFailurePattern(misroutes: RoutingDecision[]): string {
  if (misroutes.length === 0) return "No failures detected";

  const reasons = misroutes.map((m) => m.reasoning).filter(Boolean);
  if (reasons.length === 0) return "Misroutes detected but no reasoning captured";

  // Extract keywords from all misroute reasons and find the most common theme
  const wordCounts = new Map<string, number>();
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "it",
    "this",
    "that",
    "which",
    "more",
    "both",
    "its",
    "also",
    "than",
    "or",
    "and",
    "but",
    "not",
    "so",
    "if",
    "about",
    "up",
    "out",
  ]);

  for (const reason of reasons) {
    const words = reason
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  const topKeywords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  // Find the most representative reason (the one containing the most top keywords)
  let bestReason = reasons[0];
  let bestScore = 0;
  for (const reason of reasons) {
    const lower = reason.toLowerCase();
    const score = topKeywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestReason = reason;
    }
  }

  const summary =
    misroutes.length === 1
      ? bestReason
      : `${misroutes.length} misroutes — common theme: ${topKeywords.join(", ")}. Example: ${bestReason}`;

  return summary;
}

function getRecommendedAction(severity: PairConflictReport["severityLevel"]): string {
  switch (severity) {
    case "CRITICAL":
      return "Fix immediately — this skill pair is functionally broken";
    case "HIGH":
      return "Fix now — significant routing errors detected";
    case "MEDIUM":
      return "Fix before next deploy — moderate routing ambiguity";
    case "LOW":
      return "Monitor — routing is generally accurate";
  }
}
