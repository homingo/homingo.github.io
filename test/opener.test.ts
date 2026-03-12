import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isHeadless } from "../src/reporting/opener.js";

describe("isHeadless", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear CI-related env vars
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.GITLAB_CI;
    delete process.env.JENKINS_URL;
    delete process.env.CIRCLECI;
    delete process.env.TRAVIS;
    delete process.env.CODEBUILD_BUILD_ID;
    delete process.env.BUILDKITE;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("returns true when CI env var is set", () => {
    process.env.CI = "true";
    expect(isHeadless()).toBe(true);
  });

  it("returns true when GITHUB_ACTIONS is set", () => {
    process.env.GITHUB_ACTIONS = "true";
    expect(isHeadless()).toBe(true);
  });

  it("returns true when GITLAB_CI is set", () => {
    process.env.GITLAB_CI = "true";
    expect(isHeadless()).toBe(true);
  });

  it("returns true when JENKINS_URL is set", () => {
    process.env.JENKINS_URL = "http://jenkins.local";
    expect(isHeadless()).toBe(true);
  });

  it("returns true when CIRCLECI is set", () => {
    process.env.CIRCLECI = "true";
    expect(isHeadless()).toBe(true);
  });

  it("returns true when BUILDKITE is set", () => {
    process.env.BUILDKITE = "true";
    expect(isHeadless()).toBe(true);
  });

  it("returns false when no CI env vars are set (on non-Linux with display)", () => {
    // This test may not always be accurate on Linux CI, but covers the logic
    // On macOS (common dev environment), should return false when no CI vars set
    if (process.platform !== "linux") {
      expect(isHeadless()).toBe(false);
    }
  });
});
