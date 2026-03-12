# Configuration

Homingo stores its configuration in `~/.homingo/config.json`. Run `homingo init` to generate a default config.

## Config File

```json
{
  "model": "claude-sonnet-4-20250514",
  "skillsDir": "./skills",
  "shadowRouter": {
    "promptsPerPair": 10,
    "minPrompts": 5,
    "accuracyThreshold": 90,
    "maxIterations": 5
  },
  "output": {
    "reportDir": "~/.homingo/reports",
    "format": "both"
  }
}
```

## Options

### `model`

The primary LLM model used for adversarial prompt generation and description rewriting. The provider is auto-detected from the model name:

| Prefix | Provider |
|--------|----------|
| `claude-*` | Anthropic |
| `gpt-*`, `o1-*`, `o3-*` | OpenAI |

### `simModel` _(optional)_

The model used for routing simulation — the high-volume operation that asks the LLM to pick a skill for each adversarial prompt. When omitted, a cheaper model is auto-derived from `model`:

| Primary model | Auto sim model |
|---------------|----------------|
| `claude-sonnet-*`, `claude-opus-*` | `claude-haiku-4-5-20251001` |
| `claude-haiku-*` | Same as primary |
| `gpt-4o`, `gpt-4o-2*` | `gpt-4o-mini` |
| `o1*`, `o3*`, `o4*` | `gpt-4o-mini` |
| `gpt-4o-mini*` | Same as primary |
| Unknown | Same as primary |

Set `"simModel": "same"` in config (or `--sim-model same` on the CLI) to force the primary model for simulation. The `--sim-model` CLI flag always takes precedence over the config value.

### `skillsDir`

Path to the directory containing your skill folders. Each skill folder must contain a `SKILL.md` file. See [Skill Format](/concepts/skill-format).

### `shadowRouter`

| Field | Default | Description |
|-------|---------|-------------|
| `promptsPerPair` | `10` | Number of adversarial prompts generated per skill pair |
| `minPrompts` | `5` | Minimum prompts for a valid test |
| `accuracyThreshold` | `90` | Percentage accuracy required to pass (0–100) |
| `maxIterations` | `5` | Max rewrite iterations in the `--fix` loop |

### `output`

| Field | Default | Description |
|-------|---------|-------------|
| `reportDir` | `"~/.homingo/reports"` | Directory for HTML reports and run metadata |
| `format` | `"both"` | Output format: `"json"`, `"markdown"`, or `"both"`. Note: HTML reports and JSON data are always written regardless of this setting. |

## API Keys

`homingo init` prompts for your API key(s) and stores them in `~/.homingo/config.json`.

You can override the stored keys with environment variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Anthropic models |
| `OPENAI_API_KEY` | API key for OpenAI models |

Environment variables take precedence over config file values. This is useful for CI/CD or when you prefer not to store keys on disk.

## CLI Flag Overrides

Most config values can be overridden per-run via CLI flags:

```bash
# Override primary model
homingo audit --model gpt-4o

# Override sim model (or force same model for both)
homingo audit --sim-model claude-haiku-3-20240307
homingo lint --sim-model same

# Override prompts per pair
homingo lint --prompts 25

# Override accuracy threshold
homingo lint --threshold 85

# Skip the pair result cache
homingo audit --no-cache
```

CLI flags always take precedence over `config.json` values.
