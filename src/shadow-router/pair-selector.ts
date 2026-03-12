import type { Skill } from "../types.js";

export interface SkillPair {
  skillA: Skill;
  skillB: Skill;
  overlapScore: number;
  reason: string;
}

export interface PairSelectionResult {
  selectedPairs: SkillPair[];
  skippedPairs: number;
  totalPossiblePairs: number;
}

export function selectPairs(
  skills: Skill[],
  allPairs: boolean = false,
  enhanced: boolean = false
): PairSelectionResult {
  const totalPossiblePairs = (skills.length * (skills.length - 1)) / 2;
  const allSkillPairs: SkillPair[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const score = computeOverlapScore(skills[i], skills[j], enhanced);
      const reason = explainOverlap(skills[i], skills[j], score, enhanced);
      allSkillPairs.push({
        skillA: skills[i],
        skillB: skills[j],
        overlapScore: score,
        reason,
      });
    }
  }

  allSkillPairs.sort((a, b) => b.overlapScore - a.overlapScore);

  if (allPairs) {
    return {
      selectedPairs: allSkillPairs,
      skippedPairs: 0,
      totalPossiblePairs,
    };
  }

  // Select pairs with overlap score > 0.1, capped at 30
  const threshold = 0.1;
  const maxPairs = 30;
  const selected = allSkillPairs.filter((p) => p.overlapScore > threshold).slice(0, maxPairs);

  // If fewer than 3 pairs selected but more exist, take top 3 anyway
  const finalSelection =
    selected.length < 3 && allSkillPairs.length >= 3 ? allSkillPairs.slice(0, 3) : selected;

  return {
    selectedPairs: finalSelection,
    skippedPairs: totalPossiblePairs - finalSelection.length,
    totalPossiblePairs,
  };
}

export function selectNeighbors(
  target: Skill,
  fleet: Skill[],
  maxNeighbors: number = 5,
  enhanced: boolean = false
): SkillPair[] {
  const others = fleet.filter((s) => s.name !== target.name);
  const pairs: SkillPair[] = others.map((other) => {
    const score = computeOverlapScore(target, other, enhanced);
    return {
      skillA: target,
      skillB: other,
      overlapScore: score,
      reason: explainOverlap(target, other, score, enhanced),
    };
  });

  pairs.sort((a, b) => b.overlapScore - a.overlapScore);
  return pairs.slice(0, maxNeighbors);
}

// --- Tokenization ---

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "in",
  "of",
  "with",
  "is",
  "it",
  "this",
  "that",
  "use",
  "when",
  "from",
  "by",
  "on",
]);

export function tokenizeOrdered(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function tokenize(text: string): Set<string> {
  return new Set(tokenizeOrdered(text));
}

// --- Bigram extraction ---

export function extractBigrams(tokens: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}

// --- Scoring ---

function computeOverlapScore(a: Skill, b: Skill, enhanced: boolean = false): number {
  const nameScore = nameKeywordOverlap(a.name, b.name);
  const descScore = jaccardSimilarity(tokenize(a.description), tokenize(b.description));

  const baseScore = nameScore * 0.4 + descScore * 0.6;

  if (!enhanced) return baseScore;

  const bigramsA = extractBigrams(tokenizeOrdered(a.description));
  const bigramsB = extractBigrams(tokenizeOrdered(b.description));
  const bigramScore = jaccardSimilarity(bigramsA, bigramsB);

  // Blend: 70% unigram-based, 30% bigram-based
  return baseScore * 0.7 + bigramScore * 0.3;
}

function nameKeywordOverlap(nameA: string, nameB: string): number {
  const wordsA = tokenize(nameA);
  const wordsB = tokenize(nameB);
  return jaccardSimilarity(wordsA, wordsB);
}

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function explainOverlap(a: Skill, b: Skill, score: number, enhanced: boolean = false): string {
  const tokensA = tokenize(a.description);
  const tokensB = tokenize(b.description);
  const sharedWords = [...tokensA].filter((w) => tokensB.has(w));

  let explanation: string;

  if (sharedWords.length > 0) {
    explanation = `Shared keywords: ${sharedWords.slice(0, 5).join(", ")}`;
  } else if (score > 0) {
    explanation = "Name similarity detected";
  } else {
    return "Low overlap — included for coverage";
  }

  if (enhanced) {
    const bigramsA = extractBigrams(tokenizeOrdered(a.description));
    const bigramsB = extractBigrams(tokenizeOrdered(b.description));
    const sharedBigrams = [...bigramsA].filter((bg) => bigramsB.has(bg));
    if (sharedBigrams.length > 0) {
      explanation += ` + phrases: ${sharedBigrams
        .slice(0, 3)
        .map((bg) => bg.replace("_", " "))
        .join(", ")}`;
    }
  }

  return explanation;
}
