import { describe, it, expect } from "vitest";
import { scorePair, scoreFleet } from "../src/shadow-router/scorer.js";
import type { RoutingDecision, PairConflictReport } from "../src/types.js";

function decision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    promptId: "p1",
    promptText: "test prompt",
    selectedSkill: "skill-a",
    expectedSkill: "skill-a",
    isCorrect: true,
    confidence: "high",
    reasoning: "clear match",
    ...overrides,
  };
}

describe("scorePair", () => {
  it("computes 100% accuracy when all decisions are correct", () => {
    const decisions = Array.from({ length: 10 }, () => decision());
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(100);
    expect(report.severityLevel).toBe("LOW");
    expect(report.misroutes).toHaveLength(0);
  });

  it("computes 0% accuracy when all decisions are wrong", () => {
    const decisions = Array.from({ length: 10 }, () =>
      decision({ isCorrect: false, selectedSkill: "skill-b", expectedSkill: "skill-a" })
    );
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(0);
    expect(report.severityLevel).toBe("CRITICAL");
  });

  it("assigns CRITICAL severity below 50%", () => {
    const decisions = [
      decision({ isCorrect: true }),
      decision({ isCorrect: true }),
      ...Array.from({ length: 8 }, () =>
        decision({ isCorrect: false, selectedSkill: "skill-b", expectedSkill: "skill-a" })
      ),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(20);
    expect(report.severityLevel).toBe("CRITICAL");
  });

  it("assigns HIGH severity between 50-70%", () => {
    const decisions = [
      ...Array.from({ length: 6 }, () => decision({ isCorrect: true })),
      ...Array.from({ length: 4 }, () =>
        decision({ isCorrect: false, selectedSkill: "skill-b", expectedSkill: "skill-a" })
      ),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(60);
    expect(report.severityLevel).toBe("HIGH");
  });

  it("assigns MEDIUM severity between 70-90%", () => {
    const decisions = [
      ...Array.from({ length: 8 }, () => decision({ isCorrect: true })),
      ...Array.from({ length: 2 }, () =>
        decision({ isCorrect: false, selectedSkill: "skill-b", expectedSkill: "skill-a" })
      ),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(80);
    expect(report.severityLevel).toBe("MEDIUM");
  });

  it("assigns LOW severity at 90%+", () => {
    const decisions = [
      ...Array.from({ length: 9 }, () => decision({ isCorrect: true })),
      decision({
        isCorrect: false,
        selectedSkill: "skill-b",
        expectedSkill: "skill-a",
      }),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.routingAccuracy).toBe(90);
    expect(report.severityLevel).toBe("LOW");
  });

  it("identifies fragile corrects (low confidence)", () => {
    const decisions = [
      decision({ isCorrect: true, confidence: "high" }),
      decision({ isCorrect: true, confidence: "low" }),
      decision({ isCorrect: true, confidence: "low" }),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.fragileCorrects).toHaveLength(2);
  });

  it("synthesizes failure pattern from misroutes", () => {
    const decisions = [
      decision({
        isCorrect: false,
        reasoning: "Both skills handle document review and analysis",
      }),
      decision({
        isCorrect: false,
        reasoning: "Document review overlaps between the two skills",
      }),
      decision({ isCorrect: true }),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.topFailurePattern).toContain("misroutes");
    expect(report.topFailurePattern).toContain("document");
  });

  it("handles single misroute pattern", () => {
    const decisions = [
      decision({
        isCorrect: false,
        reasoning: "Ambiguous tax-related query",
      }),
      ...Array.from({ length: 9 }, () => decision({ isCorrect: true })),
    ];
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.topFailurePattern).toBe("Ambiguous tax-related query");
  });

  it("reports no failures when all correct", () => {
    const decisions = Array.from({ length: 5 }, () => decision());
    const report = scorePair("skill-a", "skill-b", decisions);
    expect(report.topFailurePattern).toBe("No failures detected");
  });

  it("includes recommended action based on severity", () => {
    const critical = scorePair(
      "a",
      "b",
      Array.from({ length: 10 }, () => decision({ isCorrect: false }))
    );
    expect(critical.recommendedAction).toContain("Fix immediately");

    const low = scorePair(
      "a",
      "b",
      Array.from({ length: 10 }, () => decision({ isCorrect: true }))
    );
    expect(low.recommendedAction).toContain("Monitor");
  });
});

describe("scoreFleet", () => {
  function makePairReport(overrides: Partial<PairConflictReport> = {}): PairConflictReport {
    return {
      skillA: "skill-a",
      skillB: "skill-b",
      promptsTested: 50,
      routingAccuracy: 80,
      severityLevel: "MEDIUM",
      misroutes: [],
      fragileCorrects: [],
      topFailurePattern: "some pattern",
      recommendedAction: "Fix before next deploy",
      ...overrides,
    };
  }

  it("categorizes pairs by severity", () => {
    const reports = [
      makePairReport({ skillA: "a", skillB: "b", severityLevel: "CRITICAL", routingAccuracy: 30 }),
      makePairReport({ skillA: "c", skillB: "d", severityLevel: "HIGH", routingAccuracy: 60 }),
      makePairReport({ skillA: "e", skillB: "f", severityLevel: "MEDIUM", routingAccuracy: 80 }),
      makePairReport({ skillA: "g", skillB: "h", severityLevel: "LOW", routingAccuracy: 95 }),
    ];
    const fleet = scoreFleet(reports, 8, "claude-sonnet-4-20250514", "/tmp/report.json");
    expect(fleet.criticalPairs).toHaveLength(1);
    expect(fleet.highPairs).toHaveLength(1);
    expect(fleet.mediumPairs).toHaveLength(1);
    expect(fleet.lowPairs).toHaveLength(1);
  });

  it("calculates fleet error rate", () => {
    const reports = [
      makePairReport({ promptsTested: 100, routingAccuracy: 80 }),
      makePairReport({ promptsTested: 100, routingAccuracy: 60 }),
    ];
    const fleet = scoreFleet(reports, 4, "claude-sonnet-4-20250514", "/tmp/report.json");
    // 80 + 60 correct out of 200 total = 140/200 = 70% correct = 30% error
    expect(fleet.estimatedFleetErrorRate).toBe(30);
  });

  it("identifies top offenders excluding LOW severity", () => {
    const reports = [
      makePairReport({ skillA: "bad-skill", skillB: "other-1", severityLevel: "CRITICAL" }),
      makePairReport({ skillA: "bad-skill", skillB: "other-2", severityLevel: "HIGH" }),
      makePairReport({ skillA: "ok-skill", skillB: "other-3", severityLevel: "LOW" }),
    ];
    const fleet = scoreFleet(reports, 5, "claude-sonnet-4-20250514", "/tmp/report.json");
    expect(fleet.topFiveOffenders[0]).toBe("bad-skill");
    // ok-skill shouldn't appear since it's only in LOW severity pairs
    expect(fleet.topFiveOffenders).not.toContain("ok-skill");
  });

  it("caps offenders at 5", () => {
    const reports = Array.from({ length: 10 }, (_, i) =>
      makePairReport({ skillA: `skill-${i}`, skillB: `skill-${i + 10}`, severityLevel: "HIGH" })
    );
    const fleet = scoreFleet(reports, 20, "claude-sonnet-4-20250514", "/tmp/report.json");
    expect(fleet.topFiveOffenders.length).toBeLessThanOrEqual(5);
  });

  it("stores metadata correctly", () => {
    const fleet = scoreFleet([], 10, "claude-sonnet-4-20250514", "/tmp/report.json");
    expect(fleet.totalSkills).toBe(10);
    expect(fleet.modelUsed).toBe("claude-sonnet-4-20250514");
    expect(fleet.exportPath).toBe("/tmp/report.json");
    expect(fleet.totalPairsTested).toBe(0);
    expect(fleet.estimatedFleetErrorRate).toBe(0);
  });
});
