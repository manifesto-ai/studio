import { describe, expect, it } from "vitest";

import {
  projectTransitionGraph,
  summarizeProjectionSignature,
  type ObservationRecord,
  type ProjectionPreset
} from "../src/index.js";
import { createSampleSnapshot } from "./fixtures/sample-domain.js";

const preset: ProjectionPreset = {
  id: "runtime-readiness",
  name: "Runtime Readiness",
  observe: [
    { kind: "action", id: "submit", label: "Submit" },
    { kind: "state", path: "userId", label: "User" },
    { kind: "state", path: "draft", label: "Draft" }
  ],
  groupBy: [
    {
      source: "state",
      path: "userId",
      label: "Has User",
      transform: { kind: "presence" }
    },
    {
      source: "state",
      path: "draft",
      label: "Draft",
      transform: { kind: "presence" }
    }
  ],
  options: {
    includeBlocked: true,
    includeDryRun: true
  }
};

function createObservationRecord(
  overrides: Partial<ObservationRecord> = {}
): ObservationRecord {
  return {
    id: "record-1",
    mode: "live",
    actionId: "submit",
    args: [],
    outcome: "committed",
    beforeSnapshot: createSampleSnapshot({
      userId: null,
      draft: "hello"
    }),
    afterSnapshot: createSampleSnapshot({
      userId: "user-1",
      draft: "hello"
    }),
    timestamp: 1,
    ...overrides
  };
}

describe("transition graph projection", () => {
  it("projects a deterministic graph from observed runs", () => {
    const records: ObservationRecord[] = [
      createObservationRecord(),
      createObservationRecord({
        id: "record-2",
        mode: "dry-run",
        timestamp: 2,
        beforeSnapshot: createSampleSnapshot({
          userId: "user-1",
          draft: "hello"
        }),
        afterSnapshot: createSampleSnapshot({
          userId: "user-1",
          draft: ""
        })
      })
    ];

    const currentSnapshot = createSampleSnapshot({
      userId: "user-1",
      draft: ""
    });

    const left = projectTransitionGraph(records, preset, { currentSnapshot });
    const right = projectTransitionGraph(records, preset, { currentSnapshot });

    expect(left).toEqual(right);
    expect(left.status).toBe("ready");

    if (left.status !== "ready") {
      return;
    }

    expect(left.nodes).toHaveLength(3);
    expect(left.edges).toHaveLength(2);
    expect(left.currentNodeId).toBeDefined();
    expect(left.edges[0]?.actionId).toBe("submit");
  });

  it("collapses identical signatures and tracks blocked self-loops", () => {
    const blockedBefore = createSampleSnapshot({
      userId: null,
      draft: ""
    });
    const blockedRecord = createObservationRecord({
      id: "blocked-1",
      outcome: "blocked",
      beforeSnapshot: blockedBefore,
      afterSnapshot: undefined
    });

    const projection = projectTransitionGraph([blockedRecord], preset, {
      currentSnapshot: blockedBefore
    });

    expect(projection.status).toBe("ready");

    if (projection.status !== "ready") {
      return;
    }

    expect(projection.nodes).toHaveLength(1);
    expect(projection.edges).toHaveLength(1);
    expect(projection.edges[0]?.selfLoop).toBe(true);
    expect(projection.edges[0]?.blockedCount).toBe(1);
  });

  it("rejects presets without group-by dimensions and supports buckets", () => {
    const invalid = projectTransitionGraph([], {
      id: "invalid",
      name: "Invalid",
      observe: [],
      groupBy: []
    });

    expect(invalid).toEqual({
      status: "invalid-preset",
      presetId: "invalid",
      presetName: "Invalid",
      message: "Select at least one state or computed field in group by.",
      nodes: [],
      edges: []
    });

    const bucketPreset: ProjectionPreset = {
      ...preset,
      id: "bucket",
      name: "Bucket",
      groupBy: [
        {
          source: "state",
          path: "lastSubmittedAt",
          label: "Submission Age",
          transform: {
            kind: "bucket",
            ranges: [
              { label: "empty", max: 1 },
              { label: "recent", min: 1, max: 500 }
            ]
          }
        }
      ]
    };

    expect(
      summarizeProjectionSignature(
        createSampleSnapshot({ lastSubmittedAt: 123 }),
        bucketPreset
      ).entries[0]
    ).toMatchObject({
      key: "lastSubmittedAt",
      value: "recent"
    });
  });
});
