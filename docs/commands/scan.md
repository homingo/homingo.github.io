# homingo scan

Instant fleet health check. Runs locally in seconds with zero API calls — uses heuristic analysis to detect skill overlaps and scope overload.

## Usage

```bash
homingo scan [options]
```

## What It Does

1. Loads all skills from your configured `skillsDir`
2. Computes pairwise overlap scores using keyword and name similarity (no LLM calls)
3. Checks each skill for scope overload using heuristic pattern detection
4. Produces a health score (0–100) and severity-ranked report

## Why Use Scan?

`scan` is the fastest way to get signal from Homingo. While [`audit`](/commands/audit) and [`lint`](/commands/lint) use LLM-powered routing simulation for precise accuracy measurements, `scan` gives you an instant overview using local heuristics only.

Use `scan` when you want to:

- **Get a quick health check** after `homingo init` — see results in under a second
- **Run in CI without API keys** — scan needs no LLM provider
- **Triage before a full audit** — identify which pairs are worth testing with the Shadow Router

## Output

- **Terminal summary** with color-coded overlap pairs and overload warnings
- **Self-contained HTML report** that auto-opens in your browser

The report includes:
- Fleet health score (0–100)
- Conflicting pairs ranked by overlap severity
- Scope overload findings with reasons
- Next steps pointing to `audit` and `lint` for deeper analysis

## Health Score

The health score is a weighted composite:

| Component | Weight | What it measures |
|-----------|--------|------------------|
| Conflict ratio | 70% | Fraction of total pairs flagged as CRITICAL or HIGH overlap |
| Overload ratio | 30% | Fraction of skills flagged as scope-overloaded |

A score of **100** means no critical overlaps and no overloaded skills. A score below **50** suggests significant fleet issues that need attention.

## Overlap Severity

Pairs are classified by their heuristic overlap score:

| Severity | Overlap Score | Meaning |
|----------|---------------|---------|
| CRITICAL | ≥ 50% | Very likely to cause misrouting |
| HIGH | 35–49% | Probable routing confusion |
| MEDIUM | 20–34% | Worth monitoring |
| LOW | < 20% | Minimal overlap |

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--skills-dir <path>` | Path to skills directory | From config |
| `--all-pairs` | Analyze every skill pair | Heuristic selection |
| `--enhanced` | Enable bigram matching for better overlap detection | Off |
| `--json` | Output JSON instead of terminal summary | Off |
| `--no-open` | Don't auto-open the HTML report | Off |

## Examples

```bash
# Quick scan with defaults
homingo scan

# Scan all pairs for a thorough overview
homingo scan --all-pairs

# Scan with bigram matching for improved accuracy
homingo scan --enhanced

# JSON output for CI pipelines
homingo scan --json --no-open

# Scan a custom skills directory
homingo scan --skills-dir ./my-skills
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Fleet is healthy — no critical overlaps or overloaded skills |
| `1` | Issues found — at least one CRITICAL/HIGH pair or overloaded skill |

::: tip
Use exit code `1` in CI to catch fleet issues early — even without API keys. For precise routing accuracy measurements, follow up with `homingo audit`.
:::

## Scan vs Audit vs Lint

| | `scan` | `audit` | `lint` |
|---|--------|---------|--------|
| **Speed** | Instant (< 1s) | Minutes | Minutes |
| **API calls** | None | Many | Many |
| **Accuracy** | Heuristic overlap | LLM routing simulation | LLM routing simulation |
| **Rewrites** | No | No | Yes (`--fix`) |
| **Best for** | Quick triage, CI gates | Deep diagnostics | Pre-deploy validation |
