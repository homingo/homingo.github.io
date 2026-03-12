# Homingo
> The homing instinct for your AI skills. Detect, diagnose, and fix routing drift in AI skill deployments.

---

## Project Vision

As developers scale their AI skill deployments past 10–20 skills, they encounter **Routing Drift** — the gradual degradation of skill selection accuracy caused by overlapping descriptions, inconsistent scoping, and accumulated metadata debt.

Homingo is the orchestration layer that sits on top of your AI platform's skill primitives. It turns "I hope the model picks the right tool" into "I have verified the model will pick the right tool."

**Core value proposition:** Semantic de-confliction for AI skills at scale.

---

## Problem Statement

### The Routing Drift Failure Mode
- Developer builds 10 skills → works great
- Developer builds 50 skills → model starts misrouting (e.g., "Tax Optimizer" selected for "Invoice Summary" tasks)
- Descriptions accumulate overlap silently; there is no existing tooling to detect this

### Two Distinct Customer Segments

**Segment A — Greenfield Builders**
Building new skill deployments. Need pre-deployment validation before drift occurs.
- Primary need: Shadow Routing (test before ship)
- Risk profile: Low — no production traffic to break

**Segment B — Legacy Fleet Owners** ← *highest value, hardest to serve*
Already have 50+ skills in production. System is already broken in ways they can't see.
- Primary need: Audit first, fix second
- Risk profile: High — automated rewrites can break working workflows
- Entry point: `homingo scan` (free) → `homingo audit` (LLM-powered)

---

## Architecture

### Project Structure
```
src/
  index.ts                    # CLI entry point (Commander.js)
  types.ts                    # Shared type definitions
  config.ts                   # Config loading (~/.homingo/config.json + env vars)
  commands/
    init.ts                   # Interactive setup wizard
    scan.ts                   # Free local heuristic fleet check (no API calls)
    audit.ts                  # LLM-powered routing accuracy measurement
    lint.ts                   # Pre-deploy validation with fix suggestions
    logs.ts                   # Run history viewer
  providers/
    types.ts                  # LLMProvider interface
    index.ts                  # Provider detection + factory
    anthropic.ts              # Anthropic Codex provider
    openai.ts                 # OpenAI GPT/O-series provider
    tracked-provider.ts       # Token usage tracking wrapper
  shadow-router/
    pair-selector.ts          # Jaccard similarity pair selection + bigram matching
    generator.ts              # Adversarial prompt generation via LLM
    simulator.ts              # Routing simulation (asks LLM to pick a skill)
    scorer.ts                 # Conflict scoring + fleet-level aggregation
  rewriter/
    rewriter.ts               # Pair-level coordinated rewrites with merge detection
  shard/
    analyzer.ts               # Heuristic overload detection + LLM shard plan generation
    writer.ts                 # Writes shard plans to disk as SKILL.md files
  skills/
    parser.ts                 # Parses SKILL.md files (gray-matter frontmatter)
  reporting/
    html-renderer.ts          # HTML report generation for all commands
    logs-viewer.ts            # Aggregated run history HTML page
    run-metadata.ts           # Run metadata collection (RunCollector)
    storage.ts                # Report persistence + retention enforcement
    opener.ts                 # Cross-platform browser opener + CI detection
  utils/
    concurrency.ts            # pMap — bounded parallel execution
    retry.ts                  # Exponential backoff with jitter + Retry-After support
test/                         # Vitest test files
docs/                         # VitePress documentation site
```

### Tech Stack
- **Runtime:** Node.js >= 20, ESM modules
- **Language:** TypeScript (strict mode, ES2022 target, NodeNext module resolution)
- **CLI framework:** Commander.js
- **LLM SDKs:** `@anthropic-ai/sdk` (Codex) + `openai` (GPT/O-series)
- **Skill format:** SKILL.md files with YAML frontmatter (parsed via `gray-matter`)
- **Output:** Terminal tables (`cli-table3` + `chalk`) + HTML reports (auto-opened in browser)
- **Testing:** Vitest
- **Linting:** ESLint + Prettier
- **Docs:** VitePress
- **Build:** `tsc` (no bundler)

### Key Design Decisions
- **Provider abstraction already implemented.** `LLMProvider` interface with Anthropic and OpenAI implementations. Provider auto-detected from model name prefix (`Codex-*` → Anthropic, `gpt-*/o*` → OpenAI).
- **Jaccard similarity for pair selection, not embeddings.** The spec originally proposed embedding-based pre-filtering, but the implementation uses token-level Jaccard similarity (with optional bigram matching via `--enhanced`). This avoids embedding API calls and keeps `scan` completely free.
- **`homingo scan` is the free entry point.** Not in the original spec — added as a zero-cost local heuristic check that runs in seconds. No API calls. Detects overlap, scope overload, and duplicates.
- **Pair-level coordinated rewrites with `--fix`.** When `--fix` is passed, the rewriter sees BOTH skill descriptions in a conflicting pair and generates coordinated changes. It can return a "rewrite" verdict (one or both skills) or a "merge" verdict when skills aren't genuinely distinct. Each iteration escalates based on accuracy delta — if previous rewrites barely moved the needle, the LLM takes a more aggressive approach or recommends merging. Without `--fix`, a single rewrite suggestion pass is shown.
- **HTML reports, not markdown.** Reports are generated as self-contained HTML files with embedded CSS, auto-opened in the browser. JSON data is also persisted alongside for programmatic access.
- **`homingo shadow` is not a separate command.** Single-skill testing is handled by `homingo lint --skill <name>` which tests against the closest N neighbors.
- **TrackedProvider wraps any LLMProvider** to accumulate token usage and call count across a run, reported in metadata.
- **Retry with exponential backoff + jitter** handles rate limits (429), server errors (500/503/529), and network failures. Respects `Retry-After` headers.
- **Run retention:** Max 10 runs per command stored in `~/.homingo/reports/`. Oldest runs are pruned automatically.

---

## CLI Commands (Implemented)

### `homingo init [directory]`
Interactive setup wizard. Prompts for provider, API key, model, thresholds, and skills directory. Writes `~/.homingo/config.json` and scaffolds a sample skill.

### `homingo scan`
**Free, instant fleet health check.** No API calls. Runs locally in seconds.
- Heuristic pair overlap scoring (Jaccard similarity + optional bigram matching)
- Scope overload detection (character length, semicolons, clause count, "and [verb]" patterns)
- Duplicate skill name detection
- Health score (0–100)
- Flags: `--all-pairs`, `--enhanced`, `--json`, `--no-open`
- Exit code 1 if issues found (CI-friendly)

### `homingo audit`
**LLM-powered routing accuracy measurement.** Read-only diagnostic — no writes.
- Generates adversarial prompts per pair via LLM
- Simulates routing decisions against full skill manifest
- Scores pairs by severity (CRITICAL/HIGH/MEDIUM/LOW)
- Fleet-level error rate + top 5 offender skills
- Flags: `--all-pairs`, `--prompts <n>`, `--model <model>`, `--concurrency <n>`, `--dry-run`, `--enhanced`, `--json`, `--no-open`

### `homingo lint`
**Pre-deploy validation with fix suggestions.**
- Tests routing accuracy for overlapping pairs
- Generates LLM-powered description rewrite suggestions for failing pairs
- Detects scope overload and generates shard plans (sub-skills + orchestrator)
- `--fix` applies rewrites to SKILL.md frontmatter and writes shard files to disk
- `--skill <name>` tests a single skill against its N closest neighbors
- Flags: `--skill <name>`, `--neighbors <n>`, `--threshold <pct>`, `--prompts <n>`, `--fix`, `--force`, `--dry-run`, `--enhanced`, `--json`, `--no-open`

### `homingo logs`
**Run history viewer.** Browses past scan, audit, and lint results.
- Opens an HTML logs viewer in the browser
- `--json` outputs run metadata as JSON
- `--regenerate` re-renders all HTML reports from stored data (picks up template changes)

---

## Configuration

Config file: `~/.homingo/config.json`

```typescript
interface HomingoConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  model: string;                    // default: "Codex-sonnet-4-20250514"
  skillsDir: string;                // default: "./skills"
  shadowRouter: {
    promptsPerPair: number;         // default: 25
    minPrompts: number;             // default: 20
    accuracyThreshold: number;      // default: 90
    maxIterations: number;          // default: 5
  };
  output: {
    reportDir: string;              // default: "~/.homingo/reports"
    format: "json" | "markdown" | "both";  // default: "both" (vestigial — reports are always HTML + JSON)
  };
}
```

> **Note:** The `output.format` field is not currently checked at write time. The reporter always persists both a `.json` data file and a self-contained `.html` report for every run.

API keys are prompted during `homingo init` and stored in `config.json`. Environment variables `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` override the stored values (useful for CI/CD).

---

## Skill Format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: invoice-summary
description: "Summarizes invoice documents, extracting line items, totals, and payment terms."
---

# Invoice Summary

Additional documentation for the skill.
```

- `name` defaults to the directory name if not specified in frontmatter
- `description` is the routing description the LLM reads to make selection decisions
- Skills are discovered recursively under the configured `skillsDir`
- Duplicate names are detected and warned (first occurrence kept)

---

## Feature Roadmap

### Implemented (v0.7.0)
- `homingo init` — interactive setup
- `homingo scan` — free local heuristic fleet check
- `homingo audit` — LLM-powered routing accuracy measurement
- `homingo lint` — pre-deploy validation with rewrite suggestions + shard plans
- `homingo lint --fix` — pair-level coordinated rewrite loop with merge detection (rewrite/merge → re-test → escalate → repeat)
- `homingo lint --skill <name>` — single-skill testing against neighbors
- `homingo lint --pair <a>,<b>` — pair-specific testing
- `homingo logs` — run history viewer
- Multi-provider support (Anthropic + OpenAI)
- HTML report generation with auto-open
- Run metadata tracking with retention

### Not Yet Implemented
- **`homingo shadow <skill-name>`** — as a standalone command. Currently handled by `homingo lint --skill <name>`.
- **GitHub Actions integration** — running `homingo lint` as a CI check on PR
- **Production log ingestion** (v3 SaaS)
- **Multi-skill conflicts** — current spec handles pairwise; 3-way conflicts deferred
- **Skill versioning** — tracking description history and rolling back bad rewrites

---

## Critical Design Constraints

### For Legacy Fleet Owners (Segment B)
1. `homingo audit` is **read-only** — no writes, no rewrites, no "quick fixes"
2. `homingo lint --fix` writes to disk but requires explicit `--fix` flag
3. Results are surfaced as a triage list ranked by severity — not a flat warning log
4. Shard writer does NOT delete the original skill — user removes it manually

### Platform Risk Awareness
AI platform vendors may ship native conflict detection. Moat strategy:
- Deep CI/CD integration (GitHub Actions, pre-commit hooks) before they do
- The audit report as a standalone shareable artifact
- The "before/after" case study from a 60-skill fleet is the most shareable proof of value

---

## Development

```bash
npm run build        # tsc
npm run dev          # tsx src/index.ts
npm test             # vitest run
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run docs:dev     # vitepress dev server
```

# currentDate
Today's date is 2026-03-13.
