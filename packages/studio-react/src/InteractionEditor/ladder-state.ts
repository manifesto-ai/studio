/**
 * Legality ladder state derivation.
 *
 * SDK §"Intent Explanation" mandates the legality ladder:
 *
 *   1. coarse availability       (`available when`)
 *   2. input validation          (SDK rejects with `INVALID_INPUT`)
 *   3. dispatchability           (`dispatchable when`)
 *   4. dry-run simulation        (`simulate()`)
 *   5. admitted outcome          (terminal snapshot + changed paths)
 *
 * `deriveLadderState()` projects the current `IntentExplanation`,
 * `StudioSimulateResult`, build-time input error, and simulate-result
 * freshness onto the 5-step ladder. It is a pure function — no DOM, no
 * SDK calls — so it is the only place the ladder's semantics live and
 * the only place we need to cover with unit tests.
 *
 * Downstream layers are never hidden when an earlier layer fails — they
 * become `not-yet-evaluated` so the user still learns *what would have
 * been checked next*. See UX philosophy Rules L1, L2, S1.
 */
import type {
  DispatchBlocker,
  IntentExplanation,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";

export type LadderStepId =
  | "available"
  | "input-valid"
  | "dispatchable"
  | "simulated"
  | "admitted";

export type LadderStepStatus =
  | "passed"
  | "blocked-here"
  | "not-yet-evaluated";

export type LadderStep = {
  readonly id: LadderStepId;
  readonly ordinal: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
  readonly status: LadderStepStatus;
  /**
   * Blockers that belong to THIS step only. Never merged across steps
   * (Rule L1). `undefined` means no blockers are relevant at this step.
   */
  readonly blockers?: readonly DispatchBlocker[];
  /**
   * Plain-prose framing for the blocked-here case. Distinguishes
   * `available` ("not present in the action surface") from
   * `dispatchable` ("this specific intent is rejected") (Rule L2).
   */
  readonly narrative?: string;
};

export type LadderState = {
  readonly steps: readonly [LadderStep, LadderStep, LadderStep, LadderStep, LadderStep];
  /**
   * Index of the first `blocked-here` step, or `null` if the ladder is
   * fully passed or waiting on a later step.
   */
  readonly blockedAt: LadderStepId | null;
  /**
   * True iff step 4 (simulated) is `passed` AND the simulate result's
   * signature matches the current input signature — the Rule S1 gate
   * for the Dispatch button.
   */
  readonly simulateReadyForDispatch: boolean;
};

export type LadderInputs = {
  /**
   * The last `explainIntent()` result, or `null` when no interaction
   * has happened yet. `null` collapses the ladder to all
   * `not-yet-evaluated`.
   */
  readonly explanation: IntentExplanation | null;
  /**
   * The last `simulate()` result for the SAME bound intent as
   * `explanation`. `null` means no simulate has resolved yet.
   */
  readonly simulate: StudioSimulateResult | null;
  /**
   * True iff `buildIntent()` threw an `INVALID_INPUT` error for the
   * current form value. When true, we know step 1 must have passed
   * (otherwise the SDK would have returned `available: false` before
   * input validation ran — sdk.md §"Intent Explanation": "If the
   * action is unavailable, these reads return the unavailable blocked
   * result and do not surface invalid-input failures hidden behind
   * that unavailable action.")
   */
  readonly inputInvalid: boolean;
  /**
   * Current form-value signature. Must match
   * `insightValueSignature` for the cached explanation/simulate to
   * still apply. If it drifts, the whole ladder is stale (Rule S2)
   * and we demote step 4 back to `not-yet-evaluated`.
   */
  readonly stale: boolean;
};

const STEP_LABELS: Record<LadderStepId, string> = {
  available: "Available",
  "input-valid": "Input valid",
  dispatchable: "Dispatchable",
  simulated: "Simulated",
  admitted: "Admitted",
};

const STEP_ORDER: readonly LadderStepId[] = [
  "available",
  "input-valid",
  "dispatchable",
  "simulated",
  "admitted",
];

function ordinalOf(id: LadderStepId): 1 | 2 | 3 | 4 | 5 {
  const i = STEP_ORDER.indexOf(id);
  return (i + 1) as 1 | 2 | 3 | 4 | 5;
}

function pending(id: LadderStepId): LadderStep {
  return {
    id,
    ordinal: ordinalOf(id),
    label: STEP_LABELS[id],
    status: "not-yet-evaluated",
  };
}

function passed(id: LadderStepId): LadderStep {
  return {
    id,
    ordinal: ordinalOf(id),
    label: STEP_LABELS[id],
    status: "passed",
  };
}

/**
 * Compute the 5-step ladder state from the already-available SDK
 * signals. Pure — no SDK calls, no side effects.
 */
export function deriveLadderState(inputs: LadderInputs): LadderState {
  const { explanation, simulate, inputInvalid, stale } = inputs;

  // Empty canvas: nothing interacted with yet.
  if (explanation === null && !inputInvalid) {
    const steps = STEP_ORDER.map(pending) as unknown as LadderState["steps"];
    return {
      steps,
      blockedAt: null,
      simulateReadyForDispatch: false,
    };
  }

  // Step 1: coarse availability.
  // If the SDK returned `blocked, available: false`, this step is blocked-here.
  if (explanation !== null && explanation.kind === "blocked" && !explanation.available) {
    const step1: LadderStep = {
      id: "available",
      ordinal: 1,
      label: STEP_LABELS.available,
      status: "blocked-here",
      blockers: explanation.blockers,
      narrative:
        "이 액션은 지금 호출 가능한 표면에 존재하지 않습니다. 아래 가드 조건이 만족되는 상태가 되어야 표면에 나타납니다.",
    };
    const steps = [
      step1,
      pending("input-valid"),
      pending("dispatchable"),
      pending("simulated"),
      pending("admitted"),
    ] as const satisfies LadderState["steps"];
    return { steps, blockedAt: "available", simulateReadyForDispatch: false };
  }

  // Step 1 passed: the action is available.
  const step1 = passed("available");

  // Step 2: input validation.
  // The SDK throws INVALID_INPUT only AFTER availability passes. So if
  // `inputInvalid` is true here, step 1 necessarily passed.
  if (inputInvalid) {
    const step2: LadderStep = {
      id: "input-valid",
      ordinal: 2,
      label: STEP_LABELS["input-valid"],
      status: "blocked-here",
      narrative:
        "입력이 액션 파라미터 스키마를 만족하지 않습니다. Dispatchable 여부는 입력이 유효해진 후에만 평가됩니다.",
    };
    const steps = [
      step1,
      step2,
      pending("dispatchable"),
      pending("simulated"),
      pending("admitted"),
    ] as const satisfies LadderState["steps"];
    return { steps, blockedAt: "input-valid", simulateReadyForDispatch: false };
  }

  // Step 2 passed.
  const step2 = passed("input-valid");

  // Step 3: dispatchability.
  if (
    explanation !== null &&
    explanation.kind === "blocked" &&
    explanation.available &&
    !explanation.dispatchable
  ) {
    const step3: LadderStep = {
      id: "dispatchable",
      ordinal: 3,
      label: STEP_LABELS.dispatchable,
      status: "blocked-here",
      blockers: explanation.blockers,
      narrative:
        "이 특정 intent가 거절됩니다. 동일 액션은 다른 입력으로 여전히 호출 가능합니다.",
    };
    const steps = [
      step1,
      step2,
      step3,
      pending("simulated"),
      pending("admitted"),
    ] as const satisfies LadderState["steps"];
    return { steps, blockedAt: "dispatchable", simulateReadyForDispatch: false };
  }

  // If explanation is null but we made it here, we don't yet know about
  // dispatchability or admission. Keep step 3+ pending.
  if (explanation === null) {
    const steps = [
      step1,
      step2,
      pending("dispatchable"),
      pending("simulated"),
      pending("admitted"),
    ] as const satisfies LadderState["steps"];
    return { steps, blockedAt: null, simulateReadyForDispatch: false };
  }

  // Step 3 passed: explanation.kind === "admitted".
  const step3 = passed("dispatchable");

  // Step 4: simulated dry-run.
  const simulateFresh = simulate !== null && !stale;
  if (!simulateFresh) {
    const steps = [
      step1,
      step2,
      step3,
      pending("simulated"),
      pending("admitted"),
    ] as const satisfies LadderState["steps"];
    return { steps, blockedAt: null, simulateReadyForDispatch: false };
  }

  const step4 = passed("simulated");

  // Step 5: admitted outcome (the projected snapshot + changedPaths +
  // requirements already live in `explanation` when kind === "admitted").
  const step5: LadderStep = {
    id: "admitted",
    ordinal: 5,
    label: STEP_LABELS.admitted,
    status: "passed",
  };

  return {
    steps: [step1, step2, step3, step4, step5],
    blockedAt: null,
    simulateReadyForDispatch: true,
  };
}
