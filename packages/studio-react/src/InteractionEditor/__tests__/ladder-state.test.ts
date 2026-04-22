/**
 * Unit tests for `deriveLadderState`.
 *
 * Covers every branch of the 5-step legality ladder as mandated by
 * SDK §"Intent Explanation" and asserted by UX philosophy Rules L1,
 * L2, L3, S1, S2.
 */
import { describe, expect, it } from "vitest";
import type {
  DispatchBlocker,
  IntentExplanation,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";
import { deriveLadderState, type LadderInputs } from "../ladder-state.js";

const lit = (v: unknown) => ({ kind: "literal" as const, value: v });

function blocker(layer: "available" | "dispatchable", desc?: string): DispatchBlocker {
  return {
    layer,
    expression: { kind: "ref", ref: "phase" } as unknown as DispatchBlocker["expression"],
    evaluatedResult: lit(false),
    description: desc,
  };
}

function blockedUnavailable(blockers: readonly DispatchBlocker[]): IntentExplanation {
  return {
    kind: "blocked",
    actionName: "shoot",
    available: false,
    dispatchable: false,
    blockers,
  };
}

function blockedDispatchable(blockers: readonly DispatchBlocker[]): IntentExplanation {
  return {
    kind: "blocked",
    actionName: "shoot",
    available: true,
    dispatchable: false,
    blockers,
  };
}

function admitted(): IntentExplanation {
  return {
    kind: "admitted",
    actionName: "addTodo",
    available: true,
    dispatchable: true,
    status: "idle",
    requirements: [],
    canonicalSnapshot: { data: {}, computed: {}, system: {}, input: null, meta: {} },
    snapshot: { data: {}, computed: {} },
    newAvailableActions: [],
    changedPaths: ["data.todos[0]"],
  } as unknown as IntentExplanation;
}

function fakeSimulate(): StudioSimulateResult {
  return {
    snapshot: { data: {}, computed: {} },
    canonicalSnapshot: { data: {}, computed: {}, system: {}, input: null, meta: {} },
    changedPaths: ["data.todos[0]"],
    requirements: [],
    status: "idle",
    newAvailableActions: [],
    meta: { schemaHash: "abc123" },
  } as unknown as StudioSimulateResult;
}

function base(overrides: Partial<LadderInputs> = {}): LadderInputs {
  return {
    explanation: null,
    simulate: null,
    inputInvalid: false,
    stale: false,
    ...overrides,
  };
}

describe("deriveLadderState — empty canvas", () => {
  it("all five steps are not-yet-evaluated when nothing has happened", () => {
    const state = deriveLadderState(base());
    expect(state.steps.map((s) => s.status)).toEqual([
      "not-yet-evaluated",
      "not-yet-evaluated",
      "not-yet-evaluated",
      "not-yet-evaluated",
      "not-yet-evaluated",
    ]);
    expect(state.blockedAt).toBeNull();
    expect(state.simulateReadyForDispatch).toBe(false);
  });
});

describe("deriveLadderState — step 1: coarse availability", () => {
  it("blocks at `available` when SDK returns available:false", () => {
    const bs = [blocker("available", "phase must be 'playing'")];
    const state = deriveLadderState(base({ explanation: blockedUnavailable(bs) }));
    const step1 = state.steps[0];
    expect(step1.id).toBe("available");
    expect(step1.status).toBe("blocked-here");
    expect(step1.blockers).toEqual(bs);
    // Downstream layers must be demoted, not hidden (Rule L1).
    expect(state.steps.slice(1).every((s) => s.status === "not-yet-evaluated")).toBe(true);
    expect(state.blockedAt).toBe("available");
    expect(state.simulateReadyForDispatch).toBe(false);
  });

  it("narrative for `available` failure frames as 'not present in action surface', not 'disabled'", () => {
    const state = deriveLadderState(
      base({ explanation: blockedUnavailable([blocker("available")]) }),
    );
    expect(state.steps[0].narrative).toMatch(/callable surface/i);
    // Rule L2: must NOT frame as disabled.
    expect(state.steps[0].narrative ?? "").not.toMatch(/disabled/i);
  });
});

describe("deriveLadderState — step 2: input validation", () => {
  it("blocks at `input-valid` when buildIntent threw INVALID_INPUT and no explanation is available", () => {
    // If availability passed but input is invalid, SDK throws before
    // dispatchability is even evaluated. We model this with
    // `inputInvalid: true` and `explanation: null` (buildIntent
    // caught the throw; we never called explainIntent).
    const state = deriveLadderState(base({ inputInvalid: true }));
    expect(state.steps[0].status).toBe("passed");
    expect(state.steps[1].status).toBe("blocked-here");
    expect(state.steps[2].status).toBe("not-yet-evaluated");
    expect(state.blockedAt).toBe("input-valid");
  });

  it("narrative for `input-valid` failure mentions dispatchability is only evaluated next", () => {
    const state = deriveLadderState(base({ inputInvalid: true }));
    expect(state.steps[1].narrative ?? "").toMatch(/input|Dispatchability|after/i);
  });
});

describe("deriveLadderState — step 3: dispatchability", () => {
  it("blocks at `dispatchable` when explanation is available:true, dispatchable:false", () => {
    const bs = [blocker("dispatchable", "cell must be unknown")];
    const state = deriveLadderState(base({ explanation: blockedDispatchable(bs) }));
    expect(state.steps[0].status).toBe("passed");
    expect(state.steps[1].status).toBe("passed");
    expect(state.steps[2].status).toBe("blocked-here");
    expect(state.steps[2].blockers).toEqual(bs);
    // Downstream still not evaluated.
    expect(state.steps[3].status).toBe("not-yet-evaluated");
    expect(state.steps[4].status).toBe("not-yet-evaluated");
    expect(state.blockedAt).toBe("dispatchable");
  });

  it("dispatchable narrative distinguishes 'this specific intent' from action availability (Rule L2)", () => {
    const state = deriveLadderState(
      base({ explanation: blockedDispatchable([blocker("dispatchable")]) }),
    );
    expect(state.steps[2].narrative ?? "").toMatch(/specific intent|different input/i);
  });

  it("blockers at step 3 do NOT contain blockers from step 1 (Rule L1 — no cross-layer mixing)", () => {
    // The SDK's first-failing-layer short-circuit guarantees blocked=>3
    // has no layer:"available" blockers. Still, the ladder must not
    // invent any.
    const onlyDispatchable = [blocker("dispatchable")];
    const state = deriveLadderState(
      base({ explanation: blockedDispatchable(onlyDispatchable) }),
    );
    expect(state.steps[2].blockers?.every((b) => b.layer === "dispatchable")).toBe(true);
    expect(state.steps[0].blockers).toBeUndefined();
  });
});

describe("deriveLadderState — step 4: simulated", () => {
  it("stays not-yet-evaluated when admission passed but simulate has not run", () => {
    const state = deriveLadderState(base({ explanation: admitted() }));
    expect(state.steps[3].status).toBe("not-yet-evaluated");
    expect(state.steps[4].status).toBe("not-yet-evaluated");
    expect(state.simulateReadyForDispatch).toBe(false);
  });

  it("passes step 4 and step 5 when simulate is fresh and explanation is admitted", () => {
    const state = deriveLadderState(
      base({ explanation: admitted(), simulate: fakeSimulate() }),
    );
    expect(state.steps.every((s) => s.status === "passed")).toBe(true);
    expect(state.simulateReadyForDispatch).toBe(true);
    expect(state.blockedAt).toBeNull();
  });

  it("demotes step 4 back to not-yet-evaluated when input is stale (Rule S2)", () => {
    const state = deriveLadderState(
      base({ explanation: admitted(), simulate: fakeSimulate(), stale: true }),
    );
    expect(state.steps[3].status).toBe("not-yet-evaluated");
    expect(state.steps[4].status).toBe("not-yet-evaluated");
    expect(state.simulateReadyForDispatch).toBe(false);
  });
});

describe("deriveLadderState — simulate-first gate (Rule S1)", () => {
  it("simulateReadyForDispatch is true iff all 5 steps passed", () => {
    // Admitted + fresh simulate → dispatch allowed.
    const ok = deriveLadderState(
      base({ explanation: admitted(), simulate: fakeSimulate() }),
    );
    expect(ok.simulateReadyForDispatch).toBe(true);

    // Admitted but no simulate yet → dispatch forbidden.
    const noSim = deriveLadderState(base({ explanation: admitted() }));
    expect(noSim.simulateReadyForDispatch).toBe(false);

    // Admitted + simulate but stale → dispatch forbidden.
    const staleSim = deriveLadderState(
      base({ explanation: admitted(), simulate: fakeSimulate(), stale: true }),
    );
    expect(staleSim.simulateReadyForDispatch).toBe(false);

    // Blocked anywhere → dispatch forbidden (even if an old simulate is set).
    const blockedEarly = deriveLadderState(
      base({
        explanation: blockedUnavailable([blocker("available")]),
        simulate: fakeSimulate(),
      }),
    );
    expect(blockedEarly.simulateReadyForDispatch).toBe(false);
  });
});
