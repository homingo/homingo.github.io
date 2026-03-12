# Contributing to Homingo

Thank you for your interest in contributing to Homingo! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/homingo/homingo.github.io.git
cd homingo
npm install
npm run build
```

### Prerequisites

- **Node.js** >= 20
- An API key for Anthropic or OpenAI (for integration tests)

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run with tsx (no build step) |
| `npm test` | Run test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run format` | Prettier formatting |
| `npm run format:check` | Check formatting |

## How to Contribute

### Reporting Bugs

Open a [bug report](https://github.com/homingo/homingo.github.io/issues/new?template=bug_report.md) with:

1. A clear title and description
2. Steps to reproduce the issue
3. Expected vs actual behavior
4. Your environment (Node.js version, OS, model used)
5. Relevant log output or error messages

### Suggesting Features

Open a [feature request](https://github.com/homingo/homingo.github.io/issues/new?template=feature_request.md) describing:

1. The problem you're trying to solve
2. Your proposed solution
3. Any alternatives you've considered

### Submitting Changes

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make your changes** following the code style guidelines below
4. **Add tests** for any new functionality
5. **Run the full check suite**:
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
6. **Commit** with a descriptive message (see commit guidelines below)
7. **Push** and open a Pull Request

## Code Style

### TypeScript

- Strict mode enabled (`"strict": true` in `tsconfig.json`)
- Use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes
- Use `const` by default; `let` only when reassignment is needed

### Formatting

Homingo uses **Prettier** for formatting and **ESLint** for linting. Both run automatically on pre-commit via Husky + lint-staged.

```bash
# Format all files
npm run format

# Check without writing
npm run format:check
```

### File Organization

```
src/
  commands/        # CLI command handlers
  shadow-router/   # Adversarial prompt generation + routing simulation
  shard/           # Scope overload detection + sharding
  reporting/       # HTML reports, storage, logs viewer
  config/          # Configuration loading
```

## Commit Guidelines

Write clear, concise commit messages:

- Use the imperative mood: "Add feature" not "Added feature"
- Keep the subject line under 72 characters
- Reference issues where relevant: "Fix routing accuracy calculation (#42)"

Examples:
```
Add bigram matching for enhanced overlap detection
Fix accuracy threshold validation in lint command
Update HTML report template for scope overload section
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run a specific test file
npx vitest run test/pair-selector.test.ts
```

### Writing Tests

- Place test files in `test/` with the pattern `*.test.ts`
- Use Vitest's `describe`/`it`/`expect` API
- Mock external dependencies (LLM API calls, file system) in tests
- Aim for clear, readable test names that describe the behavior being tested

### Test Categories

- **Unit tests**: Test individual functions and modules in isolation
- **Integration tests**: Test command flows end-to-end (may require API keys)

## Pull Request Process

1. Ensure all checks pass: `typecheck`, `lint`, `test`
2. Update documentation if your change affects CLI behavior or configuration
3. Add a clear description of what changed and why
4. Link to any related issues
5. A maintainer will review your PR and may request changes

## Architecture Notes

### Shadow Router

The core engine generates adversarial prompts at the boundary between two skills and simulates routing decisions. If you're modifying the prompt generation or routing simulation, pay close attention to:

- `src/shadow-router/prompt-generator.ts` — Adversarial prompt creation
- `src/shadow-router/routing-simulator.ts` — LLM-based routing
- `src/shadow-router/pair-selector.ts` — Heuristic pair selection (Jaccard + bigram)

### Reporting

Reports are self-contained HTML files with no external dependencies. All CSS and JS are inlined. If you modify report templates in `src/reporting/html-renderer.ts`, verify the output renders correctly in a browser.

## License

By contributing to Homingo, you agree that your contributions will be licensed under the same [MIT](LICENSE) that covers the project.
