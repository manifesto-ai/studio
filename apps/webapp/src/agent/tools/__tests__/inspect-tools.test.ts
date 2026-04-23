/**
 * Tests for the four introspection tools — inspectFocus,
 * inspectSnapshot, inspectNeighbors, inspectAvailability. These are
 * pure reads so the tests stub the context directly and assert the
 * JSON shape the agent will see.
 */
import { describe, expect, it } from "vitest";
import {
  createInspectFocusTool,
  type InspectFocusContext,
} from "../inspect-focus.js";
import {
  createInspectSnapshotTool,
  type InspectSnapshotContext,
} from "../inspect-snapshot.js";
import {
  createInspectNeighborsTool,
  type InspectNeighborsContext,
} from "../inspect-neighbors.js";
import {
  createInspectAvailabilityTool,
  type InspectAvailabilityContext,
} from "../inspect-availability.js";

describe("inspectFocus", () => {
  it("returns the current focus and ui state", async () => {
    const ctx: InspectFocusContext = {
      getFocus: () => ({
        focusedNodeId: "action:toggleTodo",
        focusedNodeKind: "action",
        focusedNodeOrigin: "graph",
        activeLens: "agent",
        viewMode: "live",
        simulationActionName: null,
        scrubEnvelopeId: null,
        activeProjectName: "todo.mel",
        lastUserPrompt: null,
        lastAgentAnswer: null,
        agentTurnCount: 0,
      }),
    };
    const tool = createInspectFocusTool();
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.focusedNodeId).toBe("action:toggleTodo");
      expect(result.output.activeLens).toBe("agent");
    }
  });

  it("surfaces a runtime_error when the getter throws", async () => {
    const tool = createInspectFocusTool();
    const result = await tool.run(
      {},
      {
        getFocus: () => {
          throw new Error("ui runtime not ready");
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("runtime_error");
  });
});

describe("inspectSnapshot", () => {
  it("returns { data, computed } from the core snapshot", async () => {
    const ctx: InspectSnapshotContext = {
      getSnapshot: () => ({
        data: { todos: [] },
        computed: { todoCount: 0 },
      }),
    };
    const tool = createInspectSnapshotTool();
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.data).toEqual({ todos: [] });
      expect(result.output.computed).toEqual({ todoCount: 0 });
    }
  });

  it("returns an error when no snapshot is available (module not compiled)", async () => {
    const tool = createInspectSnapshotTool();
    const result = await tool.run({}, { getSnapshot: () => null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/has not compiled/);
  });
});

describe("inspectNeighbors", () => {
  const edges = [
    { from: "action:emptyTrash", to: "state:tasks", relation: "mutates" as const },
    { from: "action:emptyTrash", to: "state:clock", relation: "mutates" as const },
    { from: "computed:deletedCount", to: "action:emptyTrash", relation: "unlocks" as const },
    { from: "state:tasks", to: "computed:deletedTasks", relation: "feeds" as const },
  ];

  it("groups edges into incoming and outgoing relative to the target node", async () => {
    const ctx: InspectNeighborsContext = { getEdges: () => edges };
    const tool = createInspectNeighborsTool();
    const result = await tool.run({ nodeId: "action:emptyTrash" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.outgoing).toEqual([
      { peerId: "state:tasks", relation: "mutates", direction: "out" },
      { peerId: "state:clock", relation: "mutates", direction: "out" },
    ]);
    expect(result.output.incoming).toEqual([
      { peerId: "computed:deletedCount", relation: "unlocks", direction: "in" },
    ]);
  });

  it("rejects unknown nodes when hasNode is provided", async () => {
    const ctx: InspectNeighborsContext = {
      getEdges: () => edges,
      hasNode: (id) => id === "action:emptyTrash",
    };
    const tool = createInspectNeighborsTool();
    const result = await tool.run({ nodeId: "action:bogus" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });

  it("rejects empty nodeId input", async () => {
    const tool = createInspectNeighborsTool();
    const result = await tool.run(
      { nodeId: "" },
      { getEdges: () => [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });
});

describe("generateMock", () => {
  // Minimal coverage here — the heavy lifting is in mock/generate
  // tests. This just verifies the tool wrapper plumbs inputs/outputs
  // through correctly and maps invalid states to the right error kind.
  it("rejects an empty action name", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGenerateMockTool } = await import("../generate-mock.js");
    const tool = createGenerateMockTool();
    const result = await tool.run(
      { action: "" },
      { getModule: () => null },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });

  it("returns runtime_error when no module is compiled", async () => {
    const { createGenerateMockTool } = await import("../generate-mock.js");
    const tool = createGenerateMockTool();
    const result = await tool.run(
      { action: "createTask", count: 1 },
      { getModule: () => null },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("runtime_error");
  });

  it("delegates to the pure generator and returns its result on success", async () => {
    const { createGenerateMockTool } = await import("../generate-mock.js");
    const tool = createGenerateMockTool();
    const fakeModule = {
      schema: {
        actions: {
          setFilter: {
            params: ["newFilter"],
            inputType: { kind: "primitive", type: "string" },
          },
        },
        types: {},
      },
    } as never;
    const result = await tool.run(
      { action: "setFilter", count: 2, seed: 7 },
      { getModule: () => fakeModule },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.action).toBe("setFilter");
    expect(result.output.samples).toHaveLength(2);
    expect(result.output.paramNames).toEqual(["newFilter"]);
  });
});

describe("inspectLineage", () => {
  const fullLineage = [
    {
      worldId: "w3",
      origin: { kind: "dispatch" as const, intentType: "toggleTodo" },
      parentWorldId: "w2",
      schemaHash: "h1",
      changedPaths: ["data.todos.0.completed"],
      createdAt: "2026-04-24T01:00:00.000Z",
    },
    {
      worldId: "w2",
      origin: { kind: "dispatch" as const, intentType: "addTodo" },
      parentWorldId: "w1",
      schemaHash: "h1",
      changedPaths: Array.from({ length: 25 }, (_, i) => `data.todos.${i}`),
      createdAt: "2026-04-24T00:59:00.000Z",
    },
    {
      worldId: "w1",
      origin: { kind: "dispatch" as const, intentType: "addTodo" },
      parentWorldId: "w0",
      schemaHash: "h1",
      changedPaths: ["data.todos.0"],
      createdAt: "2026-04-24T00:58:00.000Z",
    },
    {
      worldId: "w0",
      origin: { kind: "build" as const, buildId: "b1" },
      parentWorldId: null,
      schemaHash: "h1",
      changedPaths: [],
      createdAt: "2026-04-24T00:57:00.000Z",
    },
  ];

  it("returns compact projection by default (no changedPaths / parent / etc.)", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const result = await tool.run({}, { getLineage: () => fullLineage });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Default limit is 5, only 4 entries total → all four returned.
    expect(result.output.entries).toHaveLength(4);
    for (const e of result.output.entries) {
      // Compact: only worldId + origin.
      expect(e).toHaveProperty("worldId");
      expect(e).toHaveProperty("origin");
      expect(e).not.toHaveProperty("changedPaths");
      expect(e).not.toHaveProperty("parentWorldId");
      expect(e).not.toHaveProperty("schemaHash");
      expect(e).not.toHaveProperty("createdAt");
    }
  });

  it("opts into fields on demand", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const result = await tool.run(
      { fields: ["changedPaths", "parent", "createdAt"], limit: 1 },
      { getLineage: () => fullLineage },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = result.output.entries[0]!;
    expect(e.changedPaths).toEqual(["data.todos.0.completed"]);
    expect(e.parentWorldId).toBe("w2");
    expect(e.createdAt).toBe("2026-04-24T01:00:00.000Z");
    expect(e).not.toHaveProperty("schemaHash");
  });

  it("truncates changedPaths over CHANGED_PATHS_CAP and flags the overflow", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const result = await tool.run(
      { fields: ["changedPaths"], limit: 1, beforeWorldId: "w3" },
      { getLineage: () => fullLineage },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = result.output.entries[0]!;
    // w2 had 25 paths — capped at 20 with a flag.
    expect(e.changedPaths).toHaveLength(20);
    expect(e.changedPathsTruncated).toBe(true);
  });

  it("filters by intentType before paging", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const result = await tool.run(
      { intentType: "addTodo" },
      { getLineage: () => fullLineage },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.entries.map((e) => e.worldId)).toEqual(["w2", "w1"]);
    expect(result.output.totalMatched).toBe(2);
    expect(result.output.totalWorlds).toBe(4);
  });

  it("paginates via beforeWorldId and exposes nextBeforeWorldId", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const first = await tool.run(
      { limit: 2 },
      { getLineage: () => fullLineage },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.output.entries.map((e) => e.worldId)).toEqual(["w3", "w2"]);
    expect(first.output.nextBeforeWorldId).toBe("w2");

    const second = await tool.run(
      { limit: 2, beforeWorldId: "w2" },
      { getLineage: () => fullLineage },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.output.entries.map((e) => e.worldId)).toEqual(["w1", "w0"]);
    expect(second.output.nextBeforeWorldId).toBe(null);
  });

  it("rejects an unknown beforeWorldId as invalid_input", async () => {
    const { createInspectLineageTool } = await import("../inspect-lineage.js");
    const tool = createInspectLineageTool();
    const result = await tool.run(
      { beforeWorldId: "bogus" },
      { getLineage: () => fullLineage },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });
});

describe("inspectConversation", () => {
  const turns = [
    {
      turnId: "t3",
      userPrompt: "why is this blocked?",
      assistantText: "`toggleTodo` requires `todoCount > 0`.",
      reasoning: "resolved focus → toggleTodo, then ran explainLegality.",
      toolCalls: [
        { name: "inspectFocus", argumentsJson: "{}", ok: true },
        {
          name: "explainLegality",
          argumentsJson: '{"action":"toggleTodo"}',
          ok: true,
        },
      ],
      endedAt: "2026-04-24T01:00:00.000Z",
      stoppedAtCap: false,
    },
    {
      turnId: "t2",
      userPrompt: "seed 5 tasks",
      assistantText: "Done — 5 completed.",
      reasoning: "",
      toolCalls: [
        {
          name: "seedMock",
          argumentsJson: '{"action":"createTask","count":5}',
          ok: true,
        },
      ],
      endedAt: "2026-04-24T00:58:00.000Z",
      stoppedAtCap: false,
    },
    {
      turnId: "t1",
      userPrompt: "hello",
      assistantText: "Hello. Ask the runtime about itself.",
      reasoning: "",
      toolCalls: [],
      endedAt: "2026-04-24T00:57:00.000Z",
      stoppedAtCap: false,
    },
  ];

  it("returns compact projection by default", async () => {
    const { createInspectConversationTool } = await import(
      "../inspect-conversation.js"
    );
    const tool = createInspectConversationTool();
    const result = await tool.run({}, { getTurns: () => turns });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.turns).toHaveLength(3);
    for (const t of result.output.turns) {
      expect(t).toHaveProperty("turnId");
      expect(t).toHaveProperty("userPrompt");
      expect(t).toHaveProperty("toolCount");
      expect(t).toHaveProperty("hasAssistantText");
      expect(t).not.toHaveProperty("assistantText");
      expect(t).not.toHaveProperty("reasoning");
      expect(t).not.toHaveProperty("toolCalls");
    }
    expect(result.output.turns[0]!.toolCount).toBe(2);
    expect(result.output.turns[2]!.toolCount).toBe(0);
  });

  it("opts into heavy fields on demand with caps", async () => {
    const { createInspectConversationTool } = await import(
      "../inspect-conversation.js"
    );
    const tool = createInspectConversationTool();
    const result = await tool.run(
      { fields: ["assistantText", "toolCalls"], limit: 1 },
      { getTurns: () => turns },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.output.turns[0]!;
    expect(first.assistantText).toBe(
      "`toggleTodo` requires `todoCount > 0`.",
    );
    expect(first.toolCalls).toHaveLength(2);
    expect(first.toolCalls?.[0]?.name).toBe("inspectFocus");
    expect(first).not.toHaveProperty("reasoning");
  });

  it("caps assistantText at the configured limit with an ellipsis", async () => {
    const { createInspectConversationTool } = await import(
      "../inspect-conversation.js"
    );
    const longText = "x".repeat(3000);
    const tool = createInspectConversationTool();
    const result = await tool.run(
      { fields: ["assistantText"], limit: 1 },
      {
        getTurns: () => [
          {
            turnId: "t0",
            userPrompt: "q",
            assistantText: longText,
            reasoning: "",
            toolCalls: [],
            endedAt: null,
            stoppedAtCap: false,
          },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const txt = result.output.turns[0]!.assistantText!;
    expect(txt.length).toBe(2000);
    expect(txt.endsWith("…")).toBe(true);
  });

  it("paginates via beforeTurnId and advertises nextBeforeTurnId", async () => {
    const { createInspectConversationTool } = await import(
      "../inspect-conversation.js"
    );
    const tool = createInspectConversationTool();
    const first = await tool.run(
      { limit: 2 },
      { getTurns: () => turns },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.output.turns.map((t) => t.turnId)).toEqual(["t3", "t2"]);
    expect(first.output.nextBeforeTurnId).toBe("t2");

    const second = await tool.run(
      { limit: 2, beforeTurnId: "t2" },
      { getTurns: () => turns },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.output.turns.map((t) => t.turnId)).toEqual(["t1"]);
    expect(second.output.nextBeforeTurnId).toBe(null);
  });
});

describe("seedMock", () => {
  const fakeModule = {
    schema: {
      actions: {
        setFilter: {
          params: ["newFilter"],
          inputType: { kind: "primitive", type: "string" },
        },
      },
      types: {},
    },
  } as never;

  it("generates N samples and dispatches each one, tallying outcomes", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const dispatched: unknown[] = [];
    const tool = createSeedMockTool();
    const result = await tool.run(
      { action: "setFilter", count: 3, seed: 1 },
      {
        getModule: () => fakeModule,
        createIntent: (action, ...args) => ({ type: action, input: args }),
        dispatchAsync: async (intent) => {
          dispatched.push(intent);
          return { kind: "completed" };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.attempted).toBe(3);
    expect(result.output.completed).toBe(3);
    expect(result.output.outcomes.map((o) => o.kind)).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(dispatched).toHaveLength(3);
  });

  it("captures rejection code + message so the agent can explain WHY", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const tool = createSeedMockTool();
    let call = 0;
    const result = await tool.run(
      { action: "setFilter", count: 3, seed: 1 },
      {
        getModule: () => fakeModule,
        createIntent: (action) => ({ type: action }),
        dispatchAsync: async () => {
          call++;
          if (call === 2) {
            return {
              kind: "rejected",
              rejection: {
                code: "guard-failed",
                message: "existsById(tasks, id) evaluated false",
              },
            };
          }
          return { kind: "completed" };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.completed).toBe(2);
    expect(result.output.rejected).toBe(1);
    const rejected = result.output.outcomes[1];
    expect(rejected).toMatchObject({
      kind: "rejected",
      code: "guard-failed",
      message: "existsById(tasks, id) evaluated false",
    });
  });

  it("counts rejected and failed outcomes separately, doesn't abort the loop", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const tool = createSeedMockTool();
    let call = 0;
    const result = await tool.run(
      { action: "setFilter", count: 4, seed: 1 },
      {
        getModule: () => fakeModule,
        createIntent: (action) => ({ type: action }),
        dispatchAsync: async () => {
          call++;
          if (call === 2) return { kind: "rejected" };
          if (call === 3) return { kind: "failed" };
          return { kind: "completed" };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.completed).toBe(2);
    expect(result.output.rejected).toBe(1);
    expect(result.output.failed).toBe(1);
    expect(result.output.attempted).toBe(4);
    expect(result.output.outcomes.map((o) => o.kind)).toEqual([
      "completed",
      "rejected",
      "failed",
      "completed",
    ]);
  });

  it("counts thrown dispatches as 'error' without aborting", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const tool = createSeedMockTool();
    let call = 0;
    const result = await tool.run(
      { action: "setFilter", count: 3, seed: 1 },
      {
        getModule: () => fakeModule,
        createIntent: (action) => ({ type: action }),
        dispatchAsync: async () => {
          call++;
          if (call === 2) throw new Error("boom");
          return { kind: "completed" };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.completed).toBe(2);
    expect(result.output.errored).toBe(1);
    expect(result.output.outcomes.map((o) => o.kind)).toEqual([
      "completed",
      "error",
      "completed",
    ]);
    expect(result.output.outcomes[1]).toMatchObject({
      kind: "error",
      message: "boom",
    });
  });

  it("rejects an empty action name", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const tool = createSeedMockTool();
    const result = await tool.run(
      { action: "" },
      {
        getModule: () => fakeModule,
        createIntent: () => ({}),
        dispatchAsync: async () => ({ kind: "completed" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalid_input");
  });

  it("returns runtime_error when no module is compiled", async () => {
    const { createSeedMockTool } = await import("../seed-mock.js");
    const tool = createSeedMockTool();
    const result = await tool.run(
      { action: "setFilter", count: 1 },
      {
        getModule: () => null,
        createIntent: () => ({}),
        dispatchAsync: async () => ({ kind: "completed" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("runtime_error");
  });
});

describe("inspectAvailability", () => {
  it("returns every action with its live availability flag", async () => {
    const ctx: InspectAvailabilityContext = {
      listActionNames: () => ["toggleTodo", "clearDone"],
      isActionAvailable: (name) => name !== "clearDone",
    };
    const tool = createInspectAvailabilityTool();
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.actions).toEqual([
      { name: "toggleTodo", available: true },
      { name: "clearDone", available: false },
    ]);
  });

  it("enriches entries with describeAction metadata when available", async () => {
    const ctx: InspectAvailabilityContext = {
      listActionNames: () => ["toggleTodo"],
      isActionAvailable: () => true,
      describeAction: (name) =>
        name === "toggleTodo"
          ? {
              paramNames: ["id"],
              hasDispatchableGate: true,
              description: "toggle done",
            }
          : null,
    };
    const tool = createInspectAvailabilityTool();
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.actions[0]).toEqual({
      name: "toggleTodo",
      available: true,
      paramNames: ["id"],
      hasDispatchableGate: true,
      description: "toggle done",
    });
  });

  it("treats isActionAvailable throws as false rather than propagating", async () => {
    const ctx: InspectAvailabilityContext = {
      listActionNames: () => ["broken"],
      isActionAvailable: () => {
        throw new Error("boom");
      },
    };
    const tool = createInspectAvailabilityTool();
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.actions[0]).toEqual({ name: "broken", available: false });
  });
});
