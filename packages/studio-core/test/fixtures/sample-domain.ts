import {
  createSnapshot,
  hashSchemaSync,
  type DomainSchema,
  type Snapshot,
  type TraceGraph
} from "@manifesto-ai/core";

export const FIXED_NOW = 1_710_000_000_000;
const STALE_TIMESTAMP = FIXED_NOW - 1000 * 60 * 60 * 48;

const schemaInput = {
  id: "demo.studio",
  version: "0.1.0",
  types: {},
  state: {
    fields: {
      userId: { type: "string", required: false, description: "Current user id" },
      draft: { type: "string", required: false, default: "" },
      lastSubmittedAt: { type: "number", required: false }
    }
  },
  computed: {
    fields: {
      hasUser: {
        deps: ["userId"],
        expr: {
          kind: "neq",
          left: { kind: "get", path: "userId" },
          right: { kind: "lit", value: null }
        },
        description: "Whether a user is present."
      }
    }
  },
  actions: {
    submit: {
      description: "Submit the current draft.",
      available: {
        kind: "and",
        args: [
          {
            kind: "neq",
            left: { kind: "get", path: "userId" },
            right: { kind: "lit", value: null }
          },
          {
            kind: "neq",
            left: { kind: "get", path: "draft" },
            right: { kind: "lit", value: "" }
          }
        ]
      },
      flow: {
        kind: "seq",
        steps: [
          {
            kind: "effect",
            type: "submit",
            params: {
              userId: { kind: "get", path: "userId" },
              draft: { kind: "get", path: "draft" }
            }
          },
          {
            kind: "patch",
            op: "set",
            path: [{ kind: "prop", name: "lastSubmittedAt" }],
            value: { kind: "lit", value: 123 }
          },
          {
            kind: "halt",
            reason: "done"
          }
        ]
      }
    },
    setUser: {
      description: "Set the current user.",
      flow: {
        kind: "patch",
        op: "set",
        path: [{ kind: "prop", name: "userId" }],
        value: { kind: "lit", value: "user-1" }
      }
    }
  },
  meta: {
    name: "Studio Demo"
  }
} satisfies Omit<DomainSchema, "hash">;

export const sampleSchema: DomainSchema = {
  ...schemaInput,
  hash: hashSchemaSync(schemaInput)
};

export function createSampleSnapshot(data?: Partial<Record<string, unknown>>): Snapshot {
  return createSnapshot(
    {
      userId: null,
      draft: "hello",
      lastSubmittedAt: null,
      ...data
    },
    sampleSchema.hash,
    {
      now: FIXED_NOW,
      randomSeed: "studio-seed"
    }
  );
}

export const sampleTrace: TraceGraph = {
  root: {
    id: "root",
    kind: "flow",
    sourcePath: "actions.submit.flow",
    inputs: {},
    output: { status: "complete" },
    children: [],
    timestamp: 1
  },
  nodes: {
    root: {
      id: "root",
      kind: "flow",
      sourcePath: "actions.submit.flow",
      inputs: {},
      output: { status: "complete" },
      children: [],
      timestamp: 1
    },
    effect1: {
      id: "effect1",
      kind: "effect",
      sourcePath: "actions.submit.flow.steps.0",
      inputs: {},
      output: { requirementId: "req-1" },
      children: [],
      timestamp: 2
    },
    patch1: {
      id: "patch1",
      kind: "patch",
      sourcePath: "actions.submit.flow.steps.1",
      inputs: {},
      output: { previous: 123, next: 123 },
      children: [],
      timestamp: 3
    },
    branch1: {
      id: "branch1",
      kind: "branch",
      sourcePath: "actions.submit.flow.steps.2",
      inputs: {},
      output: { taken: false },
      children: [],
      timestamp: 4
    }
  },
  intent: {
    type: "submit",
    input: {}
  },
  baseVersion: 1,
  resultVersion: 2,
  duration: 5,
  terminatedBy: "complete"
};

export const sampleLineage = {
  activeBranchId: "main",
  branches: [
    {
      id: "main",
      headWorldId: "world-1",
      tipWorldId: "world-2",
      epoch: 2,
      headAdvancedAt: STALE_TIMESTAMP
    },
    {
      id: "orphan",
      headWorldId: null,
      tipWorldId: null,
      epoch: 1,
      headAdvancedAt: null
    }
  ],
  worlds: new Map([
    [
      "world-1",
      {
        worldId: "world-1",
        parentWorldId: null,
        schemaHash: sampleSchema.hash,
        snapshotHash: "snapshot-1",
        terminalStatus: "completed" as const,
        createdAt: 1
      }
    ],
    [
      "world-2",
      {
        worldId: "world-2",
        parentWorldId: "world-1",
        schemaHash: sampleSchema.hash,
        snapshotHash: "snapshot-2",
        terminalStatus: "completed" as const,
        createdAt: 2
      }
    ]
  ]),
  attempts: new Map([
    [
      "world-2",
      [
        {
          worldId: "world-2",
          branchId: "main",
          reused: true,
          createdAt: 2
        }
      ]
    ]
  ])
};

export const sampleGovernance = {
  proposals: new Map([
    [
      "proposal-1",
      {
        id: "proposal-1",
        branchId: "main",
        stage: "ingress" as const,
        actorId: "alice",
        createdAt: STALE_TIMESTAMP
      }
    ]
  ]),
  bindings: [],
  gates: new Map([
    [
      "main",
      {
        branchId: "main",
        locked: true,
        currentProposalId: "proposal-1",
        epoch: 2
      }
    ]
  ])
};
