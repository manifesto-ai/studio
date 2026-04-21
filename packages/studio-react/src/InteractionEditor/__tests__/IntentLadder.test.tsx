/**
 * Rendering tests for IntentLadder across the three ladder states:
 *   - blocked-here (coarse)       — step 1 fails
 *   - blocked-here (dispatchable) — step 3 fails
 *   - admitted + simulated fresh  — all pass
 *
 * Rules under test:
 *   L1 — blockers never mixed across layers.
 *   L2 — available failure narrative distinct from dispatchable.
 *   Rule: downstream layers stay visible but demoted (not hidden).
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntentLadder } from "../IntentLadder.js";
import { deriveLadderState } from "../ladder-state.js";
import type { IntentExplanation, DispatchBlocker } from "@manifesto-ai/studio-core";

function mount(el: JSX.Element): { container: HTMLDivElement; root: Root; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function blocker(layer: "available" | "dispatchable", ref: string, value: unknown): DispatchBlocker {
  return {
    layer,
    expression: { kind: "call", op: "eq", args: [{ kind: "ref", ref }, { kind: "literal", value }] } as unknown as DispatchBlocker["expression"],
    evaluatedResult: false,
    description: `expected ${ref} to be ${JSON.stringify(value)}`,
  };
}

function blockedUnavailable(): IntentExplanation {
  return {
    kind: "blocked",
    actionName: "shoot",
    available: false,
    dispatchable: false,
    blockers: [blocker("available", "phase", "playing")],
  };
}

function blockedDispatchable(): IntentExplanation {
  return {
    kind: "blocked",
    actionName: "shoot",
    available: true,
    dispatchable: false,
    blockers: [blocker("dispatchable", "cellStatus", "unknown")],
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
    canonicalSnapshot: {},
    snapshot: {},
    newAvailableActions: [],
    changedPaths: ["data.todos[0]"],
  } as unknown as IntentExplanation;
}

describe("IntentLadder — blocked at available (step 1)", () => {
  it("step 1 renders blocked-here, steps 2-5 render demoted not-yet-evaluated (Rule L1 — downstream demoted, not hidden)", () => {
    const state = deriveLadderState({
      explanation: blockedUnavailable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);

    // Step 1: blocked.
    const step1 = container.querySelector('[data-testid="ladder-step-available"]') as HTMLElement;
    expect(step1).not.toBeNull();
    expect(step1.dataset.status).toBe("blocked-here");

    // Steps 2..5: visible, but demoted.
    for (const id of ["input-valid", "dispatchable", "simulated", "admitted"]) {
      const el = container.querySelector(`[data-testid="ladder-step-${id}"]`) as HTMLElement;
      expect(el, `step ${id} must be visible (not hidden)`).not.toBeNull();
      expect(el.dataset.status).toBe("not-yet-evaluated");
    }

    cleanup();
  });

  it("step 1 narrative frames as 'not present in action surface', not 'disabled' (Rule L2)", () => {
    const state = deriveLadderState({
      explanation: blockedUnavailable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    const step1 = container.querySelector('[data-testid="ladder-step-available"]');
    const text = step1?.textContent ?? "";
    expect(text).toMatch(/호출 가능한 표면/);
    expect(text).not.toMatch(/비활성|disabled/i);
    cleanup();
  });

  it("blockers rendered at step 1 only — downstream layers must not echo them (Rule L1)", () => {
    const state = deriveLadderState({
      explanation: blockedUnavailable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    expect(
      container.querySelector('[data-testid="ladder-blockers-available"]'),
    ).not.toBeNull();
    // No blocker list attached to other steps.
    expect(container.querySelector('[data-testid="ladder-blockers-dispatchable"]')).toBeNull();
    expect(container.querySelector('[data-testid="ladder-blockers-input-valid"]')).toBeNull();
    cleanup();
  });
});

describe("IntentLadder — blocked at dispatchable (step 3)", () => {
  it("steps 1-2 passed, step 3 blocked-here, steps 4-5 demoted", () => {
    const state = deriveLadderState({
      explanation: blockedDispatchable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    expect(
      (container.querySelector('[data-testid="ladder-step-available"]') as HTMLElement).dataset.status,
    ).toBe("passed");
    expect(
      (container.querySelector('[data-testid="ladder-step-input-valid"]') as HTMLElement).dataset.status,
    ).toBe("passed");
    expect(
      (container.querySelector('[data-testid="ladder-step-dispatchable"]') as HTMLElement).dataset.status,
    ).toBe("blocked-here");
    expect(
      (container.querySelector('[data-testid="ladder-step-simulated"]') as HTMLElement).dataset.status,
    ).toBe("not-yet-evaluated");
    expect(
      (container.querySelector('[data-testid="ladder-step-admitted"]') as HTMLElement).dataset.status,
    ).toBe("not-yet-evaluated");
    cleanup();
  });

  it("dispatchable narrative distinguishes 'this specific intent' from action availability (Rule L2)", () => {
    const state = deriveLadderState({
      explanation: blockedDispatchable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    const text = container.querySelector('[data-testid="ladder-step-dispatchable"]')?.textContent ?? "";
    expect(text).toMatch(/특정 intent|다른 입력/);
    cleanup();
  });

  it("renders a static counterfactual hint when the guard AST is decodable (Rule P1)", () => {
    const state = deriveLadderState({
      explanation: blockedDispatchable(),
      simulate: null,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    const hint = container.querySelector('[data-testid="ladder-hint-dispatchable"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toMatch(/cellStatus/);
    expect(hint?.textContent ?? "").toMatch(/통과합니다/);
    cleanup();
  });
});

describe("IntentLadder — all steps passed (admitted + simulate fresh)", () => {
  it("all five steps render as passed", () => {
    const state = deriveLadderState({
      explanation: admitted(),
      simulate: { changedPaths: [], requirements: [], status: "idle" } as never,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    for (const id of ["available", "input-valid", "dispatchable", "simulated", "admitted"]) {
      expect(
        (container.querySelector(`[data-testid="ladder-step-${id}"]`) as HTMLElement).dataset.status,
        `step ${id} should be passed`,
      ).toBe("passed");
    }
    cleanup();
  });

  it("no blocker blocks or hints are rendered when all passed", () => {
    const state = deriveLadderState({
      explanation: admitted(),
      simulate: { changedPaths: [], requirements: [], status: "idle" } as never,
      inputInvalid: false,
      stale: false,
    });
    const { container, cleanup } = mount(<IntentLadder state={state} />);
    expect(container.querySelectorAll('[data-testid^="ladder-blockers-"]').length).toBe(0);
    expect(container.querySelectorAll('[data-testid^="ladder-hint-"]').length).toBe(0);
    cleanup();
  });
});
