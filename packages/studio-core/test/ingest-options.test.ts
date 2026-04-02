import { describe, expect, it } from "vitest";

import type { GovernanceInput, LineageInput, TraceGraph } from "../src/index.js";

import { createStudioSession } from "../src/index.js";
import { normalizeAnalysisBundle } from "../src/ingest/normalize-analysis-bundle.js";
import {
  sampleGovernance,
  sampleLineage,
  sampleSchema
} from "./fixtures/sample-domain.js";

const plainLineageInput: LineageInput = {
  activeBranchId: "main",
  branches: sampleLineage.branches.map((branch) => ({ ...branch })),
  worlds: [...sampleLineage.worlds.values()].map((world) => ({ ...world })),
  attempts: {
    "world-2": sampleLineage.attempts
      .get("world-2")!
      .map(({ worldId: _worldId, ...attempt }) => ({ ...attempt }))
  }
};

const plainGovernanceInput: GovernanceInput = {
  proposals: {
    "proposal-1": {
      branchId: "main",
      stage: "ingress",
      actorId: "alice",
      createdAt: sampleGovernance.proposals.get("proposal-1")!.createdAt
    }
  },
  bindings: [
    {
      actorId: "alice",
      authorityId: "root",
      permissions: ["approve"]
    }
  ],
  gates: [...sampleGovernance.gates.values()].map((gate) => ({ ...gate }))
};

const invalidTrace = {
  root: {
    id: "root",
    kind: "flow",
    sourcePath: "actions.submit.flow",
    inputs: {},
    output: {},
    children: [],
    timestamp: 1
  },
  nodes: {},
  intent: {
    input: {}
  },
  baseVersion: 1,
  resultVersion: "2",
  duration: 5,
  terminatedBy: "complete"
} as unknown as TraceGraph;

describe("studio-core ingest and session options", () => {
  it("normalizes plain lineage and governance query shapes into canonical exports", () => {
    const normalized = normalizeAnalysisBundle({
      schema: sampleSchema,
      lineage: plainLineageInput,
      governance: plainGovernanceInput
    });

    expect(normalized.lineage.provided).toBe(true);
    expect(normalized.lineage.value?.worlds).toBeInstanceOf(Map);
    expect(normalized.lineage.value?.attempts).toBeInstanceOf(Map);
    expect(normalized.lineage.value?.worlds.get("world-2")?.parentWorldId).toBe("world-1");
    expect(normalized.lineage.value?.attempts.get("world-2")?.[0]?.worldId).toBe("world-2");

    expect(normalized.governance.provided).toBe(true);
    expect(normalized.governance.value?.proposals).toBeInstanceOf(Map);
    expect(normalized.governance.value?.gates).toBeInstanceOf(Map);
    expect(normalized.governance.value?.proposals.get("proposal-1")?.id).toBe("proposal-1");
  });

  it("accepts widened lineage and governance inputs through the session API", () => {
    const session = createStudioSession({ schema: sampleSchema });

    session.attachLineage(plainLineageInput);
    session.attachGovernance(plainGovernanceInput);

    const lineage = session.getLineageState();
    const governance = session.getGovernanceState();

    expect(lineage.status).toBe("ready");
    expect(governance.status).toBe("ready");
    if (governance.status === "ready") {
      expect(governance.findings.some((finding) => finding.kind === "actor-unbound")).toBe(false);
    }
  });

  it("keeps invalid overlays as provided-but-unavailable markers in lenient mode", () => {
    const normalized = normalizeAnalysisBundle(
      {
        schema: sampleSchema,
        trace: invalidTrace
      },
      {
        validationMode: "lenient"
      }
    );

    expect(normalized.trace.provided).toBe(true);
    expect(normalized.trace.value).toBeUndefined();
    expect(normalized.trace.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing-root-node", "invalid-intent-type", "invalid-version-fields"])
    );

    const session = createStudioSession({
      schema: sampleSchema,
      trace: invalidTrace
    });

    expect(session.analyzeTrace()).toEqual({
      status: "not-provided",
      requiredOverlay: "trace",
      message: "Trace overlay was not attached."
    });
  });

  it("throws on invalid overlays in strict mode", () => {
    expect(() =>
      createStudioSession(
        {
          schema: sampleSchema,
          trace: invalidTrace
        },
        {
          validationMode: "strict"
        }
      )
    ).toThrow(/Invalid trace overlay/);
  });

  it("respects custom stale thresholds at session creation", () => {
    const staleSession = createStudioSession({
      schema: sampleSchema,
      lineage: sampleLineage,
      governance: sampleGovernance
    });
    const relaxedSession = createStudioSession(
      {
        schema: sampleSchema,
        lineage: sampleLineage,
        governance: sampleGovernance
      },
      {
        lineageStaleMs: 1000 * 60 * 60 * 24 * 365 * 10,
        governanceProposalStaleMs: 1000 * 60 * 60 * 24 * 365 * 10
      }
    );
    const staleLineage = staleSession.getLineageState();
    const staleGovernance = staleSession.getGovernanceState();
    const relaxedLineage = relaxedSession.getLineageState();
    const relaxedGovernance = relaxedSession.getGovernanceState();

    expect(staleLineage.status).toBe("ready");
    expect(staleGovernance.status).toBe("ready");
    expect(relaxedLineage.status).toBe("ready");
    expect(relaxedGovernance.status).toBe("ready");

    if (
      staleLineage.status === "ready" &&
      staleGovernance.status === "ready" &&
      relaxedLineage.status === "ready" &&
      relaxedGovernance.status === "ready"
    ) {
      expect(staleLineage.findings.some((finding) => finding.kind === "branch-stale")).toBe(true);
      expect(staleGovernance.findings.some((finding) => finding.kind === "proposal-stale")).toBe(true);
      expect(relaxedLineage.findings.some((finding) => finding.kind === "branch-stale")).toBe(false);
      expect(relaxedGovernance.findings.some((finding) => finding.kind === "proposal-stale")).toBe(false);
    }
  });
});
