import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import {
  buildGraphModel,
  fromLocalKey,
  identityFateGlyph,
  toLocalKey,
  type GraphNodeId,
} from "../graph-model.js";

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

async function buildTodoModule() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: todoSource });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") {
    throw new Error(
      `build failed: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }
  const module = core.getModule();
  if (module === null) throw new Error("module null after build");
  return { core, module };
}

describe("toLocalKey / fromLocalKey", () => {
  it("maps state:X to state_field:X and back", () => {
    expect(toLocalKey("state:todos" as GraphNodeId)).toBe("state_field:todos");
    expect(fromLocalKey("state_field:todos")).toBe("state:todos");
  });

  it("leaves computed: prefix intact round-trip", () => {
    expect(toLocalKey("computed:hasCompleted" as GraphNodeId)).toBe(
      "computed:hasCompleted",
    );
    expect(fromLocalKey("computed:hasCompleted")).toBe(
      "computed:hasCompleted",
    );
  });

  it("leaves action: prefix intact round-trip", () => {
    expect(toLocalKey("action:addTodo" as GraphNodeId)).toBe("action:addTodo");
    expect(fromLocalKey("action:addTodo")).toBe("action:addTodo");
  });

  it("returns null for non-graph local keys", () => {
    expect(fromLocalKey("domain:TodoApp")).toBeNull();
    expect(fromLocalKey("type:TodoItem")).toBeNull();
    expect(fromLocalKey("type_field:TodoItem.title")).toBeNull();
  });
});

describe("buildGraphModel (todo.mel)", () => {
  it("returns null for null module", () => {
    expect(buildGraphModel(null)).toBeNull();
    expect(buildGraphModel(undefined)).toBeNull();
  });

  it("enumerates state, computed, action nodes", async () => {
    const { module } = await buildTodoModule();
    const model = buildGraphModel(module);
    expect(model).not.toBeNull();
    if (model === null) return;

    const kinds = new Set(model.nodes.map((n) => n.kind));
    expect(kinds.has("state")).toBe(true);
    expect(kinds.has("computed")).toBe(true);
    expect(kinds.has("action")).toBe(true);

    const ids = new Set(model.nodes.map((n) => n.id));
    expect(ids.has("state:todos")).toBe(true);
    expect(ids.has("action:addTodo")).toBe(true);
  });

  it("attaches source spans from module.sourceMap", async () => {
    const { module } = await buildTodoModule();
    const model = buildGraphModel(module);
    if (model === null) throw new Error("model null");
    const addTodo = model.nodesById.get("action:addTodo" as GraphNodeId);
    expect(addTodo).toBeDefined();
    expect(addTodo?.sourceSpan).not.toBeNull();
    expect(addTodo?.sourceSpan?.start.line).toBeGreaterThan(0);
  });

  it("uses schema.hash as cache key", async () => {
    const { module } = await buildTodoModule();
    const model = buildGraphModel(module);
    expect(model?.schemaHash).toBe(module.schema.hash);
    expect(typeof model?.schemaHash).toBe("string");
    expect(model?.schemaHash.length).toBeGreaterThan(0);
  });

  it("builds edges with stable ids and covers known relations", async () => {
    const { module } = await buildTodoModule();
    const model = buildGraphModel(module);
    if (model === null) throw new Error("model null");
    expect(model.edges.length).toBeGreaterThan(0);
    const relations = new Set(model.edges.map((e) => e.relation));
    // todo.mel has actions that mutate state (addTodo → todos) and a
    // computed that feeds from state (hasCompleted ← todos).
    expect(relations.has("mutates") || relations.has("feeds")).toBe(true);
    // Edge id format is stable and deduplicating
    for (const e of model.edges) {
      expect(e.id).toBe(`${e.source}->${e.target}:${e.relation}`);
    }
  });

  it("applies plan snapshot buckets to state nodes when provided", async () => {
    const { core, module } = await buildTodoModule();
    // Re-build after a dispatch — still same schema, so plan keeps state_field
    // in the preserved bucket. That's enough to prove the mapping wires up.
    await core.dispatchAsync(
      core.createIntent("addTodo", { title: "smoke" }),
    );
    const plan = core.getLastReconciliationPlan();
    const model = buildGraphModel(module, plan);
    if (model === null) throw new Error("model null");
    const todosNode = model.nodesById.get("state:todos" as GraphNodeId);
    expect(todosNode).toBeDefined();
    if (plan !== null) {
      // At minimum, identity or snapshot fate should be defined for the
      // state node when a plan exists.
      expect(
        todosNode?.snapshotFate !== undefined ||
          todosNode?.identityFate !== null,
      ).toBe(true);
    }
  });

  it("has no nodes with missing sourceSpan for graph kinds", async () => {
    const { module } = await buildTodoModule();
    const model = buildGraphModel(module);
    if (model === null) throw new Error("model null");
    const missing = model.nodes.filter((n) => n.sourceSpan === null);
    expect(missing).toEqual([]);
  });
});

describe("identityFateGlyph", () => {
  it("returns empty for null", () => {
    expect(identityFateGlyph(null)).toBe("");
  });
  it("maps each fate kind to a distinct glyph", () => {
    const glyphs = new Set([
      identityFateGlyph({ kind: "preserved" }),
      identityFateGlyph({ kind: "initialized", reason: "new" }),
      identityFateGlyph({ kind: "discarded", reason: "removed" }),
      identityFateGlyph({
        kind: "renamed",
        from: "state_field:old",
      }),
    ]);
    expect(glyphs.size).toBe(4);
  });
});
