import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { COLORS, FONT_STACK, MONO_STACK } from "../style-tokens.js";
import { useStudio } from "../useStudio.js";
import type {
  DispatchBlocker,
  IntentExplanation,
  StudioDispatchResult,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";
import { ActionForm } from "./ActionForm.js";
import { BlockerList } from "./BlockerList.js";
import { IntentLadder } from "./IntentLadder.js";
import { SimulatePreview } from "./SimulatePreview.js";
import { createIntentArgsForValue } from "./action-intent.js";
import {
  createInitialFormValue,
  descriptorForAction,
  type FormDescriptor,
} from "./field-descriptor.js";
import { deriveLadderState } from "./ladder-state.js";

export type InteractionEditorProps = {
  /**
   * Optional initial action name. If omitted, the first action in the
   * schema is selected.
   */
  readonly initialAction?: string;
  /**
   * Whether Dispatch is gated behind a resolved simulate for the
   * current bound intent (UX philosophy Rule S1).
   *
   * Defaults to `true` — this is the philosophical stance of the
   * Studio. Production callers should NOT override this. The override
   * exists as an escape hatch for regression tests that specifically
   * target code paths orthogonal to legality (e.g. sparse-optional
   * payload serialization) and predate Rule S1. Every override site
   * must be justified in `docs/studio/backlog.md`.
   */
  readonly enforceSimulateFirst?: boolean;
};

/**
 * End-to-end form for building, previewing, and dispatching Intents
 * against the currently-built domain. Reads `module`, `snapshot`, and
 * `dispatch` / `simulate` / `createIntent` from `useStudio()`.
 */
export function InteractionEditor(props: InteractionEditorProps = {}): JSX.Element {
  const enforceSimulateFirst = props.enforceSimulateFirst ?? true;
  const {
    core,
    module,
    snapshot,
    version,
    explainIntent,
    simulate,
    dispatch,
    createIntent,
    publishSimulationPlayback,
  } = useStudio();

  const actionNames = useMemo(() => {
    if (module === null) return [] as readonly string[];
    return Object.keys(module.schema.actions).sort();
  }, [module]);

  // Pillar 1 — Harness > Guardrail. Actions split into "available now"
  // vs "currently unavailable" based on the coarse `available when`
  // guard. The unavailable set isn't hidden (users still need to find
  // an action to understand why it's locked), but it's rendered in a
  // separate `<optgroup>` so the primary register is what the user
  // CAN do. `version` participates in the deps so the split re-runs
  // on snapshot changes.
  const actionSplits = useMemo(() => {
    const available: string[] = [];
    const unavailable: string[] = [];
    for (const name of actionNames) {
      if (core.isActionAvailable(name)) available.push(name);
      else unavailable.push(name);
    }
    return { available, unavailable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionNames, core, version]);

  const [selectedAction, setSelectedAction] = useState<string | null>(
    props.initialAction ?? null,
  );
  const [sessions, setSessions] = useState<Record<string, InteractionSession>>({});
  const [currentSession, setCurrentSession] = useState<InteractionSession>(() =>
    createInteractionSession({}),
  );

  // When actions list changes (module rebuild), ensure selection stays valid.
  useEffect(() => {
    if (actionNames.length === 0) {
      setSelectedAction(null);
      return;
    }
    setSelectedAction((prev) => {
      if (prev !== null && actionNames.includes(prev)) return prev;
      return actionNames[0];
    });
  }, [actionNames]);

  const descriptor: FormDescriptor | null = useMemo(() => {
    if (module === null || selectedAction === null) return null;
    return descriptorForAction(module.schema, selectedAction);
  }, [module, selectedAction]);

  const defaultSession = useMemo(
    () => createInteractionSession(
      descriptor === null
        ? {}
        : createInitialFormValue(descriptor, { sparseOptional: true }),
    ),
    [descriptor],
  );
  const sessionKey = useMemo(() => {
    if (module === null || selectedAction === null) return null;
    return `${module.schema.hash}:${selectedAction}`;
  }, [module, selectedAction]);
  const value = currentSession.value;
  const runtimeError = currentSession.runtimeError;
  const simulateResult = currentSession.lastSimulateResult;
  const dispatchResult = currentSession.lastDispatchResult;
  const explanation = currentSession.lastExplanation;
  const lastInteraction = currentSession.lastInteraction;
  const isStale =
    currentSession.lastInsightValueSignature !== null &&
    currentSession.valueSignature !== currentSession.lastInsightValueSignature;
  const hasCachedOutput =
    currentSession.lastExplanation !== null ||
    currentSession.lastSimulateResult !== null ||
    currentSession.lastDispatchResult !== null ||
    currentSession.runtimeError !== null;

  // Reset the whole in-memory session cache on schema changes.
  useEffect(() => {
    setSessions({});
  }, [module?.schema.hash]);

  useEffect(() => {
    if (sessionKey === null) {
      setCurrentSession(defaultSession);
      return;
    }
    setCurrentSession(sessions[sessionKey] ?? defaultSession);
  }, [defaultSession, sessionKey]);

  const [pending, setPending] = useState<"simulate" | "dispatch" | null>(null);

  useEffect(() => {
    if (sessionKey === null) return;
    setSessions((prev) => {
      if (prev[sessionKey] === currentSession) return prev;
      return { ...prev, [sessionKey]: currentSession };
    });
  }, [currentSession, sessionKey]);

  const updateActiveSession = useCallback(
    (updater: (prev: InteractionSession) => InteractionSession): void => {
      setCurrentSession((prev) => updater(prev));
    },
    [],
  );

  const onValueChange = useCallback(
    (next: unknown): void => {
      updateActiveSession((prev) => ({
        ...prev,
        value: next,
        valueSignature: stableSerialize(next),
        runtimeError: null,
      }));
    },
    [updateActiveSession],
  );

  const buildIntent = useCallback((): ReturnType<typeof createIntent> | null => {
    if (selectedAction === null) return null;
    try {
      return createIntent(
        selectedAction,
        ...createIntentArgsForValue(descriptor, value),
      );
    } catch (err) {
      updateActiveSession((prev) => ({
        ...prev,
        runtimeError: (err as Error).message,
      }));
      return null;
    }
  }, [createIntent, descriptor, selectedAction, updateActiveSession, value]);

  const onSimulate = useCallback(() => {
    const intent = buildIntent();
    if (intent === null) return;
    setPending("simulate");
    try {
      const explained = explainIntent(intent);
      if (explained.kind === "blocked") {
        updateActiveSession((prev) => ({
          ...prev,
          runtimeError: null,
          lastInteraction: "simulate",
          lastInsightValueSignature: prev.valueSignature,
          lastExplanation: explained,
        }));
        return;
      }
      const result = simulate(intent);
      if (result.diagnostics?.trace !== undefined) {
        publishSimulationPlayback({
          actionName: intent.type,
          trace: result.diagnostics.trace,
          source: "interaction-editor",
        });
      }
      updateActiveSession((prev) => ({
        ...prev,
        runtimeError: null,
        lastInteraction: "simulate",
        lastInsightValueSignature: prev.valueSignature,
        lastExplanation: explained,
        lastSimulateResult: result,
      }));
    } catch (err) {
      updateActiveSession((prev) => ({
        ...prev,
        runtimeError: (err as Error).message,
      }));
    } finally {
      setPending(null);
    }
  }, [
    buildIntent,
    explainIntent,
    publishSimulationPlayback,
    simulate,
    updateActiveSession,
  ]);

  const onDispatch = useCallback(async () => {
    const intent = buildIntent();
    if (intent === null) return;
    setPending("dispatch");
    try {
      const result = await dispatch(intent);
      updateActiveSession((prev) => ({
        ...prev,
        runtimeError: null,
        lastInteraction: "dispatch",
        lastInsightValueSignature: prev.valueSignature,
        lastExplanation: explanationFromDispatch(result) ?? prev.lastExplanation,
        lastDispatchResult: result,
      }));
    } catch (err) {
      updateActiveSession((prev) => ({
        ...prev,
        runtimeError: (err as Error).message,
      }));
    } finally {
      setPending(null);
    }
  }, [buildIntent, dispatch, updateActiveSession]);

  if (module === null) {
    return (
      <div style={emptyRootStyle}>
        <p style={emptyTextStyle}>
          Build the module to interact with its actions.
        </p>
      </div>
    );
  }

  const visibleExplanation =
    lastInteraction === "dispatch"
      ? explanationFromDispatch(dispatchResult)
      : explanation;
  const visibleDispatchResult = lastInteraction === "dispatch" ? dispatchResult : null;
  const visibleSimulateResult = lastInteraction === "simulate" ? simulateResult : null;
  const blockers = blockerInfo(lastInteraction, visibleExplanation, visibleDispatchResult);
  const failure = failureInfo(visibleDispatchResult);
  const showInsight =
    !isStale &&
    lastInteraction !== null &&
    (lastInteraction !== "dispatch" || visibleDispatchResult?.kind !== "failed") &&
    (visibleExplanation !== null || visibleSimulateResult !== null || visibleDispatchResult !== null);

  // --- Legality ladder state (UX philosophy §2.2, §2.3) ---------------
  // We derive the 5-step ladder from already-in-flight signals:
  // the last explanation, the last fresh simulate, and whether
  // buildIntent threw (→ input invalid for the SDK's schema). This is
  // a pure projection; see `ladder-state.ts` for semantics.
  //
  // `inputInvalid` is inferred from the presence of a buildIntent /
  // explainIntent runtime error that the SDK ordering guarantees only
  // fires AFTER availability passes (sdk.md §"Intent Explanation").
  // NOTE: do NOT wrap in useMemo — this block sits after an early
  // `return` for `module === null`. Any hook added here changes the
  // hook count across the null→non-null transition and trips Rules
  // of Hooks. `deriveLadderState` is a pure, branch-only projection,
  // so re-running it on every render is cheap.
  const ladderInputInvalid =
    runtimeError !== null && visibleExplanation === null && !isStale;
  const ladderState = deriveLadderState({
    explanation: visibleExplanation,
    simulate: visibleSimulateResult,
    inputInvalid: ladderInputInvalid,
    stale: isStale,
  });

  return (
    <div style={rootStyle}>
      <div style={headerStyle}>
        <label htmlFor="ie-action-select" style={labelStyle}>
          Action
        </label>
        <select
          id="ie-action-select"
          value={selectedAction ?? ""}
          onChange={(e) => setSelectedAction(e.currentTarget.value)}
          disabled={actionNames.length === 0}
          style={selectStyle}
        >
          {actionNames.length === 0 ? (
            <option value="">(no actions)</option>
          ) : (
            <>
              {actionSplits.available.length > 0 ? (
                <optgroup label="Available now">
                  {actionSplits.available.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {actionSplits.unavailable.length > 0 ? (
                <optgroup label="Currently unavailable">
                  {actionSplits.unavailable.map((name) => (
                    <option key={name} value={name}>
                      ∅ {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </>
          )}
        </select>
      </div>

      {selectedAction !== null ? (
        <ActionSignature
          schema={module.schema}
          actionName={selectedAction}
        />
      ) : null}

      <div style={formAreaStyle}>
        {descriptor === null ? (
          <div style={noInputStyle}>
            this action takes no input
          </div>
        ) : (
          <ActionForm
            descriptor={descriptor}
            value={value}
            onChange={onValueChange}
            disabled={pending !== null}
          />
        )}
      </div>

      <div style={buttonRowStyle}>
        <button
          type="button"
          onClick={onSimulate}
          disabled={pending !== null || selectedAction === null}
          style={secondaryBtnStyle}
        >
          {pending === "simulate" ? "Simulating…" : "Simulate"}
        </button>
        <button
          type="button"
          onClick={onDispatch}
          disabled={
            pending !== null ||
            selectedAction === null ||
            // Rule S1 (simulate-first): Dispatch is inert until a
            // fresh simulate has resolved for the current bound
            // intent. `simulateReadyForDispatch` goes true only when
            // all 5 legality steps passed AND the form value has not
            // drifted since simulate resolved. Production callers keep
            // `enforceSimulateFirst` at its default `true`; tests
            // covering unrelated paths may opt out.
            (enforceSimulateFirst && !ladderState.simulateReadyForDispatch)
          }
          title={
            enforceSimulateFirst && !ladderState.simulateReadyForDispatch
              ? "Simulate-first: run Simulate for the current inputs to unlock Dispatch (Rule S1)"
              : undefined
          }
          data-testid="ie-dispatch-btn"
          data-simulate-ready={ladderState.simulateReadyForDispatch ? "1" : "0"}
          style={primaryBtnStyle}
        >
          {pending === "dispatch" ? "Dispatching…" : "Dispatch"}
        </button>
      </div>

      {runtimeError !== null && !isStale ? (
        <div style={errorBoxStyle} role="alert">
          {runtimeError}
        </div>
      ) : null}

      {isStale && hasCachedOutput ? (
        <div style={staleBoxStyle} data-testid="interaction-stale">
          input changed — rerun simulate/dispatch
        </div>
      ) : null}

      {/* Legality ladder — visible whenever the ladder carries
       * actionable information. We show it when:
       *  - a simulate has resolved (either blocked or admitted), or
       *  - a dispatch was rejected (blockers surface via the same
       *    ladder shape).
       * A *completed* dispatch is a post-hoc success narrative; the
       * ladder has no failing step to surface, so we defer to
       * SimulatePreview's "dispatch completed" view.
       * See UX philosophy Pillar 3 (sadari first). */}
      {!isStale &&
      (lastInteraction === "simulate" ||
        (lastInteraction === "dispatch" &&
          visibleDispatchResult?.kind === "rejected")) ? (
        <IntentLadder state={ladderState} />
      ) : null}

      {showInsight ? (
        <SimulatePreview
          beforeSnapshot={snapshot}
          explanation={visibleExplanation}
          result={visibleSimulateResult}
          dispatchResult={visibleDispatchResult}
          stale={isStale}
        />
      ) : null}

      {blockers !== null && !isStale ? (
        <BlockerList
          blockers={blockers.blockers}
          reason={blockers.reason}
        />
      ) : null}

      {failure !== null && !isStale ? (
        <div style={errorBoxStyle} role="alert">
          dispatch failed — {failure}
        </div>
      ) : null}
    </div>
  );
}

type InteractionSession = {
  readonly value: unknown;
  readonly valueSignature: string;
  readonly lastInsightValueSignature: string | null;
  readonly lastExplanation: IntentExplanation | null;
  readonly lastSimulateResult: StudioSimulateResult | null;
  readonly lastDispatchResult: StudioDispatchResult | null;
  readonly runtimeError: string | null;
  readonly lastInteraction: "simulate" | "dispatch" | null;
};

function createInteractionSession(defaultValue: unknown): InteractionSession {
  return {
    value: defaultValue,
    valueSignature: stableSerialize(defaultValue),
    lastInsightValueSignature: null,
    lastExplanation: null,
    lastSimulateResult: null,
    lastDispatchResult: null,
    runtimeError: null,
    lastInteraction: null,
  };
}

function ActionSignature({
  schema,
  actionName,
}: {
  readonly schema: NonNullable<ReturnType<typeof useStudio>["module"]>["schema"];
  readonly actionName: string;
}): JSX.Element | null {
  const action = schema.actions[actionName];
  if (action === undefined) return null;
  return (
    <div style={signatureStyle}>
      <code style={{ fontFamily: MONO_STACK, fontSize: 11, color: COLORS.textDim }}>
        {actionName}
      </code>
      {action.description !== undefined ? (
        <span style={{ color: COLORS.muted, fontSize: 11 }}>{action.description}</span>
      ) : null}
      {action.dispatchable !== undefined ? (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: 0.8,
            padding: "2px 6px",
            borderRadius: 3,
            background: `${COLORS.warn}22`,
            color: COLORS.warn,
            textTransform: "uppercase",
          }}
        >
          gated
        </span>
      ) : null}
    </div>
  );
}

function blockerInfo(
  lastInteraction: InteractionSession["lastInteraction"],
  explanation: IntentExplanation | null,
  result: StudioDispatchResult | null,
): { blockers: readonly DispatchBlocker[]; reason: string } | null {
  if (lastInteraction === "simulate" && explanation?.kind === "blocked") {
    return {
      blockers: explanation.blockers,
      reason: explanation.available
        ? "simulate skipped — intent not dispatchable"
        : "simulate skipped — action unavailable",
    };
  }
  if (result === null || result.kind !== "rejected") return null;
  const failure = result.admission.failure;
  if (failure.kind === "unavailable" || failure.kind === "not_dispatchable") {
    return {
      blockers: failure.blockers,
      reason: `${result.rejection.code.toLowerCase().replace(/_/g, " ")} — ${result.rejection.reason}`,
    };
  }
  return {
    blockers: [],
    reason: `${result.rejection.code.toLowerCase().replace(/_/g, " ")} — ${result.rejection.reason}`,
  };
}

function explanationFromDispatch(
  result: StudioDispatchResult | null,
): IntentExplanation | null {
  if (result === null || result.kind !== "rejected") return null;
  const failure = result.admission.failure;
  if (failure.kind === "unavailable") {
    return {
      kind: "blocked",
      actionName: result.admission.actionName,
      available: false,
      dispatchable: false,
      blockers: failure.blockers,
    };
  }
  if (failure.kind === "not_dispatchable") {
    return {
      kind: "blocked",
      actionName: result.admission.actionName,
      available: true,
      dispatchable: false,
      blockers: failure.blockers,
    };
  }
  return null;
}

function failureInfo(result: StudioDispatchResult | null): string | null {
  if (result === null || result.kind !== "failed") return null;
  return result.error.message;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortForSignature(value)) ?? "null";
}

function sortForSignature(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForSignature);
  }
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input)
        .sort()
        .map((key) => [key, sortForSignature(input[key])]),
    );
  }
  return value;
}

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  fontFamily: FONT_STACK,
  color: COLORS.text,
  overflow: "auto",
  minHeight: 0,
  flex: 1,
};

const emptyRootStyle: CSSProperties = {
  padding: 16,
  color: COLORS.muted,
  fontSize: 12,
  fontStyle: "italic",
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: COLORS.muted,
};

const selectStyle: CSSProperties = {
  flex: 1,
  background: COLORS.bg,
  color: COLORS.text,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
  fontFamily: FONT_STACK,
};

const signatureStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const formAreaStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const noInputStyle: CSSProperties = {
  fontSize: 11,
  color: COLORS.muted,
  fontStyle: "italic",
  padding: "8px 10px",
  background: COLORS.panelAlt,
  border: `1px dashed ${COLORS.line}`,
  borderRadius: 4,
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 6,
};

const primaryBtnStyle: CSSProperties = {
  background: COLORS.accent,
  color: "#0B1020",
  border: "none",
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  borderRadius: 4,
  fontFamily: FONT_STACK,
};

const secondaryBtnStyle: CSSProperties = {
  background: COLORS.surface,
  color: COLORS.text,
  border: `1px solid ${COLORS.line}`,
  padding: "6px 14px",
  fontSize: 12,
  cursor: "pointer",
  borderRadius: 4,
  fontFamily: FONT_STACK,
};

const errorBoxStyle: CSSProperties = {
  padding: "8px 10px",
  background: `${COLORS.err}15`,
  border: `1px solid ${COLORS.err}66`,
  borderRadius: 4,
  color: COLORS.err,
  fontSize: 11.5,
  fontFamily: MONO_STACK,
};

const staleBoxStyle: CSSProperties = {
  padding: "8px 10px",
  background: `${COLORS.warn}15`,
  border: `1px solid ${COLORS.warn}66`,
  borderRadius: 4,
  color: COLORS.warn,
  fontSize: 11.5,
  fontFamily: MONO_STACK,
};
