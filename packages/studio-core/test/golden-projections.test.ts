import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";
import { readGolden, toSerializable } from "./helpers.js";

describe("studio-core golden projections", () => {
  it("matches the static findings report golden", () => {
    const session = createStudioSession({ schema: sampleSchema });

    expect(toSerializable(session.getFindings())).toEqual(
      readGolden("static-findings-report.json")
    );
  });

  it("matches the action blocker explanation golden", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot()
    });

    expect(toSerializable(session.explainActionBlocker("submit"))).toEqual(
      readGolden("action-blocker-explanation.json")
    );
  });

  it("matches the trace replay projection golden", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      trace: sampleTrace
    });

    expect(toSerializable(session.analyzeTrace())).toEqual(
      readGolden("trace-replay-projection.json")
    );
  });

  it("matches the lineage state projection golden", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      lineage: sampleLineage
    });

    expect(toSerializable(session.getLineageState())).toEqual(
      readGolden("lineage-state-projection.json")
    );
  });

  it("matches the governance state projection golden", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      governance: sampleGovernance
    });

    expect(toSerializable(session.getGovernanceState())).toEqual(
      readGolden("governance-state-projection.json")
    );
  });
});
