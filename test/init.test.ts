import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import matter from "gray-matter";

// Mock @inquirer/prompts before importing initCommand
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

import { input, password, select, confirm } from "@inquirer/prompts";
import { initCommand } from "../src/commands/init.js";
import { parseSkills } from "../src/skills/parser.js";

function mockPromptDefaults(skillsDirValue = "./skills") {
  // select calls: 1) provider, 2) model, 3) report format
  vi.mocked(select)
    .mockResolvedValueOnce("anthropic") // provider choice
    .mockResolvedValueOnce("claude-sonnet-4-20250514") // model
    .mockResolvedValueOnce("both"); // report format
  vi.mocked(password).mockResolvedValue("sk-ant-test-key-123");
  vi.mocked(input)
    .mockResolvedValueOnce("50") // promptsPerPair
    .mockResolvedValueOnce("90") // accuracyThreshold
    .mockResolvedValueOnce(skillsDirValue) // skillsDir
    .mockResolvedValueOnce("./homingo-reports"); // reportDir
}

describe("initCommand", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "homingo-init-test-"));
    configPath = join(tempDir, ".homingo", "config.json");
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates config.json with prompted values", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.anthropicApiKey).toBe("sk-ant-test-key-123");
    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.skillsDir).toBe("./skills");
  });

  it("config file has correct JSON structure with all fields", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config).toHaveProperty("anthropicApiKey");
    expect(config).toHaveProperty("model");
    expect(config).toHaveProperty("skillsDir");
    expect(config).toHaveProperty("shadowRouter.promptsPerPair");
    expect(config).toHaveProperty("shadowRouter.minPrompts");
    expect(config).toHaveProperty("shadowRouter.accuracyThreshold");
    expect(config).toHaveProperty("shadowRouter.maxIterations");
    expect(config).toHaveProperty("output.reportDir");
    expect(config).toHaveProperty("output.format");
  });

  it("creates skills directory and sample SKILL.md", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const skillPath = join(projectDir, "skills", "example-skill", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf-8");
    const parsed = matter(content);
    expect(parsed.data.name).toBe("example-skill");
    expect(parsed.data.description).toBeTruthy();
  });

  it("sample SKILL.md is parseable by parseSkills", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const skillsDir = join(projectDir, "skills");
    const { skills } = await parseSkills(skillsDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("example-skill");
  });

  it("does not create .env file", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const envPath = join(projectDir, ".env");
    expect(existsSync(envPath)).toBe(false);
  });

  it("skips sample skill when skills directory already contains skills", async () => {
    mockPromptDefaults();
    const projectDir = join(tempDir, "project");
    const existingSkillDir = join(projectDir, "skills", "my-real-skill");
    mkdirSync(existingSkillDir, { recursive: true });
    writeFileSync(
      join(existingSkillDir, "SKILL.md"),
      '---\nname: my-real-skill\ndescription: "Does real things"\n---\n\n# Real\n'
    );

    await initCommand(projectDir, configPath);

    const samplePath = join(projectDir, "skills", "example-skill", "SKILL.md");
    expect(existsSync(samplePath)).toBe(false);
  });

  it("works with custom skills directory name", async () => {
    mockPromptDefaults("my-skills");
    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const skillPath = join(projectDir, "my-skills", "example-skill", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
  });

  it("pre-existing config uses confirm to keep API key", async () => {
    // Write an existing config file
    mkdirSync(join(tempDir, ".homingo"), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ anthropicApiKey: "sk-ant-existing-key" }, null, 2));

    // Mock: select provider, confirm keeping existing key, select model, select format
    vi.mocked(select)
      .mockResolvedValueOnce("anthropic") // provider choice
      .mockResolvedValueOnce("claude-sonnet-4-20250514") // model
      .mockResolvedValueOnce("both"); // report format
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(input)
      .mockResolvedValueOnce("50")
      .mockResolvedValueOnce("90")
      .mockResolvedValueOnce("./skills")
      .mockResolvedValueOnce("./homingo-reports");

    const projectDir = join(tempDir, "project");
    mkdirSync(projectDir, { recursive: true });

    await initCommand(projectDir, configPath);

    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.anthropicApiKey).toBe("sk-ant-existing-key");
    // password should NOT have been called since we confirmed keeping the key
    expect(password).not.toHaveBeenCalled();
  });

  it("exits with error when target directory does not exist", async () => {
    mockPromptDefaults();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(initCommand("/nonexistent/path/to/dir", configPath)).rejects.toThrow(
      "process.exit called"
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
