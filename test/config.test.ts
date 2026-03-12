import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import { loadConfig, DEFAULT_CONFIG, resolvePath } from "../src/config.js";

describe("loadConfig", () => {
  let tempDir: string;
  let configPath: string;

  // Save and restore env vars around each test
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "homingo-config-test-"));
    mkdirSync(join(tempDir, ".homingo"), { recursive: true });
    configPath = join(tempDir, ".homingo", "config.json");
    // Clear any API keys from env so tests are deterministic
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Restore env
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("reads config from file when it exists", () => {
    const fileConfig = {
      anthropicApiKey: "sk-ant-file-key-123",
      model: "claude-opus-4-20250514",
      skillsDir: "./my-skills",
      shadowRouter: {
        promptsPerPair: 100,
        minPrompts: 30,
        accuracyThreshold: 95,
        maxIterations: 10,
      },
      output: {
        reportDir: "./my-reports",
        format: "json",
      },
    };
    writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));

    const config = loadConfig(configPath);

    expect(config.anthropicApiKey).toBe("sk-ant-file-key-123");
    expect(config.model).toBe("claude-opus-4-20250514");
    expect(config.skillsDir).toBe(resolvePath("./my-skills"));
    expect(config.shadowRouter.promptsPerPair).toBe(100);
    expect(config.shadowRouter.minPrompts).toBe(30);
    expect(config.shadowRouter.accuracyThreshold).toBe(95);
    expect(config.shadowRouter.maxIterations).toBe(10);
    expect(config.output.reportDir).toBe("./my-reports");
    expect(config.output.format).toBe("json");
  });

  it("falls back to defaults when no config file exists", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";
    const missingPath = join(tempDir, "nonexistent", "config.json");

    const config = loadConfig(missingPath);

    expect(config.anthropicApiKey).toBe("sk-ant-env-key");
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(config.skillsDir).toBe(resolvePath(DEFAULT_CONFIG.skillsDir));
    expect(config.shadowRouter).toEqual(DEFAULT_CONFIG.shadowRouter);
    expect(config.output).toEqual(DEFAULT_CONFIG.output);
  });

  it("env var overrides config file API key", () => {
    const fileConfig = {
      anthropicApiKey: "sk-ant-file-key",
      model: "claude-sonnet-4-20250514",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-override";

    const config = loadConfig(configPath);

    expect(config.anthropicApiKey).toBe("sk-ant-env-override");
  });

  it("deep-merges partial config with defaults", () => {
    // Only set some shadowRouter fields, leave others to defaults
    const partialConfig = {
      anthropicApiKey: "sk-ant-partial-key",
      shadowRouter: {
        promptsPerPair: 200,
        // minPrompts, accuracyThreshold, maxIterations should come from defaults
      },
      // output entirely missing — should come from defaults
    };
    writeFileSync(configPath, JSON.stringify(partialConfig));

    const config = loadConfig(configPath);

    expect(config.anthropicApiKey).toBe("sk-ant-partial-key");
    expect(config.model).toBe(DEFAULT_CONFIG.model);
    expect(config.skillsDir).toBe(resolvePath(DEFAULT_CONFIG.skillsDir));
    // Overridden value
    expect(config.shadowRouter.promptsPerPair).toBe(200);
    // Defaults for missing fields
    expect(config.shadowRouter.minPrompts).toBe(DEFAULT_CONFIG.shadowRouter.minPrompts);
    expect(config.shadowRouter.accuracyThreshold).toBe(
      DEFAULT_CONFIG.shadowRouter.accuracyThreshold
    );
    expect(config.shadowRouter.maxIterations).toBe(DEFAULT_CONFIG.shadowRouter.maxIterations);
    // Entire output section from defaults
    expect(config.output).toEqual(DEFAULT_CONFIG.output);
  });

  it("resolves absolute skillsDir as-is", () => {
    const fileConfig = {
      anthropicApiKey: "sk-ant-abs-key",
      skillsDir: "/Users/someone/absolute-skills",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));

    const config = loadConfig(configPath);

    expect(config.skillsDir).toBe("/Users/someone/absolute-skills");
  });

  it("expands tilde in skillsDir to home directory", () => {
    const fileConfig = {
      anthropicApiKey: "sk-ant-tilde-key",
      skillsDir: "~/.claude/skills",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));

    const config = loadConfig(configPath);

    expect(config.skillsDir).toBe(join(homedir(), ".claude", "skills"));
    expect(config.skillsDir).not.toContain("~");
  });

  it("exits when no API key is found anywhere", () => {
    // No env var, no config file
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const missingPath = join(tempDir, "nonexistent", "config.json");

    expect(() => loadConfig(missingPath)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No API key found"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handles malformed JSON gracefully", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-fallback";
    writeFileSync(configPath, "{ this is not valid json }}}");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = loadConfig(configPath);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("malformed"));
    // Should fall back to defaults with env API key
    expect(config.anthropicApiKey).toBe("sk-ant-env-fallback");
    expect(config.model).toBe(DEFAULT_CONFIG.model);

    warnSpy.mockRestore();
  });

  it("reads openaiApiKey from config file", () => {
    const fileConfig = {
      openaiApiKey: "sk-openai-file-key-123",
      model: "gpt-4o",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));

    const config = loadConfig(configPath);

    expect(config.openaiApiKey).toBe("sk-openai-file-key-123");
    expect(config.model).toBe("gpt-4o");
  });

  it("OPENAI_API_KEY env var overrides config file", () => {
    const fileConfig = {
      openaiApiKey: "sk-openai-file-key",
      model: "gpt-4o",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));
    process.env.OPENAI_API_KEY = "sk-openai-env-override";

    const config = loadConfig(configPath);

    expect(config.openaiApiKey).toBe("sk-openai-env-override");
  });

  it("works with only openaiApiKey and no anthropicApiKey", () => {
    const fileConfig = {
      openaiApiKey: "sk-openai-only",
      model: "gpt-4o",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));

    const config = loadConfig(configPath);

    expect(config.openaiApiKey).toBe("sk-openai-only");
    expect(config.anthropicApiKey).toBeUndefined();
  });

  it("works with both API keys present", () => {
    const fileConfig = {
      anthropicApiKey: "sk-ant-both",
      openaiApiKey: "sk-openai-both",
      model: "claude-sonnet-4-20250514",
    };
    writeFileSync(configPath, JSON.stringify(fileConfig));

    const config = loadConfig(configPath);

    expect(config.anthropicApiKey).toBe("sk-ant-both");
    expect(config.openaiApiKey).toBe("sk-openai-both");
  });

  it("exits when neither API key is found", () => {
    // No env vars, no config file
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const missingPath = join(tempDir, "nonexistent", "config.json");

    expect(() => loadConfig(missingPath)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("OPENAI_API_KEY"));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("succeeds with only OPENAI_API_KEY env var", () => {
    process.env.OPENAI_API_KEY = "sk-openai-env-only";
    const missingPath = join(tempDir, "nonexistent", "config.json");

    const config = loadConfig(missingPath);

    expect(config.openaiApiKey).toBe("sk-openai-env-only");
    expect(config.anthropicApiKey).toBeUndefined();
  });
});

describe("resolvePath", () => {
  it("expands ~ alone to home directory", () => {
    expect(resolvePath("~")).toBe(homedir());
  });

  it("expands ~/path to home directory + path", () => {
    expect(resolvePath("~/.claude/skills")).toBe(join(homedir(), ".claude", "skills"));
  });

  it("resolves relative paths from cwd", () => {
    expect(resolvePath("./skills")).toBe(resolve("./skills"));
  });

  it("passes absolute paths through unchanged", () => {
    expect(resolvePath("/usr/local/skills")).toBe("/usr/local/skills");
  });
});
