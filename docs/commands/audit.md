# homingo audit

Read-only fleet diagnostic. Scans your skill fleet for routing conflicts without making any changes to your skills.

## Usage

```bash
homingo audit [options]
```

## What It Does

1. Loads all skills from your configured `skillsDir`
2. Selects skill pairs with potentially overlapping descriptions (heuristic scoring)
3. Generates adversarial prompts at the boundary between each pair
4. Simulates routing decisions using your configured LLM
5. Scores each pair and produces a severity-ranked conflict report

## Output

- **Terminal table** with pair-by-pair accuracy scores and severity ratings
- **Self-contained HTML report** that auto-opens in your browser

The report includes:
- Conflict map showing which skill pairs have routing overlap
- Estimated fleet-wide error rate
- Top offender pairs ranked by conflict severity
- Per-pair details with example misrouted prompts

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--skills-dir <path>` | Path to skills directory | From config |
| `--all-pairs` | Test every skill pair (expensive, thorough) | Heuristic selection |
| `--prompts <n>` | Adversarial prompts per pair | `10` |
| `--model <model>` | LLM model to use | From config |
| `--sim-model <model>` | Model used for routing simulation (default: auto-derived cheaper model) | Auto |
| `--enhanced` | Enable bigram matching for better overlap detection | Off |
| `--concurrency <n>` | Max parallel API calls | `5` |
| `--dry-run` | Show selected pairs without making API calls | Off |
| `--no-cache` | Bypass the pair result cache and re-test every pair | Off |
| `--json` | Output JSON instead of terminal table | Off |
| `--no-open` | Don't auto-open the HTML report | Off |

## Examples

```bash
# Basic audit with defaults
homingo audit

# Thorough audit testing all pairs
homingo audit --all-pairs

# Quick dry run to see which pairs would be tested
homingo audit --dry-run

# Audit with a specific model
homingo audit --model gpt-4o

# Use a specific sim model instead of auto-deriving one
homingo audit --sim-model claude-haiku-3-20240307

# Force the same model for both generation and simulation
homingo audit --sim-model same

# Skip the cache to force fresh results
homingo audit --no-cache

# JSON output for CI pipelines
homingo audit --json --no-open
```

## Dual-Model Approach

`homingo audit` uses **two models**: a primary model to generate adversarial prompts, and a cheaper sim model to simulate routing decisions.

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

## Caching

Audit results are cached at `~/.homingo/cache/pairs/` with a **7-day TTL**. On subsequent runs, unchanged pairs (same skill names, descriptions, prompt count, and sim model) are loaded from cache instead of making LLM calls — dramatically speeding up re-runs after adding a single new skill.

Cached pairs are marked `(cached)` in the terminal output. The cache hit count appears in the HTML report's metadata bar.

Use `--no-cache` to force fresh results for all pairs.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Audit completed (conflicts may exist — check the report) |
| `1` | Error during execution |

::: tip
`homingo audit` always exits `0` on success regardless of how many conflicts it finds. It's a diagnostic tool — it reports truth, it doesn't enforce a pass/fail gate. Use `homingo lint` for CI-gated validation.
:::
