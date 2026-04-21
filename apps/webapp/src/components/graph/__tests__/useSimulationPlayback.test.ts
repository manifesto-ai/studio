import { describe, expect, it } from "vitest";
import type {
  GraphModel,
  GraphNode,
  SimulationPlayback,
} from "@manifesto-ai/studio-react";
import {
  buildSimulationPlaybackSteps,
  buildTraceNodePlaybackSteps,
  computePlaybackScrollTarget,
} from "../useSimulationPlayback";

function createNode(
  id: GraphNode["id"],
  kind: GraphNode["kind"],
  name: string,
): GraphNode {
  return {
    id,
    kind,
    name,
    // Node ids and local keys share a branded-string value in the
    // fixtures; the cast pins the brand so the test compiles cleanly.
    localKey: id as GraphNode["localKey"],
    sourceSpan: null,
    identityFate: null,
    snapshotFate: undefined,
    warnings: [],
  };
}

function createModel(nodes: readonly GraphNode[], edges: GraphModel["edges"]): GraphModel {
  return {
    schemaHash: "test-schema",
    nodes,
    edges,
    nodesById: new Map(nodes.map((node) => [node.id, node])),
  };
}

function createPlayback(trace: SimulationPlayback["trace"]): SimulationPlayback {
  return {
    generation: 1,
    actionName: "addTodo",
    source: "interaction-editor",
    trace,
    mode: "sequence",
    traceNodeId: null,
  };
}

describe("useSimulationPlayback helpers", () => {
  it("projects action -> state -> computed steps from trace + graph topology", () => {
    const model = createModel(
      [
        createNode("action:addTodo", "action", "addTodo"),
        createNode("state:todos", "state", "todos"),
        createNode("computed:todoCount", "computed", "todoCount"),
      ],
      [
        {
          id: "action:addTodo->state:todos:mutates",
          source: "action:addTodo",
          target: "state:todos",
          relation: "mutates",
        },
        {
          id: "state:todos->computed:todoCount:feeds",
          source: "state:todos",
          target: "computed:todoCount",
          relation: "feeds",
        },
      ],
    );

    const playback = createPlayback({
      root: {
        id: "trace-root",
        kind: "branch",
        sourcePath: "actions.addTodo.flow",
        inputs: { cond: true },
        output: null,
        timestamp: 0,
        children: [
          {
            id: "trace-patch",
            kind: "patch",
            sourcePath: "actions.addTodo.flow.then.steps[1]",
            inputs: { op: "set", path: "todos" },
            output: [{ title: "buy milk" }],
            timestamp: 0,
            children: [],
          },
        ],
      },
      nodes: {},
      intent: {
        type: "addTodo",
        input: { title: "buy milk" },
      },
      baseVersion: 1,
      resultVersion: 2,
      duration: 0,
      terminatedBy: "complete",
    });

    expect(buildSimulationPlaybackSteps(model, playback)).toEqual([
      { nodeId: "action:addTodo", edgeId: null },
      {
        nodeId: "state:todos",
        edgeId: "action:addTodo->state:todos:mutates",
      },
      {
        nodeId: "computed:todoCount",
        edgeId: "state:todos->computed:todoCount:feeds",
      },
    ]);
  });

  it("keeps node pulses when sibling steps have no direct connecting edge", () => {
    const model = createModel(
      [
        createNode("action:addTodo", "action", "addTodo"),
        createNode("state:todos", "state", "todos"),
        createNode("computed:visibleTodos", "computed", "visibleTodos"),
        createNode("computed:todoCount", "computed", "todoCount"),
      ],
      [
        {
          id: "action:addTodo->state:todos:mutates",
          source: "action:addTodo",
          target: "state:todos",
          relation: "mutates",
        },
        {
          id: "state:todos->computed:visibleTodos:feeds",
          source: "state:todos",
          target: "computed:visibleTodos",
          relation: "feeds",
        },
        {
          id: "state:todos->computed:todoCount:feeds",
          source: "state:todos",
          target: "computed:todoCount",
          relation: "feeds",
        },
      ],
    );

    const playback = createPlayback({
      root: {
        id: "trace-root",
        kind: "branch",
        sourcePath: "actions.addTodo.flow",
        inputs: { cond: true },
        output: null,
        timestamp: 0,
        children: [
          {
            id: "trace-patch",
            kind: "patch",
            sourcePath: "actions.addTodo.flow.then.steps[1]",
            inputs: { op: "set", path: "todos[0]" },
            output: [{ title: "buy milk" }],
            timestamp: 0,
            children: [],
          },
        ],
      },
      nodes: {},
      intent: {
        type: "addTodo",
        input: { title: "buy milk" },
      },
      baseVersion: 1,
      resultVersion: 2,
      duration: 0,
      terminatedBy: "complete",
    });

    expect(buildSimulationPlaybackSteps(model, playback)).toEqual([
      { nodeId: "action:addTodo", edgeId: null },
      {
        nodeId: "state:todos",
        edgeId: "action:addTodo->state:todos:mutates",
      },
      {
        nodeId: "computed:visibleTodos",
        edgeId: "state:todos->computed:visibleTodos:feeds",
      },
      {
        nodeId: "computed:todoCount",
        edgeId: null,
      },
    ]);
  });

  it("can replay a single trace node as one step cascade", () => {
    const model = createModel(
      [
        createNode("action:addTodo", "action", "addTodo"),
        createNode("state:todos", "state", "todos"),
        createNode("computed:todoCount", "computed", "todoCount"),
      ],
      [
        {
          id: "action:addTodo->state:todos:mutates",
          source: "action:addTodo",
          target: "state:todos",
          relation: "mutates",
        },
        {
          id: "state:todos->computed:todoCount:feeds",
          source: "state:todos",
          target: "computed:todoCount",
          relation: "feeds",
        },
      ],
    );
    const playback = createPlayback({
      root: {
        id: "trace-root",
        kind: "branch",
        sourcePath: "actions.addTodo.flow",
        inputs: { cond: true },
        output: null,
        timestamp: 0,
        children: [
          {
            id: "trace-patch",
            kind: "patch",
            sourcePath: "actions.addTodo.flow.then.steps[1]",
            inputs: { op: "set", path: "todos" },
            output: [{ title: "buy milk" }],
            timestamp: 0,
            children: [],
          },
        ],
      },
      nodes: {
        "trace-patch": {
          id: "trace-patch",
          kind: "patch",
          sourcePath: "actions.addTodo.flow.then.steps[1]",
          inputs: { op: "set", path: "todos" },
          output: [{ title: "buy milk" }],
          timestamp: 0,
          children: [],
        },
      },
      intent: {
        type: "addTodo",
        input: { title: "buy milk" },
      },
      baseVersion: 1,
      resultVersion: 2,
      duration: 0,
      terminatedBy: "complete",
    });

    expect(buildTraceNodePlaybackSteps(model, playback, "trace-patch")).toEqual([
      { nodeId: "state:todos", edgeId: null },
      {
        nodeId: "computed:todoCount",
        edgeId: "state:todos->computed:todoCount:feeds",
      },
    ]);
  });

  it("only requests origin scrolling when the node is outside the viewport", () => {
    expect(
      computePlaybackScrollTarget(
        { x: 40, y: 60, width: 120, height: 80 },
        {
          left: 0,
          top: 0,
          width: 400,
          height: 300,
          scrollWidth: 1200,
          scrollHeight: 900,
        },
      ),
    ).toBeNull();

    expect(
      computePlaybackScrollTarget(
        { x: 920, y: 420, width: 180, height: 82 },
        {
          left: 0,
          top: 0,
          width: 400,
          height: 300,
          scrollWidth: 1200,
          scrollHeight: 900,
        },
      ),
    ).toEqual({
      left: 800,
      top: 311,
    });
  });
});
