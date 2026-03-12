import type { LLMProvider } from "../providers/index.js";
import type { Skill, PairConflictReport } from "../types.js";

interface RewriterOptions {
  provider: LLMProvider;
  model: string;
}

// ── Legacy type (kept for backward compat with lint report rendering) ──

export interface RewriteSuggestion {
  skillName: string;
  originalDescription: string;
  rewrittenDescription: string;
  reasoning: string;
  conflictsWith: string[];
}

// ── New pair-level types ────────────────────────────────────────

export type PairVerdict = "rewrite" | "merge";

export interface PairRewriteResult {
  verdict: PairVerdict;
  /** Present when verdict is "rewrite" */
  rewrites?: Array<{
    skillName: string;
    originalDescription: string;
    rewrittenDescription: string;
  }>;
  /** Present when verdict is "merge" */
  merge?: {
    mergedName: string;
    mergedDescription: string;
  };
  reasoning: string;
  skillA: string;
  skillB: string;
}

export interface RewriteContext {
  iteration: number;
  previousAccuracy?: number;
  currentAccuracy: number;
}

export class DescriptionRewriter {
  private provider: LLMProvider;
  private model: string;

  constructor(options: RewriterOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  /**
   * Coordinated pair-level rewrite. Sees BOTH skill descriptions and can
   * return either coordinated rewrites or a merge recommendation.
   */
  async rewritePair(
    skillA: Skill,
    skillB: Skill,
    report: PairConflictReport,
    context: RewriteContext
  ): Promise<PairRewriteResult> {
    const misrouteExamples = report.misroutes
      .slice(0, 5)
      .map(
        (m) =>
          `  - "${m.promptText}" → routed to "${m.selectedSkill}" instead of "${m.expectedSkill}"`
      )
      .join("\n");

    const escalationBlock = this.buildEscalationBlock(context);

    const prompt = `You are an expert at disambiguating AI skill routing descriptions.

Two skills are being confused by the LLM router. You must analyze BOTH descriptions together and produce coordinated changes that create a clear, unambiguous boundary.

SKILL A:
Name: "${skillA.name}"
Description: "${skillA.description}"

SKILL B:
Name: "${skillB.name}"
Description: "${skillB.description}"

ROUTING TEST RESULTS:
Accuracy: ${report.routingAccuracy}% (need ≥90%)
Top failure pattern: ${report.topFailurePattern}
Sample misroutes:
${misrouteExamples}
${escalationBlock}
YOUR TASK:

Decide: should these skills be REWRITTEN (they serve different purposes but descriptions overlap) or MERGED (they fundamentally do the same thing)?

If REWRITING — Guidelines:
- Lead each description with what's UNIQUE to that skill — not what they share
- Be bold — fundamentally restructure the descriptions if needed
- Add explicit "Does NOT handle: ..." clauses referencing the other skill's territory
- Use specific action verbs, concrete nouns — avoid vague terms like "manage", "handle", "process"
- Make the first sentence the disambiguation sentence — a reader should know the boundary immediately
- Each description must stand alone without needing to see the other
- Keep each under 1024 characters
- You may rewrite ONE or BOTH skills — rewrite whichever ones need it

If MERGING — Only recommend merge when:
- The skills genuinely serve the same job-to-be-done
- No realistic user would expect them to be separate capabilities
- Rewriting cannot create a meaningful boundary because there IS no boundary

Return JSON only. No markdown fences, no preamble.

For REWRITE verdict:
{
  "verdict": "rewrite",
  "rewrites": [
    { "skillName": "<name>", "originalDescription": "<current>", "rewrittenDescription": "<new>" }
  ],
  "reasoning": "one sentence explaining the key boundary you drew"
}

For MERGE verdict:
{
  "verdict": "merge",
  "merge": { "mergedName": "<combined-name>", "mergedDescription": "<combined-description>" },
  "reasoning": "one sentence explaining why these are the same skill"
}`;

    const { text } = await this.provider.createMessage({
      model: this.model,
      maxTokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    let parsed: {
      verdict: PairVerdict;
      rewrites?: Array<{
        skillName: string;
        originalDescription: string;
        rewrittenDescription: string;
      }>;
      merge?: { mergedName: string; mergedDescription: string };
      reasoning: string;
    };

    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      throw new Error(`Failed to parse rewrite response: ${text.slice(0, 200)}`);
    }

    // Validate the response shape
    if (parsed.verdict === "rewrite" && (!parsed.rewrites || parsed.rewrites.length === 0)) {
      throw new Error(`Rewrite verdict returned but no rewrites provided`);
    }
    if (parsed.verdict === "merge" && !parsed.merge) {
      throw new Error(`Merge verdict returned but no merge details provided`);
    }

    return {
      verdict: parsed.verdict,
      rewrites: parsed.rewrites,
      merge: parsed.merge,
      reasoning: parsed.reasoning,
      skillA: skillA.name,
      skillB: skillB.name,
    };
  }

  private buildEscalationBlock(context: RewriteContext): string {
    if (context.iteration <= 1) return "";

    const parts = [`\nESCALATION CONTEXT (iteration ${context.iteration}):`];

    if (context.previousAccuracy !== undefined) {
      const delta = context.currentAccuracy - context.previousAccuracy;
      const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
      parts.push(
        `Previous accuracy: ${context.previousAccuracy}% → Current: ${context.currentAccuracy}% (${deltaStr}pp)`
      );

      if (delta < 10) {
        parts.push(
          `WARNING: Previous rewrites barely moved the needle. You MUST take a fundamentally different approach.`
        );
        parts.push(
          `- If you returned "rewrite" last time, consider much more aggressive restructuring or switching to "merge"`
        );
        parts.push(
          `- Don't just add "Does NOT" clauses — completely rethink what makes each skill unique`
        );
        parts.push(
          `- If you can't articulate a clear boundary, these skills should probably be merged`
        );
      }
    }

    if (context.iteration >= 3) {
      parts.push(
        `STRONG SIGNAL: After ${context.iteration} iterations without resolution, strongly consider "merge" unless there is a genuinely distinct purpose for each skill.`
      );
    }

    return parts.join("\n");
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
