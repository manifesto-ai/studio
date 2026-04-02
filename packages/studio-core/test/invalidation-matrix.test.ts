import { describe, expect, it } from "vitest";

import { FINDING_REGISTRY, createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";

function createFullSession() {
  return createStudioSession({
    schema: sampleSchema,
    snapshot: createSampleSnapshot(),
    trace: sampleTrace,
    lineage: sampleLineage,
    governance: sampleGovernance
  });
}

function isStaticFindingKind(kind: keyof typeof FINDING_REGISTRY): boolean {
  const provenance = FINDING_REGISTRY[kind].provenance as readonly string[];
  return provenance.includes("static");
}

function getStaticFindings(session: ReturnType<typeof createStudioSession>) {
  const report = session.getFindings();
  const findings = report.findings.filter((finding) => isStaticFindingKind(finding.kind));

  return {
    ...report,
    findings,
    summary: {
      total: findings.length,
      bySeverity: {
        error: findings.filter((finding) => finding.severity === "error").length,
        warn: findings.filter((finding) => finding.severity === "warn").length,
        info: findings.filter((finding) => finding.severity === "info").length
      },
      byKind: Object.fromEntries(
        Object.entries(report.summary.byKind).filter(([kind]) =>
          isStaticFindingKind(kind as keyof typeof FINDING_REGISTRY)
        )
      )
    }
  };
}

describe("studio-core invalidation matrix", () => {
  it("restores the schema-only graph and static findings after detaching snapshot", () => {
    const baseline = createStudioSession({ schema: sampleSchema });
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot()
    });

    session.detachOverlay("snapshot");

    expect(session.getGraph("full")).toEqual(baseline.getGraph("full"));
    expect(getStaticFindings(session)).toEqual(getStaticFindings(baseline));
  });

  it("restores the schema-only graph and static findings after detaching trace", () => {
    const baseline = createStudioSession({ schema: sampleSchema });
    const session = createStudioSession({
      schema: sampleSchema,
      trace: sampleTrace
    });

    session.detachOverlay("trace");

    expect(session.getGraph("full")).toEqual(baseline.getGraph("full"));
    expect(getStaticFindings(session)).toEqual(getStaticFindings(baseline));
  });

  it("restores the schema-only graph and static findings after detaching lineage", () => {
    const baseline = createStudioSession({ schema: sampleSchema });
    const session = createStudioSession({
      schema: sampleSchema,
      lineage: sampleLineage
    });

    session.detachOverlay("lineage");

    expect(session.getGraph("full")).toEqual(baseline.getGraph("full"));
    expect(getStaticFindings(session)).toEqual(getStaticFindings(baseline));
  });

  it("restores the schema-only graph and static findings after detaching governance", () => {
    const baseline = createStudioSession({ schema: sampleSchema });
    const session = createStudioSession({
      schema: sampleSchema,
      governance: sampleGovernance
    });

    session.detachOverlay("governance");

    expect(session.getGraph("full")).toEqual(baseline.getGraph("full"));
    expect(getStaticFindings(session)).toEqual(getStaticFindings(baseline));
  });

  it("invalidates only runtime partitions when snapshot is detached", () => {
    const baselineStatic = getStaticFindings(createStudioSession({ schema: sampleSchema }));
    const session = createFullSession();

    session.detachOverlay("snapshot");

    expect(session.inspectSnapshot()).toEqual({
      status: "not-provided",
      requiredOverlay: "snapshot",
      message: "Snapshot overlay was not attached."
    });
    expect(session.getActionAvailability().every((entry) => entry.status === "not-provided")).toBe(
      true
    );
    expect(session.explainActionBlocker("submit").status).toBe("not-provided");
    expect(session.analyzeTrace().status).toBe("ready");
    expect(session.getLineageState().status).toBe("ready");
    expect(session.getGovernanceState().status).toBe("ready");
    expect(getStaticFindings(session)).toEqual(baselineStatic);
  });

  it("invalidates only trace partitions when trace is detached", () => {
    const baselineStatic = getStaticFindings(createStudioSession({ schema: sampleSchema }));
    const session = createFullSession();

    session.detachOverlay("trace");

    expect(session.inspectSnapshot().status).toBe("ready");
    expect(session.analyzeTrace()).toEqual({
      status: "not-provided",
      requiredOverlay: "trace",
      message: "Trace overlay was not attached."
    });
    expect(session.getLineageState().status).toBe("ready");
    expect(session.getGovernanceState().status).toBe("ready");
    expect(getStaticFindings(session)).toEqual(baselineStatic);
  });

  it("invalidates only lineage partitions when lineage is detached", () => {
    const baselineStatic = getStaticFindings(createStudioSession({ schema: sampleSchema }));
    const session = createFullSession();

    session.detachOverlay("lineage");

    expect(session.inspectSnapshot().status).toBe("ready");
    expect(session.analyzeTrace().status).toBe("ready");
    expect(session.getLineageState()).toEqual({
      status: "not-provided",
      requiredOverlay: "lineage",
      message: "Lineage overlay was not attached."
    });
    expect(session.getGovernanceState().status).toBe("ready");
    expect(getStaticFindings(session)).toEqual(baselineStatic);
  });

  it("invalidates only governance partitions when governance is detached", () => {
    const baselineStatic = getStaticFindings(createStudioSession({ schema: sampleSchema }));
    const session = createFullSession();

    session.detachOverlay("governance");

    expect(session.inspectSnapshot().status).toBe("ready");
    expect(session.analyzeTrace().status).toBe("ready");
    expect(session.getLineageState().status).toBe("ready");
    expect(session.getGovernanceState()).toEqual({
      status: "not-provided",
      requiredOverlay: "governance",
      message: "Governance overlay was not attached."
    });
    expect(getStaticFindings(session)).toEqual(baselineStatic);
  });
});
