# homingo lint

Pre-deploy validation. Tests routing accuracy, detects scope overload, suggests description rewrites, and proposes skill sharding.

## Usage

```bash
# Fleet-wide lint
homingo lint [options]

# Single-skill lint
homingo lint --skill <name> [options]

# Pair-specific lint
homingo lint --pair <skillA>,<skillB> [options]
```

## Three Modes

### Fleet-Wide Lint

Without `--skill` or `--pair`, lint tests all heuristically selected skill pairs across your fleet and runs scope overload checks on every skill.

```bash
homingo lint
```

### Single-Skill Lint

With `--skill`, lint tests one skill against its closest neighbors. Use this when you're about to ship a new or modified skill.

```bash
homingo lint --skill invoice-summary
```

### Pair-Specific Lint

With `--pair`, lint tests exactly one skill pair. Use this to follow up on specific findings from `homingo scan`.

```bash
homingo lint --pair invoice-gen,invoice-summary
```

The scan report's Next Steps section includes copy-ready `--pair` commands for each CRITICAL and HIGH finding.

## What It Does

1. **Pair testing** — generates adversarial prompts and simulates routing for selected pairs
2. **Coordinated rewrites** — analyzes both skills in a pair simultaneously and generates coordinated description changes that draw clear boundaries
3. **Merge detection** — when two skills fundamentally serve the same purpose, recommends merging instead of rewriting
4. **Scope overload detection** — flags skills with oversized or multi-intent descriptions
5. **Shard plans** — for overloaded skills, proposes splitting into focused sub-skills plus an orchestrator

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--skill <name>` | Test one skill against its neighbors | Full fleet |
| `--pair <a,b>` | Test a specific skill pair (comma-separated names) | — |
| `--threshold <pct>` | Accuracy threshold to pass (0–100) | `90` |
| `--neighbors <n>` | Max neighbors in single-skill mode | `5` |
| `--fix [run-id]` | Iteratively rewrite and re-test until pairs pass. Optionally pass a run ID or `latest` to resume from a previous run's failures. | Off |
| `--force` | Run scope overload analysis on all skills, not just flagged ones | Off |
| `--prompts <n>` | Adversarial prompts per pair | `10` |
| `--model <model>` | LLM model to use | From config |
| `--sim-model <model>` | Model used for routing simulation (default: auto-derived cheaper model) | Auto |
| `--enhanced` | Bigram matching for improved overlap detection | Off |
| `--concurrency <n>` | Max parallel API calls | `5` |
| `--dry-run` | Show pairs and scope checks without API calls | Off |
| `--no-cache` | Bypass the pair result cache and re-test every pair | Off |
| `--json` | Output JSON only | Off |
| `--no-open` | Don't auto-open the HTML report | Off |

## Examples

```bash
# Fleet-wide lint with defaults
homingo lint

# Test a single skill before shipping
homingo lint --skill tax-optimizer

# Test a specific pair (e.g. from scan findings)
homingo lint --pair invoice-gen,invoice-summary

# Iteratively fix: rewrite, re-test, repeat until passing
homingo lint --fix

# Resume fixing from the last lint run (skips initial testing)
homingo lint --fix latest

# Resume fixing from a specific run ID
homingo lint --fix abc12345

# Lower the accuracy bar for early-stage skills
homingo lint --threshold 80

# Force scope overload checks on all skills
homingo lint --force

# Use a specific sim model instead of auto-deriving one
homingo lint --sim-model gpt-4o-mini

# Skip the cache to force fresh results
homingo lint --no-cache

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

## Dual-Model Approach

`homingo lint` uses **two models**: a primary model to generate adversarial prompts and description rewrites, and a cheaper sim model to simulate routing decisions.

By default, the sim model is automatically derived from the primary:

| Primary model | Auto sim model |
|---------------|----------------|
| `claude-sonnet-*`, `claude-opus-*` | `claude-haiku-4-5-20251001` |
| `claude-haiku-*` | Same as primary |
| `gpt-4o`, `gpt-4o-2*` | `gpt-4o-mini` |
| `o1*`, `o3*`, `o4*` | `gpt-4o-mini` |
| `gpt-4o-mini*` | Same as primary |
| Unknown | Same as primary |

The terminal output shows both models:

```
Model: claude-sonnet-4-20250514 | Sim: claude-haiku-4-5-20251001 (auto) | Prompts/pair: 10
```

Use `--sim-model` to override the auto-derived model, or `--sim-model same` to force the primary model for simulation.

::: tip
The sim model handles the highest-volume operation (routing each prompt against your full skill manifest). Auto-deriving a cheaper sim model typically reduces total API cost by 80–90% compared to using the primary model for everything.
:::

## Caching

Lint results are cached at `~/.homingo/cache/pairs/` with a **7-day TTL**. On subsequent runs, unchanged pairs (same skill names, descriptions, prompt count, and sim model) are loaded from cache instead of making LLM calls.

Cached pairs are marked `(cached)` in the terminal output. The cache hit count appears in the HTML report's metadata bar.

```
[1/5] invoice-gen ↔ invoice-summary — HIGH (82% accuracy) (cached)
```

Use `--no-cache` to force fresh results for all pairs.

::: warning
The iterative rewrite loop (`--fix`) does **not** use the cache. Each iteration rewrites skill descriptions, which invalidates any cached results for those pairs. Only the initial pair-testing phase (before any rewrites) uses the cache.
:::

## The `--fix` Workflow

When you pass `--fix`, Homingo **iteratively** rewrites descriptions until all pairs pass:

1. **Test pairs** — identify failing pairs
2. **Coordinated rewrite** — for each failing pair, the LLM sees both skill descriptions side-by-side and generates coordinated changes (or recommends merging if the skills aren't genuinely distinct)
3. **Apply + re-test** — write the rewrites to disk and re-test the failing pairs
4. **Escalate** — if pairs still fail, the next iteration includes accuracy history so the LLM can take a more aggressive approach
5. **Stop** — when all pairs pass, all remaining pairs are recommended for merge, or `maxIterations` is reached (default: 5, configurable in `~/.homingo/config.json`)

The rewriter escalates automatically: after iteration 1, it sees how much accuracy improved and adjusts its strategy. After 3+ iterations without resolution, it strongly considers recommending a merge.

After the rewrite loop, scope overload checks run and shard plans are applied if needed. Merge recommendations are included in the HTML report for manual review.

Review the changes with `git diff` before committing. Homingo writes files but never commits.

### Resuming from a Previous Run

If you've already run `homingo lint` and know which pairs are failing, you can skip the initial testing phase and jump straight to fixing:

```bash
# Resume from the most recent lint run
homingo lint --fix latest

# Resume from a specific run (use the short ID from the report filename)
homingo lint --fix abc12345
```

This loads the failing pairs from the stored run and starts the iterative rewrite loop immediately — saving the API calls that would otherwise go to re-testing pairs you already know are failing.
