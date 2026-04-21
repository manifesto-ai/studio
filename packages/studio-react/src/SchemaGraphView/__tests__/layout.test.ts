import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { buildGraphModel, type GraphModel } from "../graph-model.js";
import {
  GraphLayoutCache,
  runLayout,
  type PositionMap,
} from "../layout.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..", "..");
const todoSource = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "todo.mel",
  ),
  "utf8",
);

async function buildModel(): Promise<GraphModel> {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  core.attach(adapter);
  const res = await core.build();
  if (res.kind !== "ok") throw new Error("build failed");
  const m = buildGraphModel(core.getModule());
  if (m === null) throw new Error("model null");
  return m;
}

function sample(p: PositionMap): Array<[string, number, number]> {
  return Array.from(p.entries()).map(([id, { x, y }]) => [id, x, y]);
}

describe("runLayout", () => {
  it("is deterministic for identical inputs", async () => {
    const model = await buildModel();
    const opts = { width: 800, height: 600, iterations: 250 };
    const a = runLayout(model, opts);
    const b = runLayout(model, opts);
    expect(sample(a)).toEqual(sample(b));
  });

  it("produces finite coordinates for every node", async () => {
    const model = await buildModel();
    const positions = runLayout(model, { width: 800, height: 600 });
    expect(positions.size).toBe(model.nodes.length);
    for (const [, { x, y }] of positions) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("keeps seeded positions exactly when pinSeeded is true", async () => {
    const model = await buildModel();
    const first = runLayout(model, { width: 800, height: 600 });
    const second = runLayout(model, {
      width: 800,
      height: 600,
      prevPositions: first,
      pinSeeded: true,
    });
    for (const [id, p] of first) {
      const q = second.get(id);
      expect(q).toBeDefined();
      if (q === undefined) continue;
      expect(q.x).toBe(p.x);
      expect(q.y).toBe(p.y);
    }
  });

  it("seeded-but-unpinned positions drift only modestly", async () => {
    const model = await buildModel();
    const first = runLayout(model, { width: 800, height: 600 });
    const second = runLayout(model, {
      width: 800,
      height: 600,
      prevPositions: first,
    });
    // Positions should not be chaotically reshuffled — drift < 200 px for
    // every surviving node (graph is ~10 nodes, 800x600 canvas).
    for (const [id, p] of first) {
      const q = second.get(id);
      expect(q).toBeDefined();
      if (q === undefined) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy);
      expect(d).toBeLessThan(200);
    }
  });
});

describe("GraphLayoutCache", () => {
  it("stores and returns positions by schemaHash", async () => {
    const model = await buildModel();
    const cache = new GraphLayoutCache();
    const positions = runLayout(model, { width: 800, height: 600 });
    cache.set(model.schemaHash, positions);
    const hit = cache.get(model.schemaHash);
    expect(hit).not.toBeNull();
    expect(hit?.size).toBe(positions.size);
  });

  it("returns null for an unknown hash", () => {
    const cache = new GraphLayoutCache();
    expect(cache.get("nope")).toBeNull();
  });

  it("enforces LRU capacity", () => {
    const cache = new GraphLayoutCache(2);
    cache.set("a", new Map());
    cache.set("b", new Map());
    cache.set("c", new Map());
    expect(cache.size()).toBe(2);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).not.toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  it("touch on get keeps entry fresh", () => {
    const cache = new GraphLayoutCache(2);
    cache.set("a", new Map());
    cache.set("b", new Map());
    cache.get("a"); // touch
    cache.set("c", new Map()); // evicts oldest → b
    expect(cache.get("a")).not.toBeNull();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).not.toBeNull();
  });

  it("carryOver returns only positions for surviving nodes", async () => {
    const model = await buildModel();
    const positions = runLayout(model, { width: 800, height: 600 });
    // Pretend the model lost half its nodes
    const trimmed: GraphModel = {
      ...model,
      nodes: model.nodes.slice(0, Math.max(1, Math.floor(model.nodes.length / 2))),
      nodesById: new Map(
        model.nodes
          .slice(0, Math.max(1, Math.floor(model.nodes.length / 2)))
          .map((n) => [n.id, n]),
      ),
    };
    const carried = GraphLayoutCache.carryOver(trimmed, positions);
    expect(carried.size).toBe(trimmed.nodes.length);
    for (const n of trimmed.nodes) {
      const p = carried.get(n.id);
      const orig = positions.get(n.id);
      expect(p).toEqual(orig);
    }
  });
});
