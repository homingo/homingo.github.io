import type { LLMProvider } from "../providers/index.js";
import type { Skill, RoutingDecision, GeneratedPrompt } from "../types.js";
import { pMap } from "../utils/concurrency.js";

interface SimulatorOptions {
  provider: LLMProvider;
  model: string;
  concurrency?: number;
}

export class RoutingSimulator {
  private provider: LLMProvider;
  private model: string;
  private concurrency: number;

  constructor(options: SimulatorOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.concurrency = options.concurrency ?? 10;
  }

  async simulate(prompt: GeneratedPrompt, fullManifest: Skill[]): Promise<RoutingDecision> {
    const skillList = fullManifest.map((s) => `- ${s.name}: ${s.description}`).join("\n");

    const systemPrompt = `You are a skill router. Given a user's request and a list of available skills, select the single most appropriate skill to handle the request, meaning the one skill whose stated purpose most directly matches the user's primary intent better than any other listed skill.

Respond with JSON only. No markdown fences, no preamble.
{
  "selectedSkill": "<exact skill name from the list; must match one listed skill verbatim>",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<exactly one sentence explaining the primary match>"
}`;

    const userPrompt = `User request: "${prompt.text}"

Available skills:
${skillList}`;

    const { text } = await this.provider.createMessage({
      model: this.model,
      maxTokens: 256,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    let parsed: { selectedSkill: string; confidence: string; reasoning: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        selectedSkill: "PARSE_ERROR",
        confidence: "low",
        reasoning: `Failed to parse routing response: ${text.slice(0, 100)}`,
      };
    }

    const confidence = (
      ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low"
    ) as "high" | "medium" | "low";

    return {
      promptId: prompt.id,
      promptText: prompt.text,
      selectedSkill: parsed.selectedSkill,
      expectedSkill: prompt.expectedSkill,
      isCorrect: parsed.selectedSkill === prompt.expectedSkill,
      confidence,
      reasoning: parsed.reasoning,
    };
  }

  async simulateBatch(
    prompts: GeneratedPrompt[],
    fullManifest: Skill[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<RoutingDecision[]> {
    let completed = 0;

    const results = await pMap(
      prompts,
      async (prompt) => {
        const result = await this.simulate(prompt, fullManifest);
        completed++;
        onProgress?.(completed, prompts.length);
        return result;
      },
      this.concurrency
    );

    return results;
  }
}
