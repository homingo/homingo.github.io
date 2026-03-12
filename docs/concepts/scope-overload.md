# Scope Overload

Scope overload occurs when a single skill description covers too many distinct intents. This makes routing unreliable because the model has to match a broad range of user requests to one skill.

## Detection

Homingo flags a skill as overloaded based on:

- **Description length** exceeding 1024 characters
- **Multi-intent patterns**: multiple semicolons, excessive clauses, repeated "and [verb]" patterns
- **Intent count**: distinct functional intents embedded in a single description

## The Problem

Consider a skill with this description:

> "Handles all financial operations including invoice generation, expense tracking, budget forecasting, tax calculation, payment processing, and financial report generation."

This skill is doing six different jobs. The model will route *any* finance-related prompt to it — even when a more specific skill exists. It also makes the fleet harder to debug because failures could come from any of the six intents.

## The Solution: Sharding

When Homingo detects an overloaded skill, it proposes a **shard plan**:

1. **Identify distinct intents** embedded in the description
2. **Create focused sub-skills** — one per intent, each with a tight description
3. **Create an orchestrator skill** — routes between the sub-skills with clear decision logic

### Example Shard Plan

**Before**: One "Financial Operations" skill covering 6 intents

**After**:
- `invoice-generation` — focused on creating invoices
- `expense-tracking` — focused on expense management
- `budget-forecasting` — focused on budget projections
- `financial-operations-orchestrator` — routes between the three sub-skills

## Using Sharding in Homingo

```bash
# See which skills are overloaded
homingo lint --dry-run

# Run full lint with scope overload analysis
homingo lint

# Force analysis on all skills, not just flagged ones
homingo lint --force

# Apply shard plans (creates new skill directories)
homingo lint --fix
```

## When NOT to Shard

Not every long description needs sharding:

- **Early-stage skills** with intentionally broad scope may be fine until the fleet grows
- **Orchestrator skills** are designed to be broad — that's their job
- **Skills with related sub-tasks** that genuinely belong together

Use `--force` to analyze a specific skill even if it's under the length threshold, and use your judgment on whether the shard plan makes sense.

## Further Reading

- [Routing Drift](/concepts/routing-drift) — how overloaded skills contribute to drift
- [Skill Format](/concepts/skill-format) — how to structure skill descriptions
- [homingo lint](/commands/lint) — the command that detects scope overload
