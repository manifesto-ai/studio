import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceSpan } from "@manifesto-ai/studio-core";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { buildGraphModel, type GraphModel, type GraphNodeId } from "../graph-model.js";
import { buildGraphFocusLens, resolveFocusRoots } from "../focus-lens.js";

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
const battleshipSource = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "battleship.mel",
  ),
  "utf8",
);

async function buildModel(source: string): Promise<GraphModel> {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: source });
  core.attach(adapter);
  const res = await core.build();
  if (res.kind !== "ok") throw new Error("build failed");
  const model = buildGraphModel(core.getModule());
  if (model === null) throw new Error("model null");
  return model;
}

function pointAt(
  model: GraphModel,
  nodeId: GraphNodeId,
  deltaColumn = 0,
): SourceSpan {
  const span = model.nodesById.get(nodeId)?.sourceSpan;
  if (span === null || span === undefined) throw new Error(`missing source span: ${nodeId}`);
  return {
    start: {
      line: span.start.line,
      column: span.start.column + deltaColumn,
    },
    end: {
      line: span.start.line,
      column: span.start.column + deltaColumn,
    },
  };
}

describe("resolveFocusRoots", () => {
  it("finds the smallest declaration containing a cursor position", async () => {
    const model = await buildModel(todoSource);

    const roots = resolveFocusRoots(model, pointAt(model, "action:addTodo"));

    expect(roots.map((node) => node.id)).toEqual(["action:addTodo"]);
  });

  it("returns every declaration intersecting a non-empty selection", async () => {
    const model = await buildModel(todoSource);
    const addTodo = model.nodesById.get("action:addTodo")?.sourceSpan;
    const removeTodo = model.nodesById.get("action:removeTodo")?.sourceSpan;
    if (addTodo === undefined || removeTodo === undefined || addTodo === null || removeTodo === null) {
      throw new Error("fixture spans missing");
    }

    const roots = resolveFocusRoots(model, {
      start: addTodo.start,
      end: removeTodo.end,
    });

    expect(roots.map((node) => node.id)).toEqual([
      "action:addTodo",
      "action:toggleTodo",
      "action:removeTodo",
    ]);
  });

  it("clears focus when the selection only covers type/domain declarations", async () => {
    const model = await buildModel(todoSource);

    const roots = resolveFocusRoots(model, {
      start: { line: 2, column: 3 },
      end: { line: 5, column: 23 },
    });

    expect(roots).toEqual([]);
  });
});

describe("buildGraphFocusLens", () => {
  it("builds a 1-hop lens for action roots", async () => {
    const model = await buildModel(todoSource);

    const lens = buildGraphFocusLens(model, ["action:addTodo"], "graph");

    expect(lens).not.toBeNull();
    if (lens === null) return;
    expect(lens.rootNodeIds).toEqual(["action:addTodo"]);
    expect(lens.nodeIds).toContain("state:todos");
    expect(lens.edgeIds).toContain("action:addTodo->state:todos:mutates");
    expect(lens.groups).toContainEqual({
      label: "Mutates",
      nodeIds: ["state:todos"],
      edgeIds: ["action:addTodo->state:todos:mutates"],
    });
  });

  it("builds inbound and outbound relation groups for state roots", async () => {
    const model = await buildModel(todoSource);

    const lens = buildGraphFocusLens(model, ["state:todos"], "editor");

    expect(lens).not.toBeNull();
    if (lens === null) return;
    const byLabel = new Map(lens.groups.map((group) => [group.label, group]));
    expect(byLabel.get("Feeds Into")?.nodeIds).toEqual(
      expect.arrayContaining([
        "computed:completedCount",
        "computed:todoCount",
      ]),
    );
    expect(byLabel.get("Mutated By")?.nodeIds).toEqual(
      expect.arrayContaining([
        "action:addTodo",
        "action:toggleTodo",
        "action:removeTodo",
        "action:clearCompleted",
      ]),
    );
  });

  it("builds unlock groups on dense graphs", async () => {
    const model = await buildModel(battleshipSource);

    const lens = buildGraphFocusLens(model, ["computed:canShoot"], "graph");

    expect(lens).not.toBeNull();
    if (lens === null) return;
    const unlocks = lens.groups.find((group) => group.label === "Unlocks");
    expect(unlocks?.nodeIds).toContain("action:shoot");
  });

  it("returns null when no valid graph-visible roots are present", async () => {
    const model = await buildModel(todoSource);

    const lens = buildGraphFocusLens(model, ["action:nope" as GraphNodeId], "editor");

    expect(lens).toBeNull();
  });
});
