<p align="center">
  <img src="assets/logo.png" alt="Homingo" width="280" />
</p>

<h3 align="center">The homing instinct for your AI skills</h3>

<p align="center">
  Detect, diagnose, and fix routing drift in AI skill deployments.
</p>

<p align="center">
  <a href="https://homingo.github.io">Documentation</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#contributing">Contributing</a>
</p>

---

## The Problem

You build 10 AI skills and routing works great. You build 50 and the model starts picking the wrong one &mdash; "Tax Optimizer" fires for invoice summaries, "Legal Review" and "Legal Compliance" blur together. Descriptions accumulate overlap silently. There is no tooling to detect this.

**Homingo** is the orchestration layer that sits on top of your AI platform's skill primitives. It turns _"I hope the model picks the right tool"_ into _"I have verified the model will pick the right tool."_

## Quick Start

```bash
# Install
npm install -g homingo

# Init/Configure
homingo init

# Run a read-only diagnostic on your skill fleet
homingo audit

# Pre-deploy validation with fix suggestions
homingo lint

# Test a single skill before shipping it
homingo lint --skill my-new-skill
```

## Commands

### `homingo init`

Interactive setup. Creates a `.homingo/config.json` and scaffolds a skills directory with a sample `SKILL.md`.

```bash
homingo init
```

### `homingo audit`

Read-only fleet diagnostic. No writes, no rewrites, just truth.

```bash
homingo audit --skills-dir ./skills
```

Outputs a conflict map showing which skill pairs have routing overlap, an estimated fleet error rate, severity-ranked pair list, and the top offenders. The report opens as a self-contained HTML file.

| Flag | Description |
|------|-------------|
| `--all-pairs` | Test every skill pair (expensive, thorough) |
| `--prompts <n>` | Adversarial prompts per pair (default: 50) |
| `--model <model>` | LLM model to use |
| `--enhanced` | Bigram matching for improved overlap detection |
| `--concurrency <n>` | Max parallel API calls (default: 10) |
| `--dry-run` | Show pairs without making API calls |
| `--json` | Output JSON instead of terminal table |
| `--no-open` | Don't auto-open the HTML report |

### `homingo lint`

Pre-deploy validation. Tests routing accuracy, detects scope overload, suggests description rewrites, and proposes skill sharding when descriptions cover too many intents.

```bash
# Fleet-wide lint
homingo lint

# Single-skill lint (test one skill against its neighbors)
homingo lint --skill invoice-summary

# Auto-fix descriptions and write shard plans
homingo lint --fix
```

| Flag | Description |
|------|-------------|
| `--skill <name>` | Test one skill against its neighbors instead of the full fleet |
| `--threshold <pct>` | Accuracy threshold to pass (default: 90) |
| `--neighbors <n>` | Max neighbors in single-skill mode (default: 5) |
| `--fix` | Apply suggested rewrites and shard plans to SKILL.md files |
| `--force` | Run scope overload checks on all skills, not just flagged ones |
| `--prompts <n>` | Adversarial prompts per pair (default: 50) |
| `--model <model>` | LLM model to use |
| `--enhanced` | Bigram matching for improved overlap detection |
| `--concurrency <n>` | Max parallel API calls (default: 10) |
| `--dry-run` | Show pairs and scope checks without making API calls |
| `--json` | Output JSON only |
| `--no-open` | Don't auto-open the HTML report |

### `homingo logs`

Browse past audit and lint results. Opens an HTML viewer with tabs for each command type.

```bash
homingo logs         # html output
homingo logs --json  # raw json data
```

## How It Works

Homingo's core engine is the **Shadow Router**; an adversarial prompt generator combined with a routing simulator.

```
Skill Fleet
    │
    ▼
┌─────────────────────┐
│   Pair Selector     │  Identifies which skill pairs have overlapping descriptions
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Prompt Generator   │  Creates adversarial prompts at the boundary between two skills
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Routing Simulator  │  Asks the LLM: "Given these skills, which one handles this prompt?"
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Conflict Scorer   │  Aggregates results into accuracy scores and severity ratings
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ Description Rewriter│  Suggests targeted rewrites to reduce routing confusion
└─────────────────────┘
```

### Skill Format

Each skill is a directory with a `SKILL.md` file using YAML frontmatter:

```markdown
---
name: invoice-summary
description: "Generates concise summaries of invoice documents, extracting key fields like total amount, due date, vendor name, and line items."
---

# Invoice Summary

Additional context, examples, or documentation for the skill.
```

### Overlap Detection

Homingo uses a two-stage approach:

1. **Heuristic pair selection:** Jaccard similarity on tokenized descriptions + name keyword overlap. Optional bigram matching with `--enhanced`. This runs locally with no API calls.
2. **LLM-based routing simulation:** For selected pairs, Homingo generates adversarial prompts and asks the model to route them. This measures actual routing accuracy, not just textual similarity.

### Scope Overload Detection

When a skill description exceeds 1024 characters or shows signs of multi-intent scope (multiple semicolons, excessive clauses, "and [verb]" patterns), Homingo flags it as overloaded and proposes a **shard plan**: splitting into focused sub-skills plus an orchestrator.

## Configuration

Homingo stores its configuration in `.homingo/config.json`:

```json
{
  "model": "claude-sonnet-4-20250514",
  "skillsDir": "./skills",
  "shadowRouter": {
    "promptsPerPair": 50,
    "minPrompts": 10,
    "accuracyThreshold": 90,
    "maxIterations": 3
  },
  "output": {
    "reportDir": "./reports",
    "format": "both"
  }
}
```

## Provider Support

Homingo supports both Anthropic and OpenAI models. The provider is auto-detected from the model name:

- `claude-*` &rarr; Anthropic
- `gpt-*`, `o1-*`, `o3-*` &rarr; OpenAI

## Reports

Every `audit` and `lint` run generates:

- **JSON metadata:** run parameters, token usage, results
- **Self-contained HTML report:** no external dependencies, opens in any browser

Reports are stored in the configured `reportDir` (default: `./reports/`) with automatic retention of the last 10 runs per command. Use `homingo logs` to browse them.

## Requirements

- **Node.js** &ge; 22
- An API key for Anthropic or OpenAI

## Development

```bash
git clone https://github.com/homingo/homingo.github.io.git
cd homingo
npm install
npm run build
npm test
```

```bash
npm run typecheck   # TypeScript type checking
npm run lint        # ESLint
npm run format      # Prettier
npm run test:watch  # Vitest in watch mode
```

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

Special thanks to [Chris Mikelson](https://github.com/cmike444) for his support.

Thanks to all contributors:

<p align="left">
  <a href="https://github.com/rk-yen"><img src="https://avatars.githubusercontent.com/u/4944665?v=4&size=64&s=48" width="48" height="48" alt="dirbalak" title="dirbalak"/></a>
  <a href="https://github.com/cmike444"><img src="https://avatars.githubusercontent.com/u/3966839?v=4&s=48" width="48" height="48" alt="dirbalak" title="dirbalak"/></a>
</p>