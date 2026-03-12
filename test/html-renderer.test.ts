import { describe, it, expect } from "vitest";
import { generateHtml } from "../src/reporting/html-renderer.js";
import type { RunMetadata } from "../src/reporting/run-metadata.js";
import type { FleetAuditReport } from "../src/types.js";
import type { LintData } from "../src/reporting/html-renderer.js";
import type { ScanData } from "../src/commands/scan.js";

function makeMeta(command: "audit" | "lint" | "scan"): RunMetadata {
  return {
    id: "test-uuid-12345678",
    timestamp: "2026-03-12T10:15:30.000Z",
    durationMs: 45000,
    command,
    args: {},
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    skillCount: 12,
    tokens: { input: 5000, output: 2000, total: 7000 },
    gitCommitHash: "abc1234",
    result: {
      type: "audit",
      fleetErrorRate: 8.5,
      pairsTested: 10,
      criticalCount: 1,
      highCount: 2,
      mediumCount: 3,
      lowCount: 4,
    },
  };
}

describe("generateHtml", () => {
  it("generates valid HTML with DOCTYPE", () => {
    const meta = makeMeta("audit");
    const data: FleetAuditReport = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 12,
      totalPairsTested: 10,
      estimatedFleetErrorRate: 8.5,
      criticalPairs: [],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: [],
      exportPath: "",
    };

    const html = generateHtml("audit", meta, data);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes metadata bar with model, provider, and tokens", () => {
    const meta = makeMeta("audit");
    const data: FleetAuditReport = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 12,
      totalPairsTested: 10,
      estimatedFleetErrorRate: 8.5,
      criticalPairs: [],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: [],
      exportPath: "",
    };

    const html = generateHtml("audit", meta, data);

    expect(html).toContain("claude-sonnet-4-20250514");
    expect(html).toContain("anthropic");
    expect(html).toContain("abc1234");
    expect(html).toContain("45.0s");
  });

  it("renders audit report with fleet error rate", () => {
    const meta = makeMeta("audit");
    const data: FleetAuditReport = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 12,
      totalPairsTested: 10,
      estimatedFleetErrorRate: 8.5,
      criticalPairs: [
        {
          skillA: "skill-a",
          skillB: "skill-b",
          promptsTested: 50,
          routingAccuracy: 40,
          severityLevel: "CRITICAL",
          misroutes: [],
          fragileCorrects: [],
          topFailurePattern: "ambiguous intent",
          recommendedAction: "Rewrite descriptions",
        },
      ],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: ["skill-a"],
      exportPath: "",
    };

    const html = generateHtml("audit", meta, data);

    expect(html).toContain("8.5%");
    expect(html).toContain("CRITICAL");
    expect(html).toContain("skill-a");
    expect(html).toContain("skill-b");
    expect(html).toContain("Top Offenders");
  });

  it("renders lint report with shard findings", () => {
    const meta = makeMeta("lint");
    meta.result = {
      type: "lint",
      targetSkill: "big-skill",
      neighborsTested: 3,
      passingCount: 2,
      failingCount: 1,
      overallAccuracy: 67,
      overloadedSkills: 1,
      shardPlansGenerated: 1,
      shardsApplied: false,
    };

    const lintData: LintData = {
      failingReports: [],
      passingCount: 2,
      rewriteSuggestions: [],
      shardFindings: [
        {
          skillName: "big-skill",
          descriptionLength: 1500,
          isOverloaded: true,
          reason: "too many intents",
          overloadResult: {
            isOverloaded: true,
            reason: "too many intents",
            descriptionLength: 1500,
          },
          plan: {
            originalSkill: {
              name: "big-skill",
              description: "big description",
              filePath: "/skills/big-skill/SKILL.md",
            },
            reason: "too many intents",
            descriptionLength: 1500,
            identifiedIntents: ["intent-a", "intent-b", "intent-c"],
            subSkills: [
              {
                name: "big-skill-a",
                description: "handles A",
                role: "sub-skill",
                intents: ["intent-a"],
                negativeTriggers: ["Does NOT handle B"],
              },
              {
                name: "big-skill-b",
                description: "handles B",
                role: "sub-skill",
                intents: ["intent-b"],
                negativeTriggers: ["Does NOT handle A"],
              },
            ],
            orchestrator: {
              name: "big-skill-orchestrator",
              description: "delegates to sub-skills",
              role: "orchestrator",
              intents: ["all"],
              negativeTriggers: ["Does NOT handle directly"],
            },
          },
        },
      ],
    };

    const html = generateHtml("lint", meta, lintData);

    expect(html).toContain("Lint Report");
    expect(html).toContain("Scope Overload");
    expect(html).toContain("big-skill");
    expect(html).toContain("big-skill-a");
    expect(html).toContain("big-skill-orchestrator");
    expect(html).toContain("intent-a");
    expect(html).toContain("1500 chars");
    // Next Steps for overloaded skill with plan
    expect(html).toContain("Next Steps");
    expect(html).toContain("homingo lint --fix");
    expect(html).toContain("git diff");
  });

  it("renders lint report with failing pairs and next steps", () => {
    const meta = makeMeta("lint");
    meta.result = {
      type: "lint",
      targetSkill: undefined,
      neighborsTested: 3,
      passingCount: 1,
      failingCount: 2,
      overallAccuracy: 50,
      overloadedSkills: 0,
      shardPlansGenerated: 0,
      shardsApplied: false,
    };

    const lintData: LintData = {
      failingReports: [
        {
          skillA: "skill-x",
          skillB: "skill-y",
          promptsTested: 50,
          routingAccuracy: 60,
          severityLevel: "CRITICAL",
          misroutes: [],
          fragileCorrects: [],
          topFailurePattern: "confused routing",
          recommendedAction: "Rewrite descriptions",
        },
        {
          skillA: "skill-m",
          skillB: "skill-n",
          promptsTested: 50,
          routingAccuracy: 78,
          severityLevel: "HIGH",
          misroutes: [],
          fragileCorrects: [],
          topFailurePattern: "overlap",
          recommendedAction: "Clarify scope",
        },
      ],
      passingCount: 1,
      rewriteSuggestions: [
        {
          skillName: "skill-x",
          originalDescription: "does stuff",
          rewrittenDescription: "does specific stuff",
          reasoning: "too vague",
          conflictsWith: ["skill-y"],
        },
      ],
      shardFindings: [],
    };

    const html = generateHtml("lint", meta, lintData);

    // Section nav
    expect(html).toContain("Failing Pairs");
    expect(html).toContain("Rewrites");
    expect(html).toContain("Next Steps");
    // Next Steps content
    expect(html).toContain("homingo lint --fix");
    expect(html).toContain("homingo lint --fix latest");
    // Fix specific pairs
    expect(html).toContain("homingo lint --pair skill-x,skill-y --fix");
    expect(html).toContain("homingo lint --pair skill-m,skill-n --fix");
    expect(html).toContain("git diff");
    // Should NOT show All Clear
    expect(html).not.toContain("All Clear");
  });

  it("renders lint report cleanly with no shard findings", () => {
    const meta = makeMeta("lint");
    meta.result = {
      type: "lint",
      targetSkill: "my-skill",
      neighborsTested: 3,
      passingCount: 3,
      failingCount: 0,
      overallAccuracy: 100,
      overloadedSkills: 0,
      shardPlansGenerated: 0,
      shardsApplied: false,
    };

    const lintData: LintData = {
      failingReports: [],
      passingCount: 3,
      rewriteSuggestions: [],
      shardFindings: [],
    };

    const html = generateHtml("lint", meta, lintData);

    expect(html).toContain("Lint Report");
    expect(html).toContain("✅ PASS");
    expect(html).not.toContain("Scope Overload");
    // All Clear next steps for passing lint
    expect(html).toContain("All Clear");
    expect(html).toContain("Safe to deploy");
    expect(html).not.toContain("homingo lint --fix");
  });

  it("renders merge recommendations section", () => {
    const meta = makeMeta("lint");
    meta.result = {
      type: "lint",
      targetSkill: undefined,
      neighborsTested: 2,
      passingCount: 0,
      failingCount: 2,
      overallAccuracy: 40,
      overloadedSkills: 0,
      shardPlansGenerated: 0,
      shardsApplied: false,
    };

    const lintData: LintData = {
      failingReports: [],
      passingCount: 0,
      rewriteSuggestions: [],
      mergeRecommendations: [
        {
          skillA: "invoice-gen",
          skillB: "invoice-creator",
          mergedName: "invoice-generator",
          mergedDescription: "Generates invoice documents from order data.",
          reasoning: "Both skills generate invoices from the same inputs.",
          accuracy: 38,
        },
      ],
      shardFindings: [],
    };

    const html = generateHtml("lint", meta, lintData);

    // Section nav should include Merge Candidates
    expect(html).toContain("Merge Candidates");
    // Merge card content
    expect(html).toContain("invoice-gen");
    expect(html).toContain("invoice-creator");
    expect(html).toContain("invoice-generator");
    expect(html).toContain("Generates invoice documents from order data.");
    expect(html).toContain("Both skills generate invoices from the same inputs.");
    expect(html).toContain("38%");
    // Next Steps should mention merge candidates
    expect(html).toContain("merge candidate");
    expect(html).toContain("consolidate manually");
  });

  it("renders merge candidates in next steps alongside failing pairs", () => {
    const meta = makeMeta("lint");
    meta.result = {
      type: "lint",
      targetSkill: undefined,
      neighborsTested: 3,
      passingCount: 1,
      failingCount: 2,
      overallAccuracy: 33,
      overloadedSkills: 0,
      shardPlansGenerated: 0,
      shardsApplied: false,
    };

    const lintData: LintData = {
      failingReports: [
        {
          skillA: "skill-x",
          skillB: "skill-y",
          promptsTested: 25,
          routingAccuracy: 60,
          severityLevel: "HIGH",
          misroutes: [],
          fragileCorrects: [],
          topFailurePattern: "overlap",
          recommendedAction: "Rewrite",
        },
      ],
      passingCount: 1,
      rewriteSuggestions: [],
      mergeRecommendations: [
        {
          skillA: "skill-a",
          skillB: "skill-b",
          mergedName: "combined-skill",
          mergedDescription: "Combined description",
          reasoning: "Same purpose",
          accuracy: 42,
        },
      ],
      shardFindings: [],
    };

    const html = generateHtml("lint", meta, lintData);

    // Both sections should exist
    expect(html).toContain("Failing Pairs");
    expect(html).toContain("Merge Candidates");
    // Next Steps should mention both
    expect(html).toContain("homingo lint --fix");
    expect(html).toContain("merge candidate");
  });

  it("escapes HTML entities in skill names", () => {
    const meta = makeMeta("audit");
    const data: FleetAuditReport = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 2,
      totalPairsTested: 1,
      estimatedFleetErrorRate: 0,
      criticalPairs: [
        {
          skillA: "<script>alert</script>",
          skillB: "normal-skill",
          promptsTested: 50,
          routingAccuracy: 90,
          severityLevel: "CRITICAL",
          misroutes: [],
          fragileCorrects: [],
          topFailurePattern: "",
          recommendedAction: "",
        },
      ],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: [],
      exportPath: "",
    };

    const html = generateHtml("audit", meta, data);

    expect(html).not.toContain("<script>alert</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes inline CSS", () => {
    const meta = makeMeta("audit");
    const data: FleetAuditReport = {
      generatedAt: meta.timestamp,
      modelUsed: meta.model,
      totalSkills: 0,
      totalPairsTested: 0,
      estimatedFleetErrorRate: 0,
      criticalPairs: [],
      highPairs: [],
      mediumPairs: [],
      lowPairs: [],
      topFiveOffenders: [],
      exportPath: "",
    };

    const html = generateHtml("audit", meta, data);

    expect(html).toContain("<style>");
    expect(html).toContain("--critical: #dc2626");
  });

  it("renders scan report with health score and conflicts", () => {
    const meta = makeMeta("scan");
    meta.result = {
      type: "scan",
      totalSkills: 10,
      totalPossiblePairs: 45,
      conflictingPairs: 2,
      overloadedSkills: 1,
      duplicateSkills: 1,
      healthScore: 72,
    };

    const scanData: ScanData = {
      totalSkills: 10,
      totalPossiblePairs: 45,
      healthScore: 72,
      overlapPairs: [
        {
          skillA: "invoice-gen",
          skillB: "invoice-summary",
          overlapScore: 0.55,
          reason: "Shared keywords: invoice, generate",
          severity: "CRITICAL",
        },
        {
          skillA: "tax-calc",
          skillB: "tax-report",
          overlapScore: 0.38,
          reason: "Shared keywords: tax, calculation",
          severity: "HIGH",
        },
        {
          skillA: "user-auth",
          skillB: "user-profile",
          overlapScore: 0.22,
          reason: "Name similarity detected",
          severity: "MEDIUM",
        },
      ],
      overloadFindings: [
        {
          skillName: "mega-skill",
          descriptionLength: 1200,
          reason:
            "description is 1200 chars (threshold: 1024); 3 semicolons suggest multiple distinct responsibilities",
          result: {
            isOverloaded: true,
            reason:
              "description is 1200 chars (threshold: 1024); 3 semicolons suggest multiple distinct responsibilities",
            descriptionLength: 1200,
          },
        },
      ],
      duplicateFindings: [
        {
          name: "invoice-gen",
          keptPath: "/skills/invoice-gen/SKILL.md",
          skippedPath: "/skills/invoice-generator/SKILL.md",
        },
      ],
    };

    const html = generateHtml("scan", meta, scanData);

    expect(html).toContain("Scan Report");
    expect(html).toContain("72/100");
    // Merged overlap findings section
    expect(html).toContain("Overlap Findings");
    expect(html).toContain("invoice-gen");
    expect(html).toContain("invoice-summary");
    expect(html).toContain("CRITICAL");
    expect(html).toContain("tax-calc");
    // MEDIUM pairs now appear in the same table
    expect(html).toContain("user-auth");
    expect(html).toContain("user-profile");
    expect(html).toContain("MEDIUM");
    // Conflicts by Skill section
    expect(html).toContain("Conflicts by Skill");
    // Other sections unchanged
    expect(html).toContain("Scope Overload");
    expect(html).toContain("mega-skill");
    expect(html).toContain("1200 chars");
    expect(html).toContain("Duplicate Skills");
    expect(html).toContain("invoice-generator/SKILL.md");
    expect(html).toContain("Next Steps");
    expect(html).toContain("homingo audit");
    expect(html).toContain("homingo lint --fix");
    expect(html).toContain("Rename or remove duplicate skills");
    // Actionable --pair commands for CRITICAL and HIGH findings
    expect(html).toContain("Lint specific pairs");
    expect(html).toContain("homingo lint --pair invoice-gen,invoice-summary");
    expect(html).toContain("homingo lint --pair tax-calc,tax-report");
    // MEDIUM pairs should NOT generate --pair commands
    expect(html).not.toContain("homingo lint --pair user-auth,user-profile");
  });

  it("renders scan report cleanly when fleet is healthy", () => {
    const meta = makeMeta("scan");
    meta.result = {
      type: "scan",
      totalSkills: 5,
      totalPossiblePairs: 10,
      conflictingPairs: 0,
      overloadedSkills: 0,
      duplicateSkills: 0,
      healthScore: 100,
    };

    const scanData: ScanData = {
      totalSkills: 5,
      totalPossiblePairs: 10,
      healthScore: 100,
      overlapPairs: [],
      overloadFindings: [],
      duplicateFindings: [],
    };

    const html = generateHtml("scan", meta, scanData);

    expect(html).toContain("Scan Report");
    expect(html).toContain("100/100");
    expect(html).toContain("Fleet Looks Healthy");
    expect(html).toContain("callout-success");
    // No conflict/overload tables — only summary cards and success callout
    expect(html).not.toContain("<tbody>");
    expect(html).not.toContain("Next Steps");
  });
});
