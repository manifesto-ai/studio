import { describe, expect, it } from "vitest";

import { FINDING_REGISTRY, createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";
import { toSerializable } from "./helpers.js";

describe("studio-core contracts", () => {
  it("serializes stable projections and explanation payloads", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    });

    const payloads = toSerializable({
      graph: session.getGraph("full"),
      findings: session.getFindings(),
      blocker: session.explainActionBlocker("submit"),
      availability: session.getActionAvailability(),
      snapshot: session.inspectSnapshot(),
      trace: session.analyzeTrace(),
      lineage: session.getLineageState(),
      governance: session.getGovernanceState()
    });

    expect(payloads.graph.schemaHash).toBe(sampleSchema.hash);
    expect(payloads.graph.nodes.length).toBeGreaterThan(0);
    expect(payloads.findings.status).toBe("ready");
    expect(payloads.findings.findings[0]).toHaveProperty("causeChain");
    expect(payloads.blocker.status).toBe("ready");
    expect(payloads.availability.length).toBeGreaterThan(0);
    expect(payloads.snapshot.status).toBe("ready");
    expect(payloads.trace.status).toBe("ready");
    expect(payloads.lineage.status).toBe("ready");
    expect(payloads.governance.status).toBe("ready");
  });

  it("exposes a read-only session surface and stable finding kinds", () => {
    const session = createStudioSession({ schema: sampleSchema });
    expect(typeof session.attachSnapshot).toBe("function");
    expect(typeof session.attachTrace).toBe("function");
    expect(typeof session.attachLineage).toBe("function");
    expect(typeof session.attachGovernance).toBe("function");
    expect(typeof session.detachOverlay).toBe("function");
    expect(typeof session.getGraph).toBe("function");
    expect(typeof session.getFindings).toBe("function");
    expect(typeof session.explainActionBlocker).toBe("function");
    expect(typeof session.getActionAvailability).toBe("function");
    expect(typeof session.inspectSnapshot).toBe("function");
    expect(typeof session.analyzeTrace).toBe("function");
    expect(typeof session.getLineageState).toBe("function");
    expect(typeof session.getGovernanceState).toBe("function");
    expect(typeof session.dispose).toBe("function");
    expect("dispatch" in session).toBe(false);
    expect("execute" in session).toBe(false);
    expect("mutate" in session).toBe(false);

    expect(Object.keys(FINDING_REGISTRY).sort()).toEqual([
      "action-blocked",
      "actor-unbound",
      "branch-stale",
      "convergence-risk",
      "cyclic-dependency",
      "dead-state",
      "effect-without-patch",
      "gate-locked",
      "guard-partial-block",
      "guard-unsatisfiable",
      "missing-producer",
      "name-collision",
      "orphan-branch",
      "proposal-stale",
      "redundant-patch",
      "seal-reuse-detected",
      "snapshot-drift",
      "unreachable-action",
      "unused-branch"
    ]);
  });
});
