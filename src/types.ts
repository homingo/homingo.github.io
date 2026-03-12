export interface Skill {
  name: string;
  description: string;
  filePath: string;
  examples?: string[];
}

export interface PromptGeneratorInput {
  targetSkill: Skill;
  competingSkill: Skill;
  count: number;
}

export interface GeneratedPrompt {
  id: string;
  text: string;
  expectedSkill: string;
  targetPair: [string, string];
  ambiguityReason: string;
}

export interface RoutingDecision {
  promptId: string;
  promptText: string;
  selectedSkill: string;
  expectedSkill: string;
  isCorrect: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface PairConflictReport {
  skillA: string;
  skillB: string;
  promptsTested: number;
  routingAccuracy: number;
  severityLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  misroutes: RoutingDecision[];
  fragileCorrects: RoutingDecision[];
  topFailurePattern: string;
  recommendedAction: string;
}

export interface FleetAuditReport {
  generatedAt: string;
  modelUsed: string;
  totalSkills: number;
  totalPairsTested: number;
  estimatedFleetErrorRate: number;
  criticalPairs: PairConflictReport[];
  highPairs: PairConflictReport[];
  mediumPairs: PairConflictReport[];
  lowPairs: PairConflictReport[];
  topFiveOffenders: string[];
  exportPath: string;
}

export interface DuplicateSkill {
  name: string;
  keptPath: string;
  skippedPath: string;
}

export interface ShardedSkill {
  name: string;
  description: string;
  role: "sub-skill" | "orchestrator";
  intents: string[];
  negativeTriggers: string[];
}

export interface ShardPlan {
  originalSkill: Skill;
  reason: string;
  descriptionLength: number;
  identifiedIntents: string[];
  subSkills: ShardedSkill[];
  orchestrator: ShardedSkill;
}

export interface HomingoConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  model: string;
  /** Optional override for the model used during routing simulation. Auto-derived if not set. */
  simModel?: string;
  skillsDir: string;
  shadowRouter: {
    promptsPerPair: number;
    minPrompts: number;
    accuracyThreshold: number;
    maxIterations: number;
  };
  output: {
    reportDir: string;
    format: "json" | "markdown" | "both";
  };
}
