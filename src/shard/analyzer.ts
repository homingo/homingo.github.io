import type { LLMProvider } from "../providers/index.js";
import type { Skill, ShardPlan, ShardedSkill } from "../types.js";

interface AnalyzerOptions {
  provider: LLMProvider;
  model: string;
}

export interface OverloadResult {
  isOverloaded: boolean;
  reason: string;
  descriptionLength: number;
}

/**
 * Heuristic indicators of multi-intent descriptions:
 * - Multiple semicolons suggest distinct responsibility sections
 * - Many commas with conjunctions suggest a laundry list of capabilities
 * - Descriptions over 1024 chars are likely trying to do too much
 */
const OVERLOAD_CHAR_THRESHOLD = 1024;
const MULTI_INTENT_SEMICOLONS = 2;
const MULTI_INTENT_CLAUSES = 4;

export class ShardAnalyzer {
  private provider: LLMProvider;
  private model: string;

  constructor(options: AnalyzerOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  /**
   * Pure logic check — no API calls.
   * Determines if a skill description is overloaded based on heuristics.
   */
  analyzeOverload(skill: Skill): OverloadResult {
    const len = skill.description.length;
    const reasons: string[] = [];

    // Check character length
    if (len > OVERLOAD_CHAR_THRESHOLD) {
      reasons.push(`description is ${len} chars (threshold: ${OVERLOAD_CHAR_THRESHOLD})`);
    }

    // Count semicolons as intent separators
    const semicolonCount = (skill.description.match(/;/g) || []).length;
    if (semicolonCount >= MULTI_INTENT_SEMICOLONS) {
      reasons.push(`${semicolonCount} semicolons suggest multiple distinct responsibilities`);
    }

    // Count independent clauses (sentences or clauses separated by periods/conjunctions)
    const sentenceCount = skill.description
      .split(/[.!]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20).length;
    if (sentenceCount >= MULTI_INTENT_CLAUSES) {
      reasons.push(`${sentenceCount} distinct clauses suggest scope overload`);
    }

    // Check for "and" + verb patterns suggesting multiple responsibilities
    const andVerbPattern =
      /\band\s+(also\s+)?(handles?|processes?|manages?|generates?|creates?|analyzes?)/gi;
    const andVerbMatches = skill.description.match(andVerbPattern) || [];
    if (andVerbMatches.length >= 2) {
      reasons.push(`multiple "and [verb]" patterns suggest combined responsibilities`);
    }

    const isOverloaded = reasons.length > 0;
    return {
      isOverloaded,
      reason: isOverloaded ? reasons.join("; ") : "Description is within acceptable scope",
      descriptionLength: len,
    };
  }

  /**
   * Uses the configured LLM to analyze the skill and generate a shard plan.
   * Identifies distinct intents and proposes sub-skills + orchestrator.
   */
  async generateShardPlan(skill: Skill): Promise<ShardPlan> {
    const prompt = `You are an AI skill architect. A skill's description determines how an LLM router selects it. The following skill description is overloaded — it covers too many distinct intents, which causes routing confusion.

SKILL TO SHARD:
Name: "${skill.name}"
Description: "${skill.description}"

Analyze the description and:
1. Identify the distinct intents/responsibilities (2-4 groups)
2. Propose sub-skills, each focused on one intent group
3. Generate an orchestrator skill that delegates to the sub-skills

Naming convention:
- Sub-skills: "${skill.name}-{intent-suffix}" (e.g., "${skill.name}-analysis", "${skill.name}-generation")
- Orchestrator: "${skill.name}-orchestrator"

Requirements for each sub-skill:
- Description must be under 512 characters
- Include 1-3 negative triggers ("Does NOT handle...")
- Each sub-skill should be clearly distinct from the others

Requirements for the orchestrator:
- Description explains it delegates to the sub-skills
- Lists what each sub-skill handles
- Include negative triggers for tasks none of the sub-skills handle

Return JSON only. No markdown fences, no preamble.
{
  "identifiedIntents": ["intent1 description", "intent2 description"],
  "subSkills": [
    {
      "name": "skill-name-suffix",
      "description": "focused description under 512 chars",
      "intents": ["which intents this covers"],
      "negativeTriggers": ["Does NOT handle X"]
    }
  ],
  "orchestrator": {
    "name": "skill-name-orchestrator",
    "description": "orchestrator description",
    "intents": ["delegates to sub-skills for all intents"],
    "negativeTriggers": ["Does NOT handle X directly"]
  }
}`;

    const { text } = await this.provider.createMessage({
      model: this.model,
      maxTokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    let parsed: {
      identifiedIntents: string[];
      subSkills: Array<{
        name: string;
        description: string;
        intents: string[];
        negativeTriggers: string[];
      }>;
      orchestrator: {
        name: string;
        description: string;
        intents: string[];
        negativeTriggers: string[];
      };
    };

    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      throw new Error(`Failed to parse shard plan response: ${text.slice(0, 200)}`);
    }

    // Validate response structure
    if (
      !parsed.identifiedIntents ||
      !parsed.subSkills ||
      !parsed.orchestrator ||
      parsed.subSkills.length < 2
    ) {
      throw new Error("Invalid shard plan: need at least 2 sub-skills");
    }

    const subSkills: ShardedSkill[] = parsed.subSkills.map((s) => ({
      name: s.name,
      description: s.description,
      role: "sub-skill" as const,
      intents: s.intents,
      negativeTriggers: s.negativeTriggers || [],
    }));

    const orchestrator: ShardedSkill = {
      name: parsed.orchestrator.name,
      description: parsed.orchestrator.description,
      role: "orchestrator",
      intents: parsed.orchestrator.intents,
      negativeTriggers: parsed.orchestrator.negativeTriggers || [],
    };

    const overloadResult = this.analyzeOverload(skill);

    return {
      originalSkill: skill,
      reason: overloadResult.reason,
      descriptionLength: skill.description.length,
      identifiedIntents: parsed.identifiedIntents,
      subSkills,
      orchestrator,
    };
  }
}

/**
 * Strip markdown code fences from LLM responses.
 * Some models wrap JSON in ```json...``` or ```...``` despite being told not to.
 */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:\w+)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}
