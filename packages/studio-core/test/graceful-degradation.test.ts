import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import {
  createSampleSnapshot,
  sampleGovernance,
  sampleLineage,
  sampleSchema,
  sampleTrace
} from "./fixtures/sample-domain.js";
import { toSerializable } from "./helpers.js";

describe("studio-core graceful degradation", () => {
  it("returns structured unavailability when optional overlays are missing", () => {
    const session = createStudioSession({ schema: sampleSchema });

    expect(toSerializable(session.getActionAvailability())).toEqual([
      {
        status: "not-provided",
        actionId: "setUser",
        message: "Snapshot overlay is required for runtime availability."
      },
      {
        status: "not-provided",
        actionId: "submit",
        guard: {
          expression: '(userId neq null) and (draft neq "")'
        },
        message: "Snapshot overlay is required for runtime availability."
      }
    ]);
    expect(session.inspectSnapshot()).toEqual({
      status: "not-provided",
      requiredOverlay: "snapshot",
      message: "Snapshot overlay was not attached."
    });
    expect(session.analyzeTrace()).toEqual({
      status: "not-provided",
      requiredOverlay: "trace",
      message: "Trace overlay was not attached."
    });
    expect(session.getLineageState()).toEqual({
      status: "not-provided",
      requiredOverlay: "lineage",
      message: "Lineage overlay was not attached."
    });
    expect(session.getGovernanceState()).toEqual({
      status: "not-provided",
      requiredOverlay: "governance",
      message: "Governance overlay was not attached."
    });
    expect(session.explainActionBlocker("submit")).toEqual({
      status: "not-provided",
      actionId: "submit",
      summary: 'Snapshot overlay is required to explain blocker state for "submit".'
    });
    expect(session.explainActionBlocker("missing")).toEqual({
      status: "not-found",
      actionId: "missing",
      summary: 'Action "missing" does not exist in the graph.'
    });
  });

  it("degrades only the detached overlay while keeping other overlays available", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot(),
      trace: sampleTrace,
      lineage: sampleLineage,
      governance: sampleGovernance
    });

    session.detachOverlay("trace");

    expect(session.inspectSnapshot().status).toBe("ready");
    expect(session.analyzeTrace()).toEqual({
      status: "not-provided",
      requiredOverlay: "trace",
      message: "Trace overlay was not attached."
    });
    expect(session.getLineageState().status).toBe("ready");
    expect(session.getGovernanceState().status).toBe("ready");
    expect(session.explainActionBlocker("submit").status).toBe("ready");
  });
});
