#!/usr/bin/env node

/**
 * Syncs the version from package.json into docs/.vitepress/config.ts.
 * Runs automatically via the npm "version" lifecycle script.
 *
 * Usage: node scripts/sync-version.js
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = `v${pkg.version}`;

const configPath = resolve(root, "docs/.vitepress/config.ts");
let config = readFileSync(configPath, "utf-8");

// Replace the version string in the nav dropdown: text: "v0.x.y"
const replaced = config.replace(/text:\s*"v\d+\.\d+\.\d+[^"]*"/, `text: "${version}"`);

if (replaced === config) {
  console.log(`⚠ No version string found to replace in ${configPath}`);
  process.exit(1);
}

writeFileSync(configPath, replaced, "utf-8");
console.log(`✔ Synced version to ${version} in docs/.vitepress/config.ts`);
