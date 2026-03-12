import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  selectPairs,
  selectNeighbors,
  tokenizeOrdered,
  extractBigrams,
} from "../src/shadow-router/pair-selector.js";
import { parseSkills } from "../src/skills/parser.js";
import type { Skill } from "../src/types.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures/skills");

function skill(name: string, description: string): Skill {
  return { name, description, filePath: `/skills/${name}/SKILL.md` };
}

describe("selectPairs", () => {
  it("returns empty for fewer than 2 skills", () => {
    const result = selectPairs([skill("a", "does something")], false);
    expect(result.selectedPairs).toHaveLength(0);
    expect(result.totalPossiblePairs).toBe(0);
  });

  it("calculates total possible pairs correctly", () => {
    const skills = [
      skill("a", "handles invoices"),
      skill("b", "handles taxes"),
      skill("c", "handles legal"),
    ];
    const result = selectPairs(skills, true);
    expect(result.totalPossiblePairs).toBe(3); // 3 choose 2
  });

  it("returns all pairs when allPairs is true", () => {
    const skills = [
      skill("a", "handles invoices and billing"),
      skill("b", "handles taxes and deductions"),
      skill("c", "handles legal contracts"),
    ];
    const result = selectPairs(skills, true);
    expect(result.selectedPairs).toHaveLength(3);
    expect(result.skippedPairs).toBe(0);
  });

  it("filters low-overlap pairs when allPairs is false", () => {
    const skills = [
      skill("legal-review", "reviews legal documents, contracts, and compliance issues"),
      skill("legal-compliance", "ensures compliance with legal requirements and regulations"),
      skill("code-review", "reviews source code for bugs and security vulnerabilities"),
    ];
    const result = selectPairs(skills, false);
    expect(result.selectedPairs.length).toBeGreaterThanOrEqual(1);
    // The legal pair should be first (highest overlap)
    const firstPair = result.selectedPairs[0];
    const pairNames = [firstPair.skillA.name, firstPair.skillB.name].sort();
    expect(pairNames).toEqual(["legal-compliance", "legal-review"]);
  });

  it("sorts pairs by overlap score descending", () => {
    const skills = [
      skill("legal-review", "reviews legal documents, contracts, and compliance issues"),
      skill("legal-compliance", "ensures compliance with legal requirements and regulations"),
      skill("code-review", "reviews source code for bugs and security vulnerabilities"),
      skill("tax-optimizer", "handles tax document analysis and deduction optimization"),
    ];
    const result = selectPairs(skills, true);
    for (let i = 1; i < result.selectedPairs.length; i++) {
      expect(result.selectedPairs[i].overlapScore).toBeLessThanOrEqual(
        result.selectedPairs[i - 1].overlapScore
      );
    }
  });

  it("guarantees at least 3 pairs when enough skills exist", () => {
    const skills = [
      skill("alpha", "completely unique functionality alpha"),
      skill("beta", "entirely different purpose beta"),
      skill("gamma", "unrelated capability gamma"),
      skill("delta", "distinct operation delta"),
    ];
    const result = selectPairs(skills, false);
    expect(result.selectedPairs.length).toBeGreaterThanOrEqual(3);
  });

  it("caps at 30 pairs max", () => {
    // 9 skills = 36 possible pairs
    const skills = Array.from({ length: 9 }, (_, i) =>
      skill(`skill-${i}`, `handles tasks related to category ${i} processing and management`)
    );
    const result = selectPairs(skills, false);
    expect(result.selectedPairs.length).toBeLessThanOrEqual(30);
  });

  it("includes overlap reason with shared keywords", () => {
    const skills = [
      skill("legal-review", "reviews legal documents and contracts"),
      skill("legal-compliance", "ensures legal compliance and contract adherence"),
    ];
    const result = selectPairs(skills, false);
    expect(result.selectedPairs[0].reason).toContain("Shared keywords");
  });
});

describe("selectPairs with fixtures", () => {
  it("calculates 55 total possible pairs for 11 skills", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, true);
    // 11 choose 2 = 55
    expect(result.totalPossiblePairs).toBe(55);
    expect(result.selectedPairs).toHaveLength(55);
  });

  it("ranks document-summary ↔ invoice-summary as the highest-overlap pair", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, false);
    // document-summary and invoice-summary share "documents", "extracts", "items"
    const firstPair = result.selectedPairs[0];
    const pairNames = [firstPair.skillA.name, firstPair.skillB.name].sort();
    expect(pairNames).toEqual(["document-summary", "invoice-summary"]);
    expect(firstPair.overlapScore).toBeGreaterThan(0.15);
  });

  it("ranks legal-review ↔ legal-compliance as a high-overlap pair", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, false);
    const legalPair = result.selectedPairs.find(
      (p) =>
        (p.skillA.name === "legal-review" && p.skillB.name === "legal-compliance") ||
        (p.skillA.name === "legal-compliance" && p.skillB.name === "legal-review")
    );
    expect(legalPair).toBeDefined();
    expect(legalPair!.overlapScore).toBeGreaterThan(0.1);
  });

  it("ranks security-audit ↔ code-review higher than security-audit ↔ invoice-summary", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, true);
    const secCodePair = result.selectedPairs.find(
      (p) =>
        (p.skillA.name === "security-audit" && p.skillB.name === "code-review") ||
        (p.skillA.name === "code-review" && p.skillB.name === "security-audit")
    );
    const secInvoicePair = result.selectedPairs.find(
      (p) =>
        (p.skillA.name === "security-audit" && p.skillB.name === "invoice-summary") ||
        (p.skillA.name === "invoice-summary" && p.skillB.name === "security-audit")
    );
    expect(secCodePair).toBeDefined();
    expect(secInvoicePair).toBeDefined();
    expect(secCodePair!.overlapScore).toBeGreaterThan(secInvoicePair!.overlapScore);
  });

  it("ranks legal-compliance ↔ security-audit higher than contract-drafting ↔ invoice-summary", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, true);
    // Both share "compliance" and "audit/standards" keywords
    const complianceAuditPair = result.selectedPairs.find(
      (p) =>
        (p.skillA.name === "legal-compliance" && p.skillB.name === "security-audit") ||
        (p.skillA.name === "security-audit" && p.skillB.name === "legal-compliance")
    );
    const contractInvoicePair = result.selectedPairs.find(
      (p) =>
        (p.skillA.name === "contract-drafting" && p.skillB.name === "invoice-summary") ||
        (p.skillA.name === "invoice-summary" && p.skillB.name === "contract-drafting")
    );
    expect(complianceAuditPair).toBeDefined();
    expect(contractInvoicePair).toBeDefined();
    expect(complianceAuditPair!.overlapScore).toBeGreaterThan(contractInvoicePair!.overlapScore);
  });

  it("skips some pairs when not using allPairs", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const result = selectPairs(skills, false);
    expect(result.skippedPairs).toBeGreaterThan(0);
    expect(result.selectedPairs.length).toBeLessThan(55);
  });
});

describe("selectNeighbors", () => {
  const fleet = [
    skill("legal-review", "reviews legal documents, contracts, and compliance issues"),
    skill("legal-compliance", "ensures compliance with legal requirements and regulations"),
    skill("code-review", "reviews source code for bugs and security vulnerabilities"),
    skill("tax-optimizer", "handles tax document analysis and deduction optimization"),
    skill("invoice-summary", "processes invoices, bills, and payment records"),
  ];

  it("excludes the target skill from results", () => {
    const target = fleet[0];
    const neighbors = selectNeighbors(target, fleet, 5);
    const neighborNames = neighbors.map((p) => p.skillB.name);
    expect(neighborNames).not.toContain(target.name);
  });

  it("returns at most maxNeighbors results", () => {
    const target = fleet[0];
    const neighbors = selectNeighbors(target, fleet, 2);
    expect(neighbors).toHaveLength(2);
  });

  it("sorts neighbors by overlap score descending", () => {
    const target = fleet[0]; // legal-review
    const neighbors = selectNeighbors(target, fleet, 5);
    for (let i = 1; i < neighbors.length; i++) {
      expect(neighbors[i].overlapScore).toBeLessThanOrEqual(neighbors[i - 1].overlapScore);
    }
  });

  it("ranks the most similar skill first", () => {
    const target = fleet[0]; // legal-review
    const neighbors = selectNeighbors(target, fleet, 5);
    expect(neighbors[0].skillB.name).toBe("legal-compliance");
  });

  it("sets target as skillA in all pairs", () => {
    const target = fleet[2]; // code-review
    const neighbors = selectNeighbors(target, fleet, 5);
    for (const pair of neighbors) {
      expect(pair.skillA.name).toBe("code-review");
    }
  });
});

describe("selectNeighbors with fixtures", () => {
  it("finds contract-drafting as a top neighbor of legal-review", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const target = skills.find((s) => s.name === "legal-review")!;
    const neighbors = selectNeighbors(target, skills, 3);
    const neighborNames = neighbors.map((p) => p.skillB.name);
    expect(neighborNames).toContain("contract-drafting");
  });

  it("finds security-audit as a top neighbor of code-review", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const target = skills.find((s) => s.name === "code-review")!;
    const neighbors = selectNeighbors(target, skills, 3);
    const neighborNames = neighbors.map((p) => p.skillB.name);
    expect(neighborNames).toContain("security-audit");
  });

  it("finds invoice-summary as the top neighbor of tax-optimizer", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const target = skills.find((s) => s.name === "tax-optimizer")!;
    const neighbors = selectNeighbors(target, skills, 3);
    // invoice-summary shares "handles" and "document" keywords
    expect(neighbors[0].skillB.name).toBe("invoice-summary");
  });
});

// --- Bigram and Enhanced Mode Tests ---

describe("tokenizeOrdered", () => {
  it("returns tokens in order, lowercased, without stop words", () => {
    const tokens = tokenizeOrdered("Reviews legal documents and contracts");
    expect(tokens).toEqual(["reviews", "legal", "documents", "contracts"]);
  });

  it("removes short words (length <= 2)", () => {
    const tokens = tokenizeOrdered("an AI tool is good");
    // "an" (stop word), "ai" (2 chars), "tool" (4), "is" (stop word), "good" (4)
    expect(tokens).toEqual(["tool", "good"]);
  });

  it("strips punctuation", () => {
    const tokens = tokenizeOrdered("handles tax-related document analysis, tax code lookups.");
    expect(tokens).toContain("handles");
    expect(tokens).toContain("tax");
    expect(tokens).toContain("related");
    expect(tokens).toContain("document");
    expect(tokens).toContain("analysis");
  });

  it("returns empty array for empty string", () => {
    expect(tokenizeOrdered("")).toEqual([]);
  });

  it("preserves duplicates (unlike tokenize Set)", () => {
    const tokens = tokenizeOrdered("tax analysis and tax optimization");
    const taxCount = tokens.filter((t) => t === "tax").length;
    expect(taxCount).toBe(2);
  });
});

describe("extractBigrams", () => {
  it("produces consecutive token pairs", () => {
    const bigrams = extractBigrams(["reviews", "legal", "documents"]);
    expect(bigrams).toEqual(new Set(["reviews_legal", "legal_documents"]));
  });

  it("returns empty set for single token", () => {
    const bigrams = extractBigrams(["reviews"]);
    expect(bigrams.size).toBe(0);
  });

  it("returns empty set for empty array", () => {
    const bigrams = extractBigrams([]);
    expect(bigrams.size).toBe(0);
  });

  it("deduplicates repeated bigrams", () => {
    // "tax analysis tax analysis" → bigrams include "tax_analysis" twice, but Set dedupes
    const bigrams = extractBigrams(["tax", "analysis", "tax", "analysis"]);
    expect(bigrams.has("tax_analysis")).toBe(true);
    expect(bigrams.has("analysis_tax")).toBe(true);
    expect(bigrams.size).toBe(2); // tax_analysis, analysis_tax (third is duplicate)
  });

  it("produces correct count for a longer sequence", () => {
    const tokens = ["handles", "tax", "related", "document", "analysis"];
    const bigrams = extractBigrams(tokens);
    expect(bigrams.size).toBe(4); // n-1 bigrams for n tokens
  });
});

describe("selectPairs enhanced mode", () => {
  it("boosts score for skills sharing phrase patterns", () => {
    const skills = [
      skill("report-gen", "generates audit reports and compliance summaries for review"),
      skill("audit-reports", "generates audit reports and findings documentation for teams"),
    ];
    const defaultResult = selectPairs(skills, true, false);
    const enhancedResult = selectPairs(skills, true, true);

    const defaultScore = defaultResult.selectedPairs[0].overlapScore;
    const enhancedScore = enhancedResult.selectedPairs[0].overlapScore;

    // Enhanced should be higher when shared bigrams exist (e.g. "generates_audit", "audit_reports")
    expect(enhancedScore).toBeGreaterThan(defaultScore);
  });

  it("reduces score slightly when no bigrams overlap", () => {
    // These share some unigrams but no bigram patterns
    const skills = [
      skill("alpha", "processes documents quickly for review"),
      skill("beta", "review documents processes efficiently"),
    ];
    const defaultResult = selectPairs(skills, true, false);
    const enhancedResult = selectPairs(skills, true, true);

    const defaultScore = defaultResult.selectedPairs[0].overlapScore;
    const enhancedScore = enhancedResult.selectedPairs[0].overlapScore;

    // With shared unigrams but different bigrams, enhanced score = base*0.7 + bigram*0.3
    // Since bigram overlap is low, enhanced score should be <= default
    expect(enhancedScore).toBeLessThanOrEqual(defaultScore);
  });

  it("default mode (enhanced=false) produces identical scores to no flag", () => {
    const skills = [
      skill("legal-review", "reviews legal documents, contracts, and compliance issues"),
      skill("legal-compliance", "ensures compliance with legal requirements and regulations"),
      skill("code-review", "reviews source code for bugs and security vulnerabilities"),
    ];
    const noFlag = selectPairs(skills, true);
    const explicitFalse = selectPairs(skills, true, false);

    expect(noFlag.selectedPairs.length).toBe(explicitFalse.selectedPairs.length);
    for (let i = 0; i < noFlag.selectedPairs.length; i++) {
      expect(noFlag.selectedPairs[i].overlapScore).toBe(
        explicitFalse.selectedPairs[i].overlapScore
      );
    }
  });

  it("includes shared bigrams in explanation when enhanced", () => {
    const skills = [
      skill("report-gen", "generates audit reports and compliance summaries"),
      skill("audit-reports", "generates audit reports and findings documentation"),
    ];
    const result = selectPairs(skills, true, true);
    // Should mention shared phrases in the reason
    expect(result.selectedPairs[0].reason).toContain("phrases:");
  });

  it("does not include phrases in explanation when not enhanced", () => {
    const skills = [
      skill("report-gen", "generates audit reports and compliance summaries"),
      skill("audit-reports", "generates audit reports and findings documentation"),
    ];
    const result = selectPairs(skills, true, false);
    expect(result.selectedPairs[0].reason).not.toContain("phrases:");
  });
});

describe("selectPairs enhanced mode with fixtures", () => {
  it("preserves existing top pair ranking in enhanced mode", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const defaultResult = selectPairs(skills, false, false);
    const enhancedResult = selectPairs(skills, false, true);

    // document-summary ↔ invoice-summary should still be the top pair
    const enhancedTop = enhancedResult.selectedPairs[0];
    const topNames = [enhancedTop.skillA.name, enhancedTop.skillB.name].sort();
    const defaultTop = defaultResult.selectedPairs[0];
    const defaultNames = [defaultTop.skillA.name, defaultTop.skillB.name].sort();
    expect(topNames).toEqual(defaultNames);
  });

  it("enhanced mode changes scores but keeps relative ordering similar", async () => {
    const { skills } = await parseSkills(FIXTURES_DIR);
    const enhancedResult = selectPairs(skills, true, true);

    // Scores should still be sorted descending
    for (let i = 1; i < enhancedResult.selectedPairs.length; i++) {
      expect(enhancedResult.selectedPairs[i].overlapScore).toBeLessThanOrEqual(
        enhancedResult.selectedPairs[i - 1].overlapScore
      );
    }
  });
});

describe("selectNeighbors enhanced mode", () => {
  const fleet = [
    skill("legal-review", "reviews legal documents, contracts, and compliance issues"),
    skill("legal-compliance", "ensures compliance with legal requirements and regulations"),
    skill("code-review", "reviews source code for bugs and security vulnerabilities"),
  ];

  it("passes enhanced flag through to scoring", () => {
    const target = fleet[0];
    const defaultNeighbors = selectNeighbors(target, fleet, 5, false);
    const enhancedNeighbors = selectNeighbors(target, fleet, 5, true);

    // Scores should differ between modes
    const defaultFirst = defaultNeighbors[0].overlapScore;
    const enhancedFirst = enhancedNeighbors[0].overlapScore;
    expect(defaultFirst).not.toBe(enhancedFirst);
  });

  it("default (no flag) matches explicit false", () => {
    const target = fleet[0];
    const noFlag = selectNeighbors(target, fleet, 5);
    const explicitFalse = selectNeighbors(target, fleet, 5, false);

    expect(noFlag.length).toBe(explicitFalse.length);
    for (let i = 0; i < noFlag.length; i++) {
      expect(noFlag[i].overlapScore).toBe(explicitFalse[i].overlapScore);
    }
  });
});
