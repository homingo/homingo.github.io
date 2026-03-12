# homingo map

Generate a capability map for your skill fleet with no API calls.

## Usage

```bash
homingo map [options]
```

## What It Does

1. Loads all skills from your configured `skillsDir`
2. Computes overlap relationships across the full fleet
3. Groups skills into heuristic capability clusters
4. Builds per-skill profiles with nearest neighbors and overlap degree
5. Highlights merge candidates, overlap hubs, and overloaded skills

## Output

- **Terminal tables** for capability clusters and overlap hubs
- **Self-contained HTML report** with clusters, skill profiles, merge candidates, and overload findings
- **JSON output** suitable for handbook-style export or downstream tooling

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--skills-dir <path>` | Path to skills directory | From config |
| `--enhanced` | Enable bigram matching for better overlap detection | Off |
| `--json` | Output JSON instead of terminal tables | Off |
| `--no-open` | Don't auto-open the HTML report | Off |

## Examples

```bash
# Build a capability map with defaults
homingo map

# Use enhanced matching
homingo map --enhanced

# Export JSON only
homingo map --json --no-open
```

## Why Use It

`homingo map` complements `scan` and `audit`:

- `scan` tells you where obvious overlap and overload exist
- `map` tells you how the fleet is structured
- `audit` tells you whether risky boundaries actually fail at routing time

Use `map` when you want a handbook-style view of the fleet before making routing or sharding changes.
