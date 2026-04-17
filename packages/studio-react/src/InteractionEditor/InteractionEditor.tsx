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
  StudioDispatchResult,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";
import { ActionForm } from "./ActionForm.js";
import { BlockerList } from "./BlockerList.js";
import { SimulatePreview } from "./SimulatePreview.js";
import {
  defaultValueFor,
  descriptorForAction,
  type FormDescriptor,
} from "./field-descriptor.js";

export type InteractionEditorProps = {
  /**
   * Optional initial action name. If omitted, the first action in the
   * schema is selected.
   */
  readonly initialAction?: string;
};

/**
 * End-to-end form for building, previewing, and dispatching Intents
 * against the currently-built domain. Reads `module`, `snapshot`, and
 * `dispatch` / `simulate` / `createIntent` from `useStudio()`.
 */
export function InteractionEditor(_props: InteractionEditorProps = {}): JSX.Element {
  const { module, snapshot, simulate, dispatch, createIntent } = useStudio();

  const actionNames = useMemo(() => {
    if (module === null) return [] as readonly string[];
    return Object.keys(module.schema.actions).sort();
  }, [module]);

  const [selectedAction, setSelectedAction] = useState<string | null>(
    _props.initialAction ?? null,
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

  const [value, setValue] = useState<unknown>(() =>
    descriptor === null ? {} : defaultValueFor(descriptor),
  );
  // Reset form value when descriptor identity changes.
  useEffect(() => {
    setValue(descriptor === null ? {} : defaultValueFor(descriptor));
  }, [descriptor]);

  const [simulateResult, setSimulateResult] = useState<StudioSimulateResult | null>(null);
  const [dispatchResult, setDispatchResult] = useState<StudioDispatchResult | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pending, setPending] = useState<"simulate" | "dispatch" | null>(null);

  // Reset result panels when action changes.
  useEffect(() => {
    setSimulateResult(null);
    setDispatchResult(null);
    setRuntimeError(null);
  }, [selectedAction, module?.schema.hash]);

  const buildIntent = useCallback((): ReturnType<typeof createIntent> | null => {
    if (selectedAction === null) return null;
    try {
      // createIntent accepts `(action, ...args)`. For an object-shaped
      // input we pass the full value as a single arg.
      return createIntent(selectedAction, value);
    } catch (err) {
      setRuntimeError((err as Error).message);
      return null;
    }
  }, [createIntent, selectedAction, value]);

  const onSimulate = useCallback(() => {
    setRuntimeError(null);
    const intent = buildIntent();
    if (intent === null) return;
    setPending("simulate");
    try {
      const result = simulate(intent);
      setSimulateResult(result);
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      setPending(null);
    }
  }, [buildIntent, simulate]);

  const onDispatch = useCallback(async () => {
    setRuntimeError(null);
    const intent = buildIntent();
    if (intent === null) return;
    setPending("dispatch");
    try {
      const result = await dispatch(intent);
      setDispatchResult(result);
      // Re-run simulate so the preview matches post-dispatch state.
      try {
        const nextIntent = createIntent(selectedAction ?? "", value);
        if (selectedAction !== null) setSimulateResult(simulate(nextIntent));
      } catch {
        setSimulateResult(null);
      }
    } catch (err) {
      setRuntimeError((err as Error).message);
    } finally {
      setPending(null);
    }
  }, [buildIntent, createIntent, dispatch, selectedAction, simulate, value]);

  if (module === null) {
    return (
      <div style={emptyRootStyle}>
        <p style={emptyTextStyle}>
          Build the module to interact with its actions.
        </p>
      </div>
    );
  }

  const rejection = rejectedBlockers(dispatchResult);
  const failure = failureInfo(dispatchResult);

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
            actionNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))
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
            onChange={setValue}
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
          disabled={pending !== null || selectedAction === null}
          style={primaryBtnStyle}
        >
          {pending === "dispatch" ? "Dispatching…" : "Dispatch"}
        </button>
      </div>

      {runtimeError !== null ? (
        <div style={errorBoxStyle} role="alert">
          {runtimeError}
        </div>
      ) : null}

      {rejection !== null ? (
        <BlockerList
          blockers={rejection.blockers}
          reason={rejection.reason}
        />
      ) : null}

      {failure !== null ? (
        <div style={errorBoxStyle} role="alert">
          dispatch failed — {failure}
        </div>
      ) : null}

      {simulateResult !== null ? (
        <SimulatePreview result={simulateResult} beforeSnapshot={snapshot} />
      ) : null}

      {dispatchResult !== null && dispatchResult.kind === "completed" ? (
        <div style={successBoxStyle}>
          dispatched · {dispatchResult.outcome.projected.changedPaths.length} path
          {dispatchResult.outcome.projected.changedPaths.length === 1 ? "" : "s"} changed
          · {dispatchResult.traceIds.length} trace
          {dispatchResult.traceIds.length === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
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

function rejectedBlockers(
  result: StudioDispatchResult | null,
): { blockers: readonly DispatchBlocker[]; reason: string } | null {
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

function failureInfo(result: StudioDispatchResult | null): string | null {
  if (result === null || result.kind !== "failed") return null;
  return result.error.message;
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

const successBoxStyle: CSSProperties = {
  padding: "8px 10px",
  background: `${COLORS.preserved}15`,
  border: `1px solid ${COLORS.preserved}66`,
  borderRadius: 4,
  color: COLORS.preserved,
  fontSize: 11.5,
  fontFamily: MONO_STACK,
};
