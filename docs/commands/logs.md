# homingo logs

Browse past audit and lint results. Opens an HTML viewer with tabs for each command type.

## Usage

```bash
homingo logs [options]
```

## What It Does

Reads stored run metadata from your `reportDir` and presents a browsable history of past runs with links to their full HTML reports.

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output raw JSON run data instead of HTML | Off |
| `--regenerate` | Re-render all HTML reports using the latest templates | Off |

## Examples

```bash
# Open the logs viewer in your browser
homingo logs

# Get raw JSON data
homingo logs --json

# Re-render reports after updating Homingo
homingo logs --regenerate
```

## The `--regenerate` Flag

When you update Homingo, report templates may change. Use `--regenerate` to re-render all existing reports with the latest templates without re-running the underlying analysis.

```bash
npm update -g homingo
homingo logs --regenerate
```

## Report Retention

Homingo keeps the last 10 runs per command by default. Older reports are automatically cleaned up when new runs complete.
