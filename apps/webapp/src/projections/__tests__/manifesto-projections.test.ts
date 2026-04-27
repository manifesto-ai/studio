import { describe, expect, it } from "vitest";
import type { DomainModule } from "@manifesto-ai/studio-core";
import type { StudioUiSnapshot } from "@/domain/StudioUiRuntime";
import {
  projectAction,
  projectFocus,
  projectProject,
  projectWorld,
} from "../manifesto-projections.js";

const STUDIO: StudioUiSnapshot = {
  focusedNodeId: "state:wow",
  focusedNodeKind: "state",
  focusedNodeOrigin: "source",
  activeLens: "agent",
  viewMode: "live",
  simulationActionName: null,
  scrubEnvelopeId: null,
  activeProjectName: "Counter",
  agentUserModuleReady: true,
  agentCurrentSchemaHash: "schema-counter",
  agentObservedSchemaHash: "schema-counter",
  agentObservedFocusNodeId: "state:wow",
  agentLastAdmittedToolName: null,
  hasFocus: true,
  isLive: true,
  isSimulating: false,
  isScrubbing: false,
  agentSchemaFresh: true,
  agentFocusFresh: true,
};

const MODULE = {
  schema: {
    hash: "schema-counter",
    state: {
      fields: { count: {}, wow: {} },
      fieldTypes: {
        count: { kind: "primitive", type: "number" },
        wow: { kind: "primitive", type: "string" },
      },
    },
    computed: {
      fields: { doubled: {} },
      fieldTypes: {
        doubled: { kind: "primitive", type: "number" },
      },
    },
    actions: {
      increment: {
        params: [],
        dispatchable: {},
      },
    },
    types: {},
  },
  graph: {
    nodes: [
      { id: "state:count", kind: "state", name: "count" },
      { id: "state:wow", kind: "state", name: "wow" },
      { id: "computed:doubled", kind: "computed", name: "doubled" },
      { id: "action:increment", kind: "action", name: "increment" },
    ],
    edges: [
      { from: "action:increment", to: "state:count", relation: "mutates" },
      { from: "state:count", to: "computed:doubled", relation: "feeds" },
    ],
  },
  sourceMap: {
    entries: {
      "state_field:wow": {
        span: {
          start: { line: 4, column: 3 },
          end: { line: 4, column: 18 },
        },
      },
      "action:increment": {
        span: {
          start: { line: 9, column: 3 },
          end: { line: 13, column: 4 },
        },
      },
    },
  },
  annotations: {
    entries: {
      "state_field:wow": [
        {
          tag: "comment:grounding",
          payload: "User-selected wow state.",
        },
      ],
    },
  },
} as unknown as DomainModule;

function input(studio: StudioUiSnapshot = STUDIO) {
  return {
    studio,
    module: MODULE,
    snapshot: {
      data: { count: 0, wow: "" },
      computed: { doubled: 0 },
    } as never,
    lineage: {
      head: { branchId: "main", worldId: "w_2", recordedAt: 2 },
      branches: ["main"],
      worlds: [
        {
          id: "w_1",
          parentId: null,
          branchId: "main",
          schemaHash: "schema-counter",
          snapshotHash: "s_1",
          origin: { kind: "build" },
          recordedAt: 1,
          changedPaths: [],
        },
        {
          id: "w_2",
          parentId: "w_1",
          branchId: "main",
          schemaHash: "schema-counter",
          snapshotHash: "s_2",
          origin: { kind: "dispatch", intentType: "setWow" },
          recordedAt: 2,
          changedPaths: ["data.wow"],
        },
      ],
    } as never,
    diagnostics: [],
    activeProjectName: "Counter",
    isActionAvailable: (name: string): boolean => name === "increment",
  };
}

describe("Manifesto projections", () => {
  it("projects focused state as a MEL entity, not raw UI fields", () => {
    const focus = projectFocus(input());

    expect(focus.status).toBe("ok");
    expect(focus.focus?.nodeId).toBe("state:wow");
    expect(focus.entity).toMatchObject({
      status: "ok",
      label: "state.wow",
      type: "string",
      value: {
        path: "data.wow",
        summary: "empty string",
      },
      sourceSpan: {
        start: { line: 4, column: 3 },
      },
      annotations: {
        grounding: ["User-selected wow state."],
      },
      lineage: {
        recentChangedWorldIds: ["w_2"],
      },
    });
    expect(focus).not.toHaveProperty("focusedNodeId");
  });

  it("projects action signature and live availability", () => {
    const action = projectAction("increment", input());

    expect(action).toMatchObject({
      status: "ok",
      label: "action.increment",
      type: "no input",
      action: {
        params: [],
        inputHint: null,
        available: true,
        hasDispatchableGate: true,
      },
    });
  });

  it("projects world and project context from the same inputs", () => {
    expect(projectWorld(input())).toMatchObject({
      viewMode: "live",
      headWorldId: "w_2",
      schemaHash: "schema-counter",
    });
    expect(projectProject(input())).toMatchObject({
      activeProjectName: "Counter",
      moduleReady: true,
      schemaHash: "schema-counter",
      diagnosticsCount: 0,
    });
  });
});
