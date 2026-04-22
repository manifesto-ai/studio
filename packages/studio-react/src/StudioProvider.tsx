import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BuildResult,
  DispatchBlocker,
  EditIntentEnvelope,
  EditorAdapter,
  Intent,
  IntentExplanation,
  StudioCore,
  StudioDispatchResult,
  StudioSimulateResult,
  WorldLineage,
} from "@manifesto-ai/studio-core";
import { resolveValueAtPath } from "./InteractionEditor/snapshot-diff.js";

export type SimulationPlaybackSource =
  | "interaction-editor"
  | "graph-popover";

export type SimulationPlaybackMode = "sequence" | "step";

type SimulationTrace = NonNullable<
  NonNullable<StudioSimulateResult["diagnostics"]>["trace"]
>;

/**
 * Trace descriptor — the payload the playback controller in the webapp
 * consumes. A `SimulationSession` carries one of these in its `playback`
 * field. `generation` increments on every new session so downstream
 * controllers can tell a replay apart from a continuation.
 */
export type SimulationPlayback = {
  readonly generation: number;
  readonly actionName: string;
  readonly trace: SimulationTrace;
  readonly source: SimulationPlaybackSource;
  readonly mode: SimulationPlaybackMode;
  readonly traceNodeId: string | null;
};

/**
 * Discriminated union of the entry gestures that can open a simulation
 * session. The `kind` stays on the type so future kinds (e.g.
 * `snapshot-bound` for §9.1, `api` for §9.3 agent integration) are
 * additive — consumers pattern-match on `origin.kind` and a missing
 * arm is a type error rather than a silent fallthrough.
 */
export type SimulationSessionOrigin =
  | {
      readonly kind: "simulate-button";
      readonly actionName: string;
    }
  | {
      readonly kind: "trace-node";
      readonly actionName: string;
      readonly traceNodeId: string;
    };

/**
 * "What-if state exploration" session — a time-bounded scope during
 * which the Studio shows hypothetical state rather than the live
 * snapshot. Entering a new session replaces any currently open one.
 * Exit is always explicit (either user gesture or a safety signal like
 * schema rebuild / snapshot advance).
 */
export type SimulationSession = {
  /** Stable per entry. Useful for analytics + test-as-trace export. */
  readonly id: string;
  readonly enteredAt: number;
  readonly origin: SimulationSessionOrigin;
  /** Most specific action this session is bound to, if any. */
  readonly actionName: string | null;
  /** Trace playback payload. Non-null for all current session kinds. */
  readonly playback: SimulationPlayback | null;
};

export type EnterSimulationInput = {
  readonly origin: SimulationSessionOrigin;
  readonly trace: SimulationTrace;
  readonly source: SimulationPlaybackSource;
  readonly mode?: SimulationPlaybackMode;
};

export type SimulationExitReason =
  | "focus-changed"
  | "schema-rebuild"
  | "snapshot-advanced"
  | "user-close"
  | "unmount";

/**
 * Dispatch history — a per-provider log of every dispatch flown through
 * this provider. Unlike `EditIntentEnvelope` (schema edits, SE-HIST-1)
 * and `getTraceHistory()` (host-trace records, which only exist when
 * an effect ran), this log records **every** dispatch by call site so
 * the UI has a stable, always-populated timeline. See UX philosophy
 * Pillar 4: "Time is first-class — snapshot transitions deserve their
 * own surface, not just schema edits."
 *
 * It is NOT a replacement for the SDK's Merkle lineage — that belongs
 * upstream. This is a pragmatic projection for the Dispatch lens.
 */
/**
 * Per-path before/after snapshot diff, captured only for `completed`
 * dispatches. Values are kept as `unknown` — the tooltip formats them
 * (JSON.stringify + truncate) at render time so provider code stays
 * value-agnostic. Truncated to the first 8 paths by default so
 * the history log doesn't retain huge snapshot slices for every
 * dispatch.
 */
export type DispatchDiff = {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
};

export type DispatchHistoryEntry = {
  readonly id: string;
  readonly intentType: string;
  readonly schemaHash: string | null;
  readonly status: "completed" | "rejected" | "failed";
  readonly changedPaths: readonly string[];
  readonly recordedAt: number;
  readonly rejectionCode?: string;
  readonly failureMessage?: string;
  /** Populated for "completed" entries; empty otherwise. */
  readonly diffs?: readonly DispatchDiff[];
};

const DIFF_CAPTURE_LIMIT = 8;

export type StudioContextValue = {
  readonly core: StudioCore;
  /**
   * Null while the editor host is still mounting. Adapter-dependent
   * actions (`setSource`, `requestBuild`) no-op until this becomes
   * non-null. Consumers that need adapter identity can check for null.
   */
  readonly adapter: EditorAdapter | null;
  /**
   * Monotonic version that bumps after any state-changing call (build /
   * dispatch / setSource). Components reading synchronous values like
   * `core.getSnapshot()` should depend on this to re-render.
   */
  readonly version: number;
  readonly history: readonly EditIntentEnvelope[];
  /**
   * Append-only log of dispatches flown through this provider. See
   * `DispatchHistoryEntry`. Always-populated; does not depend on host
   * traces being emitted. Consumed by `<DispatchTimeline />`.
   */
  readonly dispatchHistory: readonly DispatchHistoryEntry[];
  readonly build: () => Promise<BuildResult>;
  readonly explainIntent: (intent: Intent) => IntentExplanation;
  readonly why: (intent: Intent) => IntentExplanation;
  readonly whyNot: (intent: Intent) => readonly DispatchBlocker[] | null;
  readonly dispatch: (intent: Intent) => Promise<StudioDispatchResult>;
  readonly simulate: (intent: Intent) => StudioSimulateResult;
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly setSource: (source: string) => void;
  readonly requestBuild: () => void;
  /**
   * Current simulation session, or `null` when the Studio is showing
   * live state. Entering a new session replaces any prior one. See
   * `SimulationSession` + `SimulationSessionOrigin`.
   */
  readonly simulation: SimulationSession | null;
  /**
   * Open (or replace) a simulation session. Returns the resolved
   * session so callers can reference its `id` without racing on state.
   */
  readonly enterSimulation: (input: EnterSimulationInput) => SimulationSession;
  /**
   * Close the current session (no-op if none open). Optional `reason`
   * is currently informational — in the future we may route it into
   * analytics or session-log export so the exit gesture is legible.
   */
  readonly exitSimulation: (reason?: SimulationExitReason) => void;
};

export const StudioContext = createContext<StudioContextValue | null>(null);
StudioContext.displayName = "StudioContext";

export type StudioProviderProps = {
  readonly core: StudioCore;
  /**
   * Null is permitted so the provider can be mounted at a stable tree
   * position before the editor host has created its adapter. When the
   * adapter becomes non-null, attach + onBuildRequest wiring kicks in.
   */
  readonly adapter: EditorAdapter | null;
  readonly children: ReactNode;
  /**
   * Poll interval for edit history refresh, in ms. Defaults to 500.
   * Set to 0 to disable polling — history will only refresh after
   * `build()` / `dispatch()` calls made through this provider.
   *
   * Phase 1 ADR (P1-OQ-5): the studio-core surface does not expose a
   * push subscription yet. This is deliberate — history length changes
   * only at build boundaries, which the provider already instruments.
   * Polling is a belt-and-suspenders for the external-append case.
   */
  readonly historyPollMs?: number;
};

export function StudioProvider({
  core,
  adapter,
  children,
  historyPollMs = 500,
}: StudioProviderProps): JSX.Element {
  const [version, setVersion] = useState(0);
  const [history, setHistory] = useState<readonly EditIntentEnvelope[]>([]);
  const [dispatchHistory, setDispatchHistory] = useState<
    readonly DispatchHistoryEntry[]
  >([]);
  const dispatchSeqRef = useRef(0);
  const [simulation, setSimulation] = useState<SimulationSession | null>(null);
  const simulationGenerationRef = useRef(0);
  const simulationSeqRef = useRef(0);

  // One-time attach. Re-attaching on adapter identity change is a caller
  // decision: if they swap adapters they must remount the provider.
  useEffect(() => {
    if (adapter === null) return;
    const detach = core.attach(adapter);
    // Prime history on mount.
    void core.getEditHistory().then(setHistory).catch(() => {});
    return () => {
      detach();
    };
    // Intentionally depend on identity — see note above.
  }, [core, adapter]);

  // Wire adapter's `requestBuild` → provider's `build` so that CTRL-S /
  // Build buttons inside SourceEditor trigger the full pipeline.
  useEffect(() => {
    if (adapter === null) return;
    const unsubscribe = adapter.onBuildRequest(() => {
      void bump(() => core.build());
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, adapter]);

  useEffect(() => {
    if (historyPollMs <= 0) return;
    const id = setInterval(() => {
      void core.getEditHistory().then((h) => {
        setHistory((prev) => (prev.length === h.length ? prev : h));
      }).catch(() => {});
    }, historyPollMs);
    return () => clearInterval(id);
  }, [core, historyPollMs]);

  const bump = useCallback(
    async <T,>(fn: () => Promise<T> | T): Promise<T> => {
      const result = await fn();
      setVersion((v) => v + 1);
      try {
        const h = await core.getEditHistory();
        setHistory(h);
      } catch {
        // ignore
      }
      return result;
    },
    [core],
  );

  const build = useCallback(() => bump(() => core.build()), [bump, core]);
  const recordDispatch = useCallback(
    (intent: Intent, result: StudioDispatchResult): void => {
      dispatchSeqRef.current += 1;
      const id = `d${dispatchSeqRef.current}`;
      const schemaHash = core.getModule()?.schema.hash ?? null;
      const common = {
        id,
        intentType: intent.type,
        schemaHash,
        recordedAt: Date.now(),
      };
      const entry: DispatchHistoryEntry =
        result.kind === "completed"
          ? {
              ...common,
              status: "completed",
              changedPaths: result.outcome.projected.changedPaths ?? [],
              diffs: collectDispatchDiffs(result),
            }
          : result.kind === "rejected"
            ? {
                ...common,
                status: "rejected",
                changedPaths: [],
                rejectionCode: result.rejection.code,
              }
            : {
                ...common,
                status: "failed",
                changedPaths: [],
                failureMessage: result.error.message,
              };
      setDispatchHistory((prev) => [...prev, entry]);
    },
    [core],
  );
  const dispatch = useCallback(
    async (intent: Intent): Promise<StudioDispatchResult> => {
      const result = await bump(() => core.dispatchAsync(intent));
      recordDispatch(intent, result);
      return result;
    },
    [bump, core, recordDispatch],
  );
  const explainIntent = useCallback(
    (intent: Intent) => core.explainIntent(intent),
    [core],
  );
  const why = useCallback(
    (intent: Intent) => core.why(intent),
    [core],
  );
  const whyNot = useCallback(
    (intent: Intent) => core.whyNot(intent),
    [core],
  );
  const simulate = useCallback(
    (intent: Intent) => core.simulate(intent),
    [core],
  );
  const createIntent = useCallback(
    (action: string, ...args: unknown[]) => core.createIntent(action, ...args),
    [core],
  );
  const setSource = useCallback(
    (source: string) => {
      if (adapter === null) return;
      adapter.setSource(source);
      // SE-BUILD-2: staging only. No version bump, no build trigger.
    },
    [adapter],
  );
  const requestBuild = useCallback(() => {
    if (adapter === null) return;
    adapter.requestBuild();
  }, [adapter]);
  const enterSimulation = useCallback(
    (input: EnterSimulationInput): SimulationSession => {
      simulationGenerationRef.current += 1;
      simulationSeqRef.current += 1;
      const actionName = extractActionName(input.origin);
      const traceNodeId =
        input.origin.kind === "trace-node" ? input.origin.traceNodeId : null;
      const playback: SimulationPlayback = {
        generation: simulationGenerationRef.current,
        actionName,
        trace: input.trace,
        source: input.source,
        mode: input.mode ?? (traceNodeId !== null ? "step" : "sequence"),
        traceNodeId,
      };
      const session: SimulationSession = {
        id: `sim-${simulationSeqRef.current}`,
        enteredAt: Date.now(),
        origin: input.origin,
        actionName,
        playback,
      };
      setSimulation(session);
      return session;
    },
    [],
  );

  const exitSimulation = useCallback(
    (_reason?: SimulationExitReason): void => {
      setSimulation((prev) => (prev === null ? prev : null));
    },
    [],
  );

  // Auto-exit whenever `version` advances. `version` bumps on build
  // success and on every successful dispatch, so any session entered
  // against the prior world is now stale (either the schema changed,
  // or the live snapshot advanced past the one the simulation was
  // against). We guard on the prior version so the initial mount +
  // first successful build don't clobber a session the user opens
  // immediately afterwards. Safe even if the user has no session open
  // — the setter is a no-op in that case.
  const prevVersionForSimRef = useRef(0);
  useEffect(() => {
    if (prevVersionForSimRef.current === version) return;
    prevVersionForSimRef.current = version;
    setSimulation((prev) => (prev === null ? prev : null));
  }, [version]);

  const value = useMemo<StudioContextValue>(
    () => ({
      core,
      adapter,
      version,
      history,
      dispatchHistory,
      build,
      explainIntent,
      why,
      whyNot,
      dispatch,
      simulate,
      createIntent,
      setSource,
      requestBuild,
      simulation,
      enterSimulation,
      exitSimulation,
    }),
    [
      core,
      adapter,
      version,
      history,
      dispatchHistory,
      build,
      explainIntent,
      why,
      whyNot,
      dispatch,
      simulate,
      createIntent,
      setSource,
      requestBuild,
      simulation,
      enterSimulation,
      exitSimulation,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

/**
 * Read the action name out of a simulation session origin. Every
 * current origin kind carries an action; this is a single-source
 * helper so adding a future kind (e.g. snapshot-bound with no bound
 * action) stays a focused change.
 */
function extractActionName(origin: SimulationSessionOrigin): string {
  switch (origin.kind) {
    case "simulate-button":
      return origin.actionName;
    case "trace-node":
      return origin.actionName;
  }
}

/**
 * Pull per-path before/after from the SDK's projected diff. Capped at
 * `DIFF_CAPTURE_LIMIT` so very wide dispatches (e.g. bulk clear) don't
 * retain the whole snapshot slice in the history log — the NowLine
 * tooltip is a summary view, not an archival one.
 */
function collectDispatchDiffs(
  result: Extract<StudioDispatchResult, { readonly kind: "completed" }>,
): readonly DispatchDiff[] {
  const projected = result.outcome.projected;
  const paths = projected.changedPaths ?? [];
  const out: DispatchDiff[] = [];
  const limit = Math.min(paths.length, DIFF_CAPTURE_LIMIT);
  for (let i = 0; i < limit; i += 1) {
    const path = paths[i];
    out.push({
      path,
      before: resolveValueAtPath(projected.beforeSnapshot, path),
      after: resolveValueAtPath(projected.afterSnapshot, path),
    });
  }
  return out;
}
