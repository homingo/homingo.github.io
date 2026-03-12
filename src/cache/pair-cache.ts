import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PairConflictReport } from "../types.js";

export interface CacheEntry {
  hash: string;
  createdAt: string;
  promptsPerPair: number;
  simModel: string;
  report: PairConflictReport;
}

const DEFAULT_CACHE_DIR = join(homedir(), ".homingo", "cache", "pairs");
const DEFAULT_TTL_DAYS = 7;

export class PairCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;

  constructor(cacheDir?: string, ttlDays?: number) {
    this.cacheDir = cacheDir ?? DEFAULT_CACHE_DIR;
    this.ttlMs = (ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000;
  }

  /**
   * Compute a deterministic hash for a skill pair + config.
   * Names are sorted so (A,B) === (B,A).
   */
  static hashPair(
    nameA: string,
    descA: string,
    nameB: string,
    descB: string,
    promptsPerPair: number,
    simModel: string
  ): string {
    // Sort by name to make order-independent
    const [first, second] =
      nameA <= nameB
        ? [
            { name: nameA, desc: descA },
            { name: nameB, desc: descB },
          ]
        : [
            { name: nameB, desc: descB },
            { name: nameA, desc: descA },
          ];

    const payload = JSON.stringify({
      a: first.name,
      ad: first.desc,
      b: second.name,
      bd: second.desc,
      p: promptsPerPair,
      m: simModel,
    });

    return createHash("sha256").update(payload).digest("hex").slice(0, 16);
  }

  get(hash: string): CacheEntry | null {
    const filePath = this.entryPath(hash);
    if (!existsSync(filePath)) return null;

    let entry: CacheEntry;
    try {
      entry = JSON.parse(readFileSync(filePath, "utf-8")) as CacheEntry;
    } catch {
      return null;
    }

    // Check TTL (>= so that ttlDays=0 means "always expired")
    const age = Date.now() - new Date(entry.createdAt).getTime();
    if (age >= this.ttlMs) {
      try {
        unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      return null;
    }

    return entry;
  }

  set(hash: string, entry: Omit<CacheEntry, "hash" | "createdAt">): void {
    this.ensureDir();
    const full: CacheEntry = {
      hash,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    writeFileSync(this.entryPath(hash), JSON.stringify(full), "utf-8");
  }

  /** Remove expired entries. Returns count of removed files. */
  prune(): number {
    if (!existsSync(this.cacheDir)) return 0;
    let removed = 0;
    for (const file of readdirSync(this.cacheDir)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(this.cacheDir, file);
      try {
        const entry = JSON.parse(readFileSync(filePath, "utf-8")) as CacheEntry;
        const age = Date.now() - new Date(entry.createdAt).getTime();
        if (age >= this.ttlMs) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // Malformed entry — remove it
        try {
          unlinkSync(filePath);
        } catch {
          /* ignore */
        }
        removed++;
      }
    }
    return removed;
  }

  /** Remove all entries. Returns count of removed files. */
  clear(): number {
    if (!existsSync(this.cacheDir)) return 0;
    let removed = 0;
    for (const file of readdirSync(this.cacheDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        unlinkSync(join(this.cacheDir, file));
        removed++;
      } catch {
        /* ignore */
      }
    }
    return removed;
  }

  private entryPath(hash: string): string {
    return join(this.cacheDir, `${hash}.json`);
  }

  private ensureDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }
}
