import { randomUUID } from "node:crypto";
import type { LLMProvider } from "../providers/index.js";
import type { Skill, GeneratedPrompt } from "../types.js";

interface GeneratorOptions {
  provider: LLMProvider;
  model: string;
}

export class PromptGenerator {
  private provider: LLMProvider;
  private model: string;

  constructor(options: GeneratorOptions) {
    this.provider = options.provider;
    this.model = options.model;
  }

  async generate(skillA: Skill, skillB: Skill, count: number = 50): Promise<GeneratedPrompt[]> {
    const metaPrompt = `You are an adversarial tester for an AI routing system.

You have two skills:

Skill A — "${skillA.name}":
${skillA.description}

Skill B — "${skillB.name}":
${skillB.description}

Generate exactly ${count} user prompts that are intentionally ambiguous — meaning each prompt should be phrased so that, based on the text alone, a reasonable person could plausibly argue the request belongs to either Skill A or Skill B.

For each prompt, also specify:
- Which skill SHOULD handle it (use the exact skill name: either "${skillA.name}" or "${skillB.name}")
- Why it could be mistaken for the other skill

Return JSON only. No markdown fences, no preamble.
[
  {
    "text": "the user prompt",
    "expectedSkill": "exact skill name",
    "ambiguityReason": "why this is ambiguous between the two skills"
  }
]`;

    const { text } = await this.provider.createMessage({
      model: this.model,
      maxTokens: 4096,
      messages: [{ role: "user", content: metaPrompt }],
    });

    let parsed: Array<{
      text: string;
      expectedSkill: string;
      ambiguityReason: string;
    }>;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Failed to parse prompt generation response: ${text.slice(0, 200)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Prompt generation did not return an array");
    }

    return parsed.map((p) => ({
      id: randomUUID(),
      text: p.text,
      expectedSkill: p.expectedSkill,
      targetPair: [skillA.name, skillB.name] as [string, string],
      ambiguityReason: p.ambiguityReason,
    }));
  }
}
