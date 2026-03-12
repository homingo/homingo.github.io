import { exec } from "node:child_process";
import { platform } from "node:os";

/**
 * Detect headless/CI environments where opening a browser would fail.
 */
export function isHeadless(): boolean {
  const env = process.env;

  // Common CI environment variables
  if (
    env.CI ||
    env.GITHUB_ACTIONS ||
    env.GITLAB_CI ||
    env.JENKINS_URL ||
    env.CIRCLECI ||
    env.TRAVIS ||
    env.CODEBUILD_BUILD_ID ||
    env.BUILDKITE
  ) {
    return true;
  }

  // Linux without a display server
  if (platform() === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return true;
  }

  return false;
}

/**
 * Open a file in the default browser. Fire-and-forget — errors are silently ignored.
 */
export function openInBrowser(filePath: string): void {
  const os = platform();
  let command: string;

  switch (os) {
    case "darwin":
      command = `open "${filePath}"`;
      break;
    case "win32":
      command = `start "" "${filePath}"`;
      break;
    default:
      command = `xdg-open "${filePath}"`;
      break;
  }

  exec(command, (err) => {
    // Silently ignore errors — this is a convenience feature
    if (err && process.env.DEBUG) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}
