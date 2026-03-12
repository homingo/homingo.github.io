# Getting Started

## Installation

```bash
npm install -g homingo
```

## Prerequisites

- **Node.js** >= 20
- An API key for [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/)

## Initialize a Project

```bash
homingo init
```

This creates `~/.homingo/config.json` (in your home directory) and scaffolds a skills directory with a sample `SKILL.md`.

## Instant Fleet Health Check

Once you have skills in your skills directory, get an instant health check:

```bash
homingo scan
```

Scan runs locally in under a second with zero API calls. It analyzes skill overlaps using heuristic scoring and checks for scope overload, giving you:

- A fleet health score (0–100)
- Conflicting skill pairs ranked by severity
- Scope overload warnings
- Clear next steps

## Capability Map

To understand how your fleet is organized, generate a capability map:

```bash
homingo map
```

Map runs locally and produces:

- capability clusters
- nearest-neighbor profiles for each skill
- merge candidates and overlap hubs
- handbook-style JSON and HTML output

## Deep Diagnostic

When scan surfaces issues, dig deeper with a full routing audit:

```bash
homingo audit
```

Audit uses LLM-powered routing simulation. Pair mode tests whether overlapping skills can be distinguished; fleet mode tests those same prompts against the full manifest:

```bash
homingo audit --mode fleet
```

This takes longer but gives more precise conflict and discoverability data.

## Pre-Deploy Validation

Before shipping a new or modified skill, lint it:

```bash
# Lint the full fleet
homingo lint

# Lint a single skill against its neighbors
homingo lint --skill my-new-skill
```

Lint runs adversarial routing tests, detects scope overload, and suggests description rewrites.

## What's Next?

- Learn about each command: [scan](/commands/scan), [map](/commands/map), [audit](/commands/audit), [lint](/commands/lint), [init](/commands/init), [logs](/commands/logs)
- Understand the core concepts: [Routing Drift](/concepts/routing-drift), [Shadow Router](/concepts/shadow-router), [Scope Overload](/concepts/scope-overload), [Research Context](/concepts/research-context)
- Configure thresholds and output: [Configuration](/configuration)
