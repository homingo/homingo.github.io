# Changelog

All notable changes to Homingo will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
