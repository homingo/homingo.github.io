# Shadow Router

The Shadow Router is Homingo's core engine. It generates adversarial prompts and simulates routing decisions to measure skill selection accuracy.

## Architecture

```
Skill Fleet
    │
    ▼
┌─────────────────────┐
│   Pair Selector     │  Identifies skill pairs with overlapping descriptions
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Prompt Generator   │  Creates adversarial prompts at the boundary
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Routing Simulator  │  Asks the LLM: "Which skill handles this prompt?"
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Conflict Scorer   │  Aggregates results into accuracy scores
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Description Rewriter│  Suggests targeted rewrites to reduce confusion
└─────────────────────┘
```

## Stage 1: Pair Selection

Not every skill pair needs testing. A fleet of 50 skills has 1,225 possible pairs — testing all of them is expensive.

The **Pair Selector** uses heuristics to identify likely conflicts:

- **Jaccard similarity** on tokenized descriptions
- **Name keyword overlap** between skill names
- **Bigram matching** (with `--enhanced`) for phrase-level similarity

This runs locally with no API calls.

### Fleet-Wide vs Single-Skill

- **Fleet-wide** (`selectPairs`): scores all pairs, returns the top candidates
- **Single-skill** (`selectNeighbors`): given one skill, finds its closest neighbors in the fleet

## Stage 2: Prompt Generation

For each selected pair, the **Prompt Generator** creates adversarial prompts — requests designed to be ambiguous between the two skills.

These prompts sit at the decision boundary. If the model can route them correctly, the skills are well-differentiated. If not, the descriptions need work.

## Stage 3: Routing Simulation

The **Routing Simulator** presents each adversarial prompt to the LLM along with both skill descriptions and asks: "Which skill should handle this?"

The simulation mirrors how a real skill router works — same prompt format, same model, same decision process.

## Stage 4: Conflict Scoring

Results are aggregated into:

- **Per-pair accuracy**: X/50 prompts routed correctly
- **Severity rating**: based on accuracy score and description similarity
- **Fleet-wide error rate**: estimated across all tested pairs

## Stage 5: Description Rewriting

For failing pairs, the **Description Rewriter** generates targeted description changes:

- Adds negative triggers ("This skill does NOT handle...")
- Sharpens scope boundaries
- Reduces overlap with the conflicting skill

Rewrites are suggestions by default. Use `--fix` to apply them.

## Important Caveats

- Shadow routing tests against **synthetic prompts**. Production traffic has a different distribution — don't over-optimize to the test suite.
- Accuracy thresholds are a **confidence signal**, not a guarantee. A 45/50 score means the descriptions are well-differentiated, not that zero misroutes will occur in production.

## Further Reading

- [Routing Drift](/concepts/routing-drift) — the problem the Shadow Router solves
- [homingo audit](/commands/audit) — run the Shadow Router on your full fleet
- [homingo lint](/commands/lint) — pre-deploy validation with fix suggestions
