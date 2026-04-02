import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";

describe("studio-core session", () => {
  it("builds graph and static findings from schema only", () => {
    const session = createStudioSession({ schema: sampleSchema });
    const graph = session.getGraph("full");
    const findings = session.getFindings();

    expect(graph.nodeCount).toBeGreaterThan(0);
    expect(findings.summary.total).toBeGreaterThan(0);
    expect(findings.findings.some((finding) => finding.kind === "missing-producer")).toBe(true);
  });

  it("supports runtime, trace, lineage, and governance overlays", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    });

    const availability = session.getActionAvailability();
    const snapshot = session.inspectSnapshot();
    const trace = session.analyzeTrace();
    const lineage = session.getLineageState();
    const governance = session.getGovernanceState();

    expect(availability.find((entry) => entry.actionId === "submit")?.status).toBe("ready");
    expect(snapshot.status).toBe("ready");
    expect(trace.status).toBe("ready");
    expect(lineage.status).toBe("ready");
    expect(governance.status).toBe("ready");
  });

  it("invalidates runtime projections when snapshot is detached", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot()
    });

    expect(session.inspectSnapshot().status).toBe("ready");
    session.detachOverlay("snapshot");
    expect(session.inspectSnapshot().status).toBe("not-provided");
  });
});

