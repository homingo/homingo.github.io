# Configuration

Homingo stores its configuration in `~/.homingo/config.json`. Run `homingo init` to generate a default config.

## Config File

```json
{
  "model": "claude-sonnet-4-20250514",
  "skillsDir": "./skills",
  "shadowRouter": {
    "promptsPerPair": 50,
    "minPrompts": 20,
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

The LLM model used for routing simulation and description rewriting. The provider is auto-detected from the model name:

| Prefix | Provider |
|--------|----------|
| `claude-*` | Anthropic |
| `gpt-*`, `o1-*`, `o3-*` | OpenAI |

### `skillsDir`

Path to the directory containing your skill folders. Each skill folder must contain a `SKILL.md` file. See [Skill Format](/concepts/skill-format).

### `shadowRouter`

| Field | Default | Description |
|-------|---------|-------------|
| `promptsPerPair` | `50` | Number of adversarial prompts generated per skill pair |
| `minPrompts` | `20` | Minimum prompts for a valid test |
| `accuracyThreshold` | `90` | Percentage accuracy required to pass (0–100) |
| `maxIterations` | `5` | Max rewrite iterations (reserved for future iterative rewriting) |

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
# Override model
homingo audit --model gpt-4o

# Override prompts per pair
homingo lint --prompts 25

# Override accuracy threshold
homingo lint --threshold 85
```

CLI flags always take precedence over `config.json` values.
