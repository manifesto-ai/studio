import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";

describe("studio-core determinism", () => {
  it("builds identical schema-only graph and findings for identical inputs", () => {
    const left = createStudioSession({ schema: sampleSchema });
    const right = createStudioSession({ schema: sampleSchema });

    expect(left.getGraph("full")).toEqual(right.getGraph("full"));
    expect(left.getFindings()).toEqual(right.getFindings());
  });

  it("builds identical overlay projections for identical inputs", () => {
    const bundle = {
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    };

    const left = createStudioSession(bundle);
    const right = createStudioSession(bundle);

    expect(left.getGraph("full")).toEqual(right.getGraph("full"));
    expect(left.getFindings()).toEqual(right.getFindings());
    expect(left.getActionAvailability()).toEqual(right.getActionAvailability());
    expect(left.inspectSnapshot()).toEqual(right.inspectSnapshot());
    expect(left.analyzeTrace()).toEqual(right.analyzeTrace());
    expect(left.getLineageState()).toEqual(right.getLineageState());
    expect(left.getGovernanceState()).toEqual(right.getGovernanceState());
    expect(left.explainActionBlocker("submit")).toEqual(
      right.explainActionBlocker("submit")
    );
  });
});
