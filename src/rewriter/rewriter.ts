import type { LLMProvider } from "../providers/index.js";
import type { Skill, PairConflictReport } from "../types.js";

interface RewriterOptions {
  provider: LLMProvider;
  model: string;
}

export interface RewriteSuggestion {
  skillName: string;
  originalDescription: string;
  rewrittenDescription: string;
  reasoning: string;
  conflictsWith: string[];
}

export class DescriptionRewriter {
  private provider: LLMProvider;
  private model: string;

  constructor(options: RewriterOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  async rewrite(skill: Skill, conflicts: PairConflictReport[]): Promise<RewriteSuggestion> {
    const conflictDetails = conflicts
      .map((c) => {
        const other = c.skillA === skill.name ? c.skillB : c.skillA;
        const sampleMisroutes = c.misroutes
          .slice(0, 3)
          .map(
            (m) =>
              `  - "${m.promptText}" → routed to ${m.selectedSkill} instead of ${m.expectedSkill}`
          )
          .join("\n");
        return `Conflict with "${other}" (${c.routingAccuracy}% accuracy):\n  Pattern: ${c.topFailurePattern}\n  Sample misroutes:\n${sampleMisroutes}`;
      })
      .join("\n\n");

    const prompt = `You are a skill description optimizer for an AI routing system.

A skill's description determines how an LLM router selects it. The following skill has routing conflicts — its description overlaps with other skills, causing misroutes.

SKILL TO FIX:
Name: "${skill.name}"
Current description: "${skill.description}"

ROUTING CONFLICTS:
${conflictDetails}

Rewrite the description to reduce routing conflicts. Guidelines:
- Add negative triggers ("Does NOT handle...") to disambiguate from conflicting skills
- Be specific about what this skill handles vs what it doesn't
- Keep it under 1024 characters
- Preserve the skill's core purpose — don't narrow it too much
- Focus on the boundary between this skill and its conflicts

Return JSON only. No markdown fences, no preamble.
{
  "rewrittenDescription": "the improved description",
  "reasoning": "one sentence explaining the key changes"
}`;

    const { text } = await this.provider.createMessage({
      model: this.model,
      maxTokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    let parsed: { rewrittenDescription: string; reasoning: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Failed to parse rewrite response: ${text.slice(0, 200)}`);
    }

    return {
      skillName: skill.name,
      originalDescription: skill.description,
      rewrittenDescription: parsed.rewrittenDescription,
      reasoning: parsed.reasoning,
      conflictsWith: conflicts.map((c) => (c.skillA === skill.name ? c.skillB : c.skillA)),
    };
  }
}
