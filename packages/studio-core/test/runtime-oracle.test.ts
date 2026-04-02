import { getAvailableActions } from "@manifesto-ai/core";
import { describe, expect, it } from "vitest";

import { createStudioSession } from "../src/index.js";
import { createSampleSnapshot, sampleSchema } from "./fixtures/sample-domain.js";

describe("studio-core runtime oracle integration", () => {
  it("matches Core getAvailableActions with per-action availability projections", () => {
    const snapshot = createSampleSnapshot();
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot
    });
    const readyAvailability = session
      .getActionAvailability()
      .filter((entry) => entry.status === "ready");
    const availableActions = [...getAvailableActions(sampleSchema, snapshot)].sort();

    expect(
      readyAvailability
        .filter((entry) => entry.available)
        .map((entry) => entry.actionId)
        .sort()
    ).toEqual(availableActions);

    const graph = session.getGraph("full");
    const setUserNode = graph.nodes.find((node) => node.id === "action:setUser");
    const submitNode = graph.nodes.find((node) => node.id === "action:submit");

    expect(
      setUserNode?.overlayFacts?.find((fact) => fact.key === "runtime:listed-available")?.value
    ).toBe(true);
    expect(
      submitNode?.overlayFacts?.find((fact) => fact.key === "runtime:listed-available")?.value
    ).toBe(false);
  });

  it("marks blocker explanations as runtime-derived when a snapshot is attached", () => {
    const session = createStudioSession({
      schema: sampleSchema,
      snapshot: createSampleSnapshot()
    });
    const blocker = session.explainActionBlocker("submit");

    expect(blocker.status).toBe("ready");
    if (blocker.status === "ready") {
      expect(blocker.blockerSource).toBe("runtime");
      expect(blocker.available).toBe(false);
    }
  });
});
