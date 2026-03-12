# Skill Format

Each skill in Homingo is a directory containing a `SKILL.md` file with YAML frontmatter.

## Structure

```
skills/
  invoice-summary/
    SKILL.md
  tax-optimizer/
    SKILL.md
  legal-review/
    SKILL.md
```

## SKILL.md Format

```markdown
---
name: invoice-summary
description: "Generates concise summaries of invoice documents, extracting key fields like total amount, due date, vendor name, and line items."
---

# Invoice Summary

Additional context, examples, or documentation for the skill.
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier for the skill. Should match the directory name. |
| `description` | Yes | The text the model sees when deciding which skill to route to. This is what Homingo tests. |

## Writing Good Descriptions

### Do

- **Be specific** about what the skill handles
- **Include key distinguishing terms** that separate it from similar skills
- **State what the skill does NOT handle** when ambiguity exists
- **Keep it under 1024 characters** — longer descriptions trigger scope overload warnings

### Don't

- **List every possible use case** — focus on the primary job
- **Use vague language** like "handles various tasks related to..."
- **Duplicate terms** that appear in other skill descriptions
- **Combine multiple intents** — if a skill does 3+ distinct jobs, consider splitting

## Examples

### Good Description

```yaml
description: "Generates concise summaries of invoice documents, extracting key fields like total amount, due date, vendor name, and line items. Does NOT perform invoice creation, payment processing, or financial analysis."
```

Clear scope, specific outputs, explicit negative boundaries.

### Problematic Description

```yaml
description: "Handles all invoice-related operations including summarization, creation, sending, tracking, payment reconciliation, and dispute resolution."
```

Too broad — covers six distinct intents. This will conflict with any other finance-related skill and will likely be flagged as [scope overloaded](/concepts/scope-overload).

## The Body

Everything below the frontmatter is the skill body. Homingo does not use the body for routing analysis — only the `name` and `description` fields are tested. The body is for your team's documentation.
