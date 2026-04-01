# Changelog

All notable changes to Homingo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-04-01

### Changed

- **Configurable report retention** — Replaced the hardcoded limit of 10 HTML reports per command with a configurable `output.maxReportsPerCommand` setting (default 50). Set to `0` for unlimited retention. Configurable via `homingo init` or `~/.homingo/config.json`.

## [0.14.0] - 2026-03-30

### Changed

- **Dual-model approach for simulation** — `audit` and `lint` now use a cheaper model prompt generation and description rewrites and reserve the primary model for routing simulation.

## [0.13.0] - 2026-03-25

### Added

- **`homingo map`** — Local-first capability map for skill fleets
  - Groups skills into heuristic capability clusters
  - Builds per-skill profiles with nearest neighbors and overlap degree
  - Highlights merge candidates, overlap hubs, and overloaded skills
  - Persists JSON and self-contained HTML reports and appears in `homingo logs`
- **`homingo audit --mode fleet`** — Full-manifest routing evaluation
  - Keeps existing pair mode for clean boundary testing
  - Adds fleet mode to route adversarial prompts against the full manifest
  - Reports third-skill hijacks and top hijacking skills in audit output
- **Research-context documentation**
  - Added docs describing how Homingo differs from and complements recent papers on ecosystem-scale skill orchestration and learned routing
  - Added command docs for `homingo map`

### Changed

- `homingo audit` now supports `--mode <pair|fleet>`
- Audit reports now include the evaluation mode and, in fleet mode, third-skill hijack summaries
- Homepage, getting-started docs, and README now position Homingo more explicitly as a skill-fleet governance layer

## [0.9.0] - 2026-03-18

### Added

- **Dual-model approach for simulation** — `audit` and `lint` now use a cheaper sim model for routing simulation and reserve the primary model for prompt generation and description rewrites
  - Auto-derives a cheaper sim model from the primary: `claude-sonnet-*` / `claude-opus-*` → `claude-haiku-4-5-20251001`, `gpt-4o` → `gpt-4o-mini`, o-series → `gpt-4o-mini`
  - New `--sim-model <model>` CLI flag on `audit` and `lint` to override the auto-derived model; `--sim-model same` forces the primary model for simulation
  - New `simModel` optional config key in `~/.homingo/config.json`
- **Pair result caching** — `audit` and `lint` cache routing test results per pair with a 7-day TTL
  - Cache keyed on skill names, descriptions, prompt count, and sim model — invalidated automatically when any of these change
  - Cached pairs are marked `(cached)` in terminal output; cache hit count shown in HTML report metadata
  - New `--no-cache` CLI flag on `audit` and `lint` to bypass cache and force fresh results
  - Cache stored at `~/.homingo/cache/pairs/`; expired entries pruned on each run

## [0.8.0] - 2026-03-14

### Added

- **`homingo scan`** — Instant fleet health check with zero API calls
  - Heuristic overlap detection and scope overload analysis, runs locally in under a second
  - Health score (0–100) weighted across conflict ratio (60%), overload ratio (25%), and duplicate ratio (15%)
  - Overlap severity classification: CRITICAL (≥50%), HIGH (≥35%), MEDIUM (≥20%), LOW (<20%)
  - Duplicate skill name detection with kept/skipped path reporting
  - CI-friendly exit code 1 when issues are found
  - Self-contained HTML report with summary cards, conflict table, overload table, and duplicate table
  - Support for `--all-pairs`, `--enhanced`, `--json`, `--no-open` flags
- **Duplicate skill detection** — Parser detects skills with duplicate names across the fleet
  - Surfaces duplicates in scan report (terminal + HTML)
  - Duplicates affect health score and trigger non-zero exit code

### Changed

- `parseSkills()` now returns `{ skills, duplicates }` instead of a plain array
- Health score formula rebalanced from 70/30 (conflicts/overload) to 60/25/15 (conflicts/overload/duplicates)
- `homingo logs` now includes a Scan tab for browsing scan run history
- Getting Started guide restructured to lead with `scan` as the first command after `init`

## [0.5.0] - 2026-03-12

### Added

- **`homingo audit`** — Read-only fleet diagnostic detecting routing conflicts across skill pairs
  - Heuristic pair selection with Jaccard similarity and optional bigram matching (`--enhanced`)
  - LLM-based adversarial routing simulation
  - Self-contained HTML conflict reports
  - Support for `--all-pairs`, `--dry-run`, `--json` output modes
- **`homingo lint`** — Pre-deploy validation with routing tests, scope overload detection, and fix suggestions
  - Fleet-wide pair conflict testing
  - Single-skill neighbor testing (`--skill <name>`)
  - Scope overload detection with shard plan generation
  - Description rewrite suggestions with `--fix` to apply changes
  - Configurable accuracy threshold (`--threshold`)
- **`homingo init`** — Interactive project setup with config scaffolding and sample skill
- **`homingo logs`** — Browse past audit and lint results with HTML viewer
  - `--regenerate` flag to re-render reports after template updates
- **Shadow Router engine** — Adversarial prompt generation and routing simulation core
- **HTML reporting** — Self-contained reports with no external dependencies
- **Provider support** — Anthropic (`claude-*`) and OpenAI (`gpt-*`, `o1-*`, `o3-*`) models
- **Configuration** — `.homingo/config.json` with model, thresholds, and output settings
