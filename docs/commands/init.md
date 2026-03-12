# homingo init

Interactive project setup. Creates a configuration file and scaffolds a skills directory with a sample skill.

## Usage

```bash
homingo init
```

## What It Does

1. Prompts you to choose a model (Anthropic or OpenAI)
2. Asks for your skills directory path
3. Creates `~/.homingo/config.json` with your settings
4. Creates a sample skill directory with a `SKILL.md` template

## Generated Files

```
~/.homingo/
  config.json           # Homingo configuration (global)

your-project/
  skills/               # (or your chosen path)
    example-skill/
      SKILL.md          # Sample skill template
```

## Example Session

```
$ homingo init

? Select your model provider: Anthropic
? Model name: claude-sonnet-4-20250514
? Skills directory: ./skills

✔ Created ~/.homingo/config.json
✔ Created sample skill at skills/example-skill/SKILL.md

Run `homingo audit` to scan your skill fleet.
```

## Notes

- Running `init` when `~/.homingo/config.json` already exists will pre-fill prompts with existing values
- See [Configuration](/configuration) for all available config options
