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
    expect(result.output.outcomes).toEqual([
      "completed",
      "completed",
      "completed",
    ]);
    expect(dispatched).toHaveLength(3);
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
    expect(result.output.outcomes).toEqual([
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
    expect(result.output.outcomes).toEqual(["completed", "error", "completed"]);
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
