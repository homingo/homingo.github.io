# homingo lint

Pre-deploy validation. Tests routing accuracy, detects scope overload, suggests description rewrites, and proposes skill sharding.

## Usage

```bash
# Fleet-wide lint
homingo lint [options]

# Single-skill lint
homingo lint --skill <name> [options]
```

## Two Modes

### Fleet-Wide Lint

Without `--skill`, lint tests all heuristically selected skill pairs across your fleet and runs scope overload checks on every skill.

```bash
homingo lint
```

### Single-Skill Lint

With `--skill`, lint tests one skill against its closest neighbors. Use this when you're about to ship a new or modified skill.

```bash
homingo lint --skill invoice-summary
```

## What It Does

1. **Pair testing** — generates adversarial prompts and simulates routing for selected pairs
2. **Scope overload detection** — flags skills with oversized or multi-intent descriptions
3. **Rewrite suggestions** — proposes description changes that reduce routing confusion
4. **Shard plans** — for overloaded skills, proposes splitting into focused sub-skills plus an orchestrator

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--skill <name>` | Test one skill against its neighbors | Full fleet |
| `--threshold <pct>` | Accuracy threshold to pass (0–100) | `90` |
| `--neighbors <n>` | Max neighbors in single-skill mode | `5` |
| `--fix` | Apply suggested rewrites and shard plans to SKILL.md files | Off |
| `--force` | Run scope overload analysis on all skills, not just flagged ones | Off |
| `--prompts <n>` | Adversarial prompts per pair | `50` |
| `--model <model>` | LLM model to use | From config |
| `--enhanced` | Bigram matching for improved overlap detection | Off |
| `--concurrency <n>` | Max parallel API calls | `10` |
| `--dry-run` | Show pairs and scope checks without API calls | Off |
| `--json` | Output JSON only | Off |
| `--no-open` | Don't auto-open the HTML report | Off |

## Examples

```bash
# Fleet-wide lint with defaults
homingo lint

# Test a single skill before shipping
homingo lint --skill tax-optimizer

# Auto-fix: apply rewrites and shard plans
homingo lint --fix

# Lower the accuracy bar for early-stage skills
homingo lint --threshold 80

# Force scope overload checks on all skills
homingo lint --force

# CI mode: JSON output, no browser
homingo lint --json --no-open
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All pairs pass threshold and no skills are overloaded |
| `1` | At least one pair failed or one skill is overloaded |

::: tip
Use exit code `1` in CI to gate deployments. A failing lint means the model is likely to misroute prompts or a skill covers too many intents.
:::

## The `--fix` Workflow

When you pass `--fix`, Homingo applies changes directly to your `SKILL.md` files:

1. **Description rewrites** — the `description` field in frontmatter is updated
2. **Shard plans** — new skill directories are created for sub-skills and orchestrator

Review the changes with `git diff` before committing. Homingo writes files but never commits.
