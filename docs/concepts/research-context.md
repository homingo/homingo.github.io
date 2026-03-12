# Research Context

Homingo sits in an emerging category of tooling for large AI skill ecosystems.

Two recent papers are especially relevant:

- ["Organizing, Orchestrating, and Benchmarking Agent Skills at Ecosystem Scale"](https://arxiv.org/html/2603.02176v1)
- ["SkillOrchestra: Learning to Route Agents via Skill Transfer"](https://arxiv.org/pdf/2602.19672)

## What Those Papers Focus On

Both papers study what happens when an agent system has too many skills for flat, implicit routing to stay reliable.

They emphasize:

- **Structured skill representations** instead of a flat list of descriptions
- **Retrieval or routing at ecosystem scale**, not just one-off tool calls
- **Benchmarks and empirical evaluation** to measure whether the right capability is selected
- **Runtime orchestration** across many candidate skills, agents, or models

## Where Homingo Fits

Homingo solves a different but closely related problem: **skill fleet governance**.

Homingo is strongest before or alongside runtime orchestration:

- `homingo scan` finds overlap, duplicates, and overloaded skills with no API calls
- `homingo audit` measures routing ambiguity with adversarial prompts
- `homingo lint` suggests rewrites, merge candidates, and shard plans

That means Homingo is not primarily a runtime agent orchestrator. It is the layer that helps you verify whether your skill fleet is understandable, distinguishable, and maintainable before routing failures accumulate in production.

## How Homingo Differs

The papers and Homingo are complementary, but not interchangeable.

The papers focus more on:

- runtime retrieval and orchestration
- learned routing policies or reusable skill handbooks
- benchmarked downstream task success

Homingo focuses more on:

- routing drift caused by overlapping descriptions
- pairwise ambiguity detection and fleet hygiene
- practical remediation: rewrites, merge recommendations, and sharding

## Why This Matters

If your runtime system is getting better at orchestration, that does **not** remove the need for Homingo.

Better runtime routing still benefits from:

- cleaner skill boundaries
- fewer redundant descriptions
- less overloaded scope
- a clearer capability map for humans and machines

Homingo improves the quality of the skill fleet itself, which makes downstream routing and orchestration more reliable.

## How These Papers Influence Homingo

These papers help motivate several extensions to Homingo's roadmap:

- **`homingo map`** to produce a capability map and handbook-style artifact for the fleet
- **`homingo audit --mode fleet`** to complement pairwise ambiguity testing with full-manifest routing evaluation
- stronger benchmark and profile-based evaluation over time

## Further Reading

- [Routing Drift](/concepts/routing-drift)
- [Shadow Router](/concepts/shadow-router)
- [homingo audit](/commands/audit)
