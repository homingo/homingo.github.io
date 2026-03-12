# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in Homingo, please report it responsibly.

### How to Report

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **security@homingo.dev** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. The potential impact
4. Any suggested fixes (optional)

### What to Expect

- **Acknowledgment** within 48 hours of your report
- **Status update** within 7 days with an assessment and timeline
- **Fix or mitigation** as soon as practically possible, depending on severity

### Disclosure Policy

- We ask that you give us reasonable time to address the issue before public disclosure
- We will credit you in the release notes (unless you prefer to remain anonymous)
- We will not take legal action against researchers who report vulnerabilities responsibly

## Security Considerations

### API Key Handling

Homingo reads API keys from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Keys are:

- Never written to disk by Homingo
- Never included in reports or log output
- Never transmitted anywhere other than the configured LLM provider

### Data Handling

- **Skill descriptions** are sent to the configured LLM provider for routing simulation
- **Generated reports** are stored locally in your configured `reportDir`
- **No telemetry** is collected or transmitted
- Homingo makes **no network requests** other than LLM API calls

### Local-Only Operation

Homingo is a CLI tool that runs entirely on your machine. It does not:

- Phone home or check for updates
- Collect usage analytics
- Store data outside your project directory
- Require network access beyond LLM API calls

## Best Practices

- Store API keys in environment variables, not in configuration files
- Review generated reports before sharing them externally (they contain skill descriptions)
- Use `.gitignore` to exclude `.homingo/` and `reports/` from version control if skill descriptions are sensitive
