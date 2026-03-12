# Routing Drift

Routing drift is the gradual degradation of skill selection accuracy as an AI skill fleet grows.

## How It Happens

1. **You build 10 skills** — the model routes prompts correctly because descriptions are distinct
2. **You build 30 skills** — some descriptions start to overlap, but it mostly works
3. **You build 50+ skills** — the model increasingly picks the wrong skill. "Tax Optimizer" fires for invoice summaries. "Legal Review" and "Legal Compliance" blur together.

The root cause is **description overlap**. Each individual skill description seems reasonable in isolation, but the model has to choose between all of them simultaneously. As the fleet grows, the decision boundary between similar skills gets blurrier.

## Why It's Hard to See

- **No error signal** — the model picks *a* skill, it just picks the wrong one
- **Gradual onset** — accuracy drops slowly as skills accumulate
- **Silent overlap** — two descriptions can overlap significantly without anyone noticing
- **Author fragmentation** — different people write descriptions with different conventions

## What Homingo Does About It

Homingo detects routing drift before it affects users by:

1. **Heuristic pair selection** — identifies which skill pairs are likely to conflict based on textual similarity (Jaccard + bigram matching)
2. **Adversarial routing simulation** — generates prompts designed to confuse the model between two skills, then measures actual routing accuracy
3. **Conflict scoring** — ranks pairs by severity so you fix the worst offenders first
4. **Description rewriting** — suggests targeted changes to reduce overlap

## Key Insight

Routing drift is not a vector similarity problem. Two skills can have high embedding similarity but route correctly (because the model understands context), or low similarity but misroute (because key distinguishing words are missing). Homingo tests actual routing decisions, not textual distance.

## Further Reading

- [Shadow Router](/concepts/shadow-router) — how Homingo simulates routing
- [Scope Overload](/concepts/scope-overload) — when a single skill covers too many intents
- [homingo audit](/commands/audit) — detecting drift in your fleet
