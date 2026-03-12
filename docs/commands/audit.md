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
| `--prompts <n>` | Adversarial prompts per pair | `50` |
| `--model <model>` | LLM model to use | From config |
| `--enhanced` | Enable bigram matching for better overlap detection | Off |
| `--concurrency <n>` | Max parallel API calls | `10` |
| `--dry-run` | Show selected pairs without making API calls | Off |
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

# JSON output for CI pipelines
homingo audit --json --no-open
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Audit completed (conflicts may exist — check the report) |
| `1` | Error during execution |

::: tip
`homingo audit` always exits `0` on success regardless of how many conflicts it finds. It's a diagnostic tool — it reports truth, it doesn't enforce a pass/fail gate. Use `homingo lint` for CI-gated validation.
:::
