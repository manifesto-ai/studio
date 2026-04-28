/**
 * AgentSessionRuntime — third Manifesto runtime mounted at app root,
 * alongside the user's domain core and StudioUiRuntime. Owns the
 * agent's conversation lifecycle as MEL state + lineage (see
 * `./agent-session.mel`).
 *
 * Why a third runtime?
 * ---
 * Until now the chat lifecycle was owned by the AI SDK's `useChat`
 * — messages, tool-call loop, settlement — none of which was visible
 * to Manifesto's lineage. By moving turn state into MEL we get:
 *   - Each decision moment (user prompt, model invocation, tool
 *     call/result, settled response) is a dispatch and a world.
 *   - dispatchable when guards reject illegal sequences at the
 *     runtime boundary instead of in host code.
 *   - Lineage scrub / replay applies to agent reasoning the same
 *     way it applies to user-domain state.
 *   - Models-as-effects: each model invocation is recorded with a
 *     tier; effect handlers route to the appropriate inference path.
 *
 * Step 1 status: this provider mounts the runtime so it is alive
 * and inspectable, but does NOT yet replace `useChat` in AgentLens.
 * The next migration step adds shadow recording: when the user
 * submits a message, the host dispatches the same sequence into
 * AgentSession in parallel with the SDK loop. Once shadow runs
 * cleanly, AgentLens swaps its source of truth onto this runtime.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createStudioCore,
  type Intent,
  type StudioCore,
  type StudioDispatchResult,
  type Snapshot,
} from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import agentSessionMelSource from "./agent-session.mel?raw";
import type {
  AgentSessionSnapshot,
  ModelTier,
  SessionPhase,
  ToolOutcome,
} from "@/agent/session/agent-session-types";

export type {
  AgentSessionSnapshot,
  ModelTier,
  SessionPhase,
  ToolOutcome,
} from "@/agent/session/agent-session-types";

const EMPTY_SNAPSHOT: AgentSessionSnapshot = {
  phase: "idle",
  currentTurnId: null,
  lastUserText: null,
  pendingToolCallId: null,
  pendingToolName: null,
  lastToolCallId: null,
  lastToolName: null,
  lastToolOutcome: null,
  lastResponseFinal: null,
  lastModelError: null,
  budgetUsedMc: 0,
  budgetCeilingMc: 0,
  lastAnchorFromWorldId: null,
  lastAnchorToWorldId: null,
  lastAnchorSummary: null,
  turnCount: 0,
  toolCallCount: 0,
  modelInvocationCount: 0,
  idle: true,
  awaitingUser: false,
  canStartTurn: true,
  isProcessing: false,
  budgetExhausted: false,
  canInvokeModel: true,
};

type AgentSessionContextValue = {
  readonly snapshot: AgentSessionSnapshot;
  readonly ready: boolean;
  readonly core: StudioCore | null;
  // Typed helpers — same convenience layer as StudioUiRuntime.
  readonly recordUserTurn: (turnId: string, text: string) => void;
  readonly recordModelInvocation: (
    invocationId: string,
    tier: ModelTier,
  ) => void;
  readonly recordToolCall: (callId: string, toolName: string) => void;
  readonly recordToolResult: (callId: string, outcome: ToolOutcome) => void;
  readonly recordAssistantSettled: (finalText: string) => void;
  readonly recordModelInvocationFailed: (reason: string) => void;
  readonly recordSessionStop: () => void;
  readonly recordBudget: (deltaMc: number) => void;
  readonly setBudgetCeiling: (ceilingMc: number) => void;
  readonly anchorWindow: (
    fromWorldId: string,
    toWorldId: string,
    summary: string,
  ) => void;
  readonly resetSession: () => void;
  // Low-level seam for tests / programmatic callers.
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
};

const AgentSessionContext = createContext<AgentSessionContextValue | null>(null);
AgentSessionContext.displayName = "AgentSessionContext";

export function AgentSessionProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  const [core, setCore] = useState<StudioCore | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const instance = createStudioCore();
    const adapter = createHeadlessAdapter({
      initialSource: agentSessionMelSource,
    });
    const detach = instance.attach(adapter);
    void instance
      .build()
      .then((result) => {
        if (cancelled) return;
        if (result.kind !== "ok") {
          console.error(
            "[AgentSessionRuntime] agent-session.mel failed to build:",
            result.errors,
          );
          return;
        }
        setCore(instance);
      })
      .catch((err) => {
        console.error("[AgentSessionRuntime] build threw:", err);
      });
    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  const subscribersRef = useRef(new Set<() => void>());
  const subscribe = useMemo(
    () => (listener: () => void) => {
      subscribersRef.current.add(listener);
      return () => {
        subscribersRef.current.delete(listener);
      };
    },
    [],
  );
  const getVersion = useMemo(() => () => version, [version]);
  useSyncExternalStore(subscribe, getVersion, getVersion);

  const snapshot = useMemo<AgentSessionSnapshot>(() => {
    if (core === null) return EMPTY_SNAPSHOT;
    return readSnapshot(core);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, version]);

  useEffect(() => {
    if (core === null) return;
    const detach = core.subscribeAfterDispatch((result) => {
      if (result.kind !== "completed") return;
      setVersion((v) => v + 1);
      for (const l of subscribersRef.current) l();
    });
    return detach;
  }, [core]);

  const dispatchIntent = useCallback(
    async (intent: Intent): Promise<StudioDispatchResult> => {
      if (core === null) {
        throw new Error(
          "[AgentSessionRuntime] dispatchAsync called before runtime ready",
        );
      }
      return core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      );
    },
    [core],
  );

  const createIntentFn = useCallback(
    (action: string, ...args: unknown[]): Intent => {
      if (core === null) {
        throw new Error(
          "[AgentSessionRuntime] createIntent called before runtime ready",
        );
      }
      return core.createIntent(action, ...args);
    },
    [core],
  );

  const dispatch = useMemo(
    () => (actionName: string, args: readonly unknown[]) => {
      if (core === null) return;
      try {
        const intent = core.createIntent(actionName, ...args);
        void dispatchIntent(intent);
      } catch (err) {
        console.error(
          `[AgentSessionRuntime] createIntent("${actionName}") threw:`,
          err,
        );
      }
    },
    [core, dispatchIntent],
  );

  const value = useMemo<AgentSessionContextValue>(
    () => ({
      snapshot,
      ready: core !== null,
      core,
      recordUserTurn: (turnId, text) =>
        dispatch("recordUserTurn", [turnId, text]),
      recordModelInvocation: (invocationId, tier) =>
        dispatch("recordModelInvocation", [invocationId, tier]),
      recordToolCall: (callId, toolName) =>
        dispatch("recordToolCall", [callId, toolName]),
      recordToolResult: (callId, outcome) =>
        dispatch("recordToolResult", [callId, outcome]),
      recordAssistantSettled: (finalText) =>
        dispatch("recordAssistantSettled", [finalText]),
      recordModelInvocationFailed: (reason) =>
        dispatch("recordModelInvocationFailed", [reason]),
      recordSessionStop: () => dispatch("recordSessionStop", []),
      recordBudget: (deltaMc) => dispatch("recordBudget", [deltaMc]),
      setBudgetCeiling: (ceilingMc) =>
        dispatch("setBudgetCeiling", [ceilingMc]),
      anchorWindow: (fromWorldId, toWorldId, summary) =>
        dispatch("anchorWindow", [fromWorldId, toWorldId, summary]),
      resetSession: () => dispatch("resetSession", []),
      createIntent: createIntentFn,
      dispatchAsync: dispatchIntent,
    }),
    [snapshot, core, dispatch, createIntentFn, dispatchIntent],
  );

  return (
    <AgentSessionContext.Provider value={value}>
      {children}
    </AgentSessionContext.Provider>
  );
}

export function useAgentSession(): AgentSessionContextValue {
  const ctx = useContext(AgentSessionContext);
  if (ctx === null) {
    throw new Error(
      "useAgentSession must be used inside <AgentSessionProvider>",
    );
  }
  return ctx;
}

export { EMPTY_SNAPSHOT as EMPTY_AGENT_SESSION_SNAPSHOT };

/**
 * Read a fresh AgentSession snapshot directly from the core. Use this
 * instead of `useAgentSession().snapshot` whenever you're inside a
 * subscribeAfterDispatch listener or the driver — the React-mediated
 * snapshot is stale until the next render, which races with dispatch
 * notifications. Calling core.getSnapshot() inline returns the
 * just-settled state.
 */
export function readAgentSessionSnapshot(
  core: StudioCore | null,
): AgentSessionSnapshot {
  if (core === null) return EMPTY_SNAPSHOT;
  return readSnapshot(core);
}

function readSnapshot(core: StudioCore): AgentSessionSnapshot {
  const raw = core.getSnapshot();
  if (raw === null) return EMPTY_SNAPSHOT;
  const data = (raw as Snapshot<Record<string, unknown>>).data ?? {};
  const computed =
    ((raw as { readonly computed?: Record<string, unknown> }).computed) ?? {};
  return {
    phase: asPhase(data.phase) ?? "idle",
    currentTurnId: asStringOrNull(data.currentTurnId),
    lastUserText: asStringOrNull(data.lastUserText),
    pendingToolCallId: asStringOrNull(data.pendingToolCallId),
    pendingToolName: asStringOrNull(data.pendingToolName),
    lastToolCallId: asStringOrNull(data.lastToolCallId),
    lastToolName: asStringOrNull(data.lastToolName),
    lastToolOutcome: asOutcome(data.lastToolOutcome),
    lastResponseFinal: asStringOrNull(data.lastResponseFinal),
    lastModelError: asStringOrNull(data.lastModelError),
    budgetUsedMc: asNumber(data.budgetUsedMc, 0),
    budgetCeilingMc: asNumber(data.budgetCeilingMc, 0),
    lastAnchorFromWorldId: asStringOrNull(data.lastAnchorFromWorldId),
    lastAnchorToWorldId: asStringOrNull(data.lastAnchorToWorldId),
    lastAnchorSummary: asStringOrNull(data.lastAnchorSummary),
    turnCount: asNumber(data.turnCount, 0),
    toolCallCount: asNumber(data.toolCallCount, 0),
    modelInvocationCount: asNumber(data.modelInvocationCount, 0),
    idle: computed.idle !== false,
    awaitingUser: Boolean(computed.awaitingUser),
    canStartTurn: computed.canStartTurn !== false,
    isProcessing: Boolean(computed.isProcessing),
    budgetExhausted: Boolean(computed.budgetExhausted),
    canInvokeModel: computed.canInvokeModel !== false,
  };
}

// --- narrow parsers --------------------------------------------------

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asPhase(v: unknown): SessionPhase | null {
  return v === "idle" ||
    v === "awaitingModel" ||
    v === "streaming" ||
    v === "awaitingTool" ||
    v === "settled" ||
    v === "stopped"
    ? v
    : null;
}

function asOutcome(v: unknown): ToolOutcome | null {
  return v === "ok" || v === "blocked" || v === "error" ? v : null;
}
