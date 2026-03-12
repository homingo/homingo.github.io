import { describe, it, expect } from "vitest";
import { pMap } from "../src/utils/concurrency.js";

describe("pMap", () => {
  it("maps all items and preserves order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await pMap(items, async (x) => x * 2, 3);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("handles empty array", async () => {
    const results = await pMap([], async (x: number) => x, 5);
    expect(results).toEqual([]);
  });

  it("handles single item", async () => {
    const results = await pMap([42], async (x) => x + 1, 3);
    expect(results).toEqual([43]);
  });

  it("respects concurrency limit", async () => {
    let activeConcurrency = 0;
    let maxConcurrency = 0;

    const items = Array.from({ length: 20 }, (_, i) => i);
    await pMap(
      items,
      async (x) => {
        activeConcurrency++;
        maxConcurrency = Math.max(maxConcurrency, activeConcurrency);
        // Small delay to allow concurrency to build up
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeConcurrency--;
        return x;
      },
      3
    );

    expect(maxConcurrency).toBeLessThanOrEqual(3);
    expect(maxConcurrency).toBeGreaterThan(1);
  });

  it("passes index to callback", async () => {
    const items = ["a", "b", "c"];
    const results = await pMap(items, async (item, index) => `${item}-${index}`, 2);
    expect(results).toEqual(["a-0", "b-1", "c-2"]);
  });

  it("handles concurrency greater than item count", async () => {
    const items = [1, 2, 3];
    const results = await pMap(items, async (x) => x * 10, 100);
    expect(results).toEqual([10, 20, 30]);
  });

  it("propagates errors from worker functions", async () => {
    const items = [1, 2, 3];
    await expect(
      pMap(
        items,
        async (x) => {
          if (x === 2) throw new Error("boom");
          return x;
        },
        2
      )
    ).rejects.toThrow("boom");
  });
});
