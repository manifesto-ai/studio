/**
 * StudioUiRuntime — the second Manifesto runtime that owns the
 * Studio's UI contract (see `./studio.mel`). Mounted at app root,
 * beside the user's own MEL runtime.
 *
 * Why a second runtime instead of mirroring UI state into React?
 * ---
 * The agent needs a single, legibly-queryable source of semantic UI
 * state (focused node, active lens, view mode). Mirroring React
 * state into a side-channel produces state hell the moment new UI
 * features land. Using Manifesto itself for the UI contract means:
 *   1. Legality gates enforce mutual exclusions (e.g. can't scrub
 *      while simulating) at the runtime boundary.
 *   2. The agent reads / writes this runtime via the exact same
 *      dispatch + snapshot surface as the user's domain.
 *   3. New UI semantic state = one more field + action in
 *      studio.mel; no prompt-builder or context-reader changes.
 *
 * This runtime has no Monaco editor — the source is bundled via
 * `?raw` and fed once at boot through the headless adapter. If the
 * bundled MEL ever fails to compile that's a build-time bug, not a
 * runtime error, so we surface it to the console and fail loud.
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
import studioMelSource from "./studio.mel?raw";

/**
 * Read model — the fields we pull out of the runtime snapshot for
 * React consumers. We keep this type explicit (not
 * `Snapshot<unknown>`) so TS catches field-name drift when
 * `studio.mel` changes.
 */
export type StudioUiSnapshot = {
  readonly focusedNodeId: string | null;
  readonly focusedNodeKind: "action" | "state" | "computed" | null;
  readonly focusedNodeOrigin:
    | "graph"
    | "source"
    | "diagnostic"
    | "interact"
    | "agent"
    | null;
  readonly activeLens:
    | "interact"
    | "snapshot"
    | "plan"
    | "history"
    | "diagnostics"
    | "agent";
  readonly viewMode: "live" | "simulate" | "scrub";
  readonly simulationActionName: string | null;
  readonly scrubEnvelopeId: string | null;
  readonly activeProjectName: string | null;
  /** Last finalized user/agent turn. Stored single-entry — full
   *  transcript is a React concern. See studio.mel recordAgentTurn. */
  readonly lastUserPrompt: string | null;
  readonly lastAgentAnswer: string | null;
  readonly agentTurnCount: number;
  /** Computed projections. */
  readonly hasFocus: boolean;
  readonly isLive: boolean;
  readonly isSimulating: boolean;
  readonly isScrubbing: boolean;
};

const EMPTY_SNAPSHOT: StudioUiSnapshot = {
  focusedNodeId: null,
  focusedNodeKind: null,
  focusedNodeOrigin: null,
  activeLens: "interact",
  viewMode: "live",
  simulationActionName: null,
  scrubEnvelopeId: null,
  activeProjectName: null,
  lastUserPrompt: null,
  lastAgentAnswer: null,
  agentTurnCount: 0,
  hasFocus: false,
  isLive: true,
  isSimulating: false,
  isScrubbing: false,
};

type StudioUiContextValue = {
  /** Readable projection of the runtime snapshot. */
  readonly snapshot: StudioUiSnapshot;
  /** True once studio.mel has finished its initial build. */
  readonly ready: boolean;
  /**
   * Direct access to the runtime for call sites that need legality
   * reads (`isActionAvailable`, `explainIntent`) or that want to
   * dispatch without going through the typed helpers below.
   * Returns `null` until the initial build completes.
   */
  readonly core: StudioCore | null;
  // ── Typed dispatch helpers ──────────────────────────────────────
  // Thin wrappers over core.dispatchAsync — keep call sites free of
  // `createIntent` boilerplate. Every call is fire-and-forget; the
  // runtime's legality gates reject invalid transitions silently
  // (the agent gets structured errors via the dispatch tool).
  readonly focusNode: (
    id: string,
    kind: "action" | "state" | "computed",
    origin: "graph" | "source" | "diagnostic" | "interact" | "agent",
  ) => void;
  readonly clearFocus: () => void;
  readonly openLens: (id: StudioUiSnapshot["activeLens"]) => void;
  readonly enterSimulation: (actionName: string) => void;
  readonly exitSimulation: () => void;
  readonly scrubTo: (envelopeId: string) => void;
  readonly resetScrub: () => void;
  readonly switchProject: (name: string) => void;
  readonly recordAgentTurn: (prompt: string, answer: string) => void;
  // ── Low-level dispatch seam (for tests + programmatic callers) ──
  // Typed helpers above cover every known studio.mel action. These
  // lower-level seams are kept for callers that need Promise-shaped
  // results. They're equivalent to hitting `core.*` directly now
  // that core fires `subscribeAfterDispatch`; the wrapper just
  // propagates the runtime-not-ready error with a clearer message.
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
};

const StudioUiContext = createContext<StudioUiContextValue | null>(null);
StudioUiContext.displayName = "StudioUiContext";

export function StudioUiProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  // Core + adapter are created once per provider lifetime. The
  // initial build is asynchronous — until it resolves, consumers
  // see the default snapshot (not null) so cascade renders don't
  // need to handle a "loading" branch everywhere.
  const [core, setCore] = useState<StudioCore | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const instance = createStudioCore();
    const adapter = createHeadlessAdapter({ initialSource: studioMelSource });
    const detach = instance.attach(adapter);
    void instance
      .build()
      .then((result) => {
        if (cancelled) return;
        if (result.kind !== "ok") {
          // Bundled MEL should always compile — if it doesn't, fail
          // loudly so the error doesn't hide behind an empty snapshot.
          console.error(
            "[StudioUiRuntime] studio.mel failed to build:",
            result.errors,
          );
          return;
        }
        setCore(instance);
      })
      .catch((err) => {
        console.error("[StudioUiRuntime] build threw:", err);
      });
    return () => {
      cancelled = true;
      detach();
    };
  }, []);

  // Bump `version` on every dispatch so `useSyncExternalStore` below
  // re-reads the snapshot. We can't rely on `core.getSnapshot()`'s
  // identity alone because it's called lazily and returns a new
  // object each time — we need a monotonic key.
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
  const getSnapshot = useMemo(
    () => () => version,
    [version],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const snapshot = useMemo<StudioUiSnapshot>(() => {
    if (core === null) return EMPTY_SNAPSHOT;
    return readSnapshot(core);
    // `version` participates so the memo invalidates on every dispatch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, version]);

  // Bump version on every successful dispatch against the studio
  // runtime — this provider's own helpers, the agent's
  // `studioDispatch` tool, programmatic callers, anyone. Using the
  // core's subscribeAfterDispatch seam means we don't have to route
  // all writers through a specific helper; the core fires the
  // notifier regardless of who initiated the dispatch.
  useEffect(() => {
    if (core === null) return;
    const detach = core.subscribeAfterDispatch((result) => {
      if (result.kind !== "completed") return;
      setVersion((v) => v + 1);
      for (const l of subscribersRef.current) l();
    });
    return detach;
  }, [core]);

  // Convenience wrapper kept for tests / external callers that like
  // a Promise-returning dispatch. Identical to hitting
  // `core.dispatchAsync` directly now that the subscription above
  // handles React notification.
  const dispatchIntent = useCallback(
    async (intent: Intent): Promise<StudioDispatchResult> => {
      if (core === null) {
        throw new Error(
          "[StudioUiRuntime] dispatchAsync called before runtime ready",
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
          "[StudioUiRuntime] createIntent called before runtime ready",
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
        // createIntent throwing means arg-count mismatch — a bug at
        // the call site, not a runtime state issue. Surface.
        console.error(
          `[StudioUiRuntime] createIntent("${actionName}") threw:`,
          err,
        );
      }
    },
    [core, dispatchIntent],
  );

  const value = useMemo<StudioUiContextValue>(
    () => ({
      snapshot,
      ready: core !== null,
      core,
      focusNode: (id, kind, origin) =>
        dispatch("focusNode", [id, kind, origin]),
      clearFocus: () => dispatch("clearFocus", []),
      openLens: (id) => dispatch("openLens", [id]),
      enterSimulation: (actionName) =>
        dispatch("enterSimulation", [actionName]),
      exitSimulation: () => dispatch("exitSimulation", []),
      scrubTo: (envelopeId) => dispatch("scrubTo", [envelopeId]),
      resetScrub: () => dispatch("resetScrub", []),
      switchProject: (name) => dispatch("switchProject", [name]),
      recordAgentTurn: (prompt, answer) =>
        dispatch("recordAgentTurn", [prompt, answer]),
      createIntent: createIntentFn,
      dispatchAsync: dispatchIntent,
    }),
    [snapshot, core, dispatch, createIntentFn, dispatchIntent],
  );

  return (
    <StudioUiContext.Provider value={value}>
      {children}
    </StudioUiContext.Provider>
  );
}

export function useStudioUi(): StudioUiContextValue {
  const ctx = useContext(StudioUiContext);
  if (ctx === null) {
    throw new Error("useStudioUi must be used inside <StudioUiProvider>");
  }
  return ctx;
}

function readSnapshot(core: StudioCore): StudioUiSnapshot {
  const raw = core.getSnapshot();
  if (raw === null) return EMPTY_SNAPSHOT;
  const data = (raw as Snapshot<Record<string, unknown>>).data ?? {};
  const computed =
    ((raw as { readonly computed?: Record<string, unknown> }).computed) ?? {};
  return {
    focusedNodeId: asStringOrNull(data.focusedNodeId),
    focusedNodeKind: asFocusKind(data.focusedNodeKind),
    focusedNodeOrigin: asFocusOrigin(data.focusedNodeOrigin),
    activeLens: asLensId(data.activeLens) ?? "interact",
    viewMode: asViewMode(data.viewMode) ?? "live",
    simulationActionName: asStringOrNull(data.simulationActionName),
    scrubEnvelopeId: asStringOrNull(data.scrubEnvelopeId),
    activeProjectName: asStringOrNull(data.activeProjectName),
    lastUserPrompt: asStringOrNull(data.lastUserPrompt),
    lastAgentAnswer: asStringOrNull(data.lastAgentAnswer),
    agentTurnCount: typeof data.agentTurnCount === "number" ? data.agentTurnCount : 0,
    hasFocus: Boolean(computed.hasFocus),
    isLive: computed.isLive !== false,
    isSimulating: Boolean(computed.isSimulating),
    isScrubbing: Boolean(computed.isScrubbing),
  };
}

// --- narrow parsers ----------------------------------------------
// The runtime guarantees the declared types, but we keep the narrow
// parsers so a future schema mistake (e.g. a renamed literal) turns
// into `null` instead of silently tunneling through as `unknown`.

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asFocusKind(v: unknown): StudioUiSnapshot["focusedNodeKind"] {
  return v === "action" || v === "state" || v === "computed" ? v : null;
}

function asFocusOrigin(v: unknown): StudioUiSnapshot["focusedNodeOrigin"] {
  return v === "graph" ||
    v === "source" ||
    v === "diagnostic" ||
    v === "interact" ||
    v === "agent"
    ? v
    : null;
}

function asLensId(v: unknown): StudioUiSnapshot["activeLens"] | null {
  return v === "interact" ||
    v === "snapshot" ||
    v === "plan" ||
    v === "history" ||
    v === "diagnostics" ||
    v === "agent"
    ? v
    : null;
}

function asViewMode(v: unknown): StudioUiSnapshot["viewMode"] | null {
  return v === "live" || v === "simulate" || v === "scrub" ? v : null;
}
