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

export type SimulationPlaybackEvent = {
  readonly actionName: string;
  readonly trace: SimulationTrace;
  readonly source: SimulationPlaybackSource;
  readonly mode?: SimulationPlaybackMode;
  readonly traceNodeId?: string | null;
};

export type SimulationPlayback = SimulationPlaybackEvent & {
  readonly generation: number;
  readonly mode: SimulationPlaybackMode;
  readonly traceNodeId: string | null;
};

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
  readonly simulationPlayback: SimulationPlayback | null;
  readonly publishSimulationPlayback: (event: SimulationPlaybackEvent) => void;
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
  const [simulationPlayback, setSimulationPlayback] =
    useState<SimulationPlayback | null>(null);
  const simulationPlaybackGenerationRef = useRef(0);

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
  const publishSimulationPlayback = useCallback(
    (event: SimulationPlaybackEvent): void => {
      simulationPlaybackGenerationRef.current += 1;
      setSimulationPlayback({
        ...event,
        generation: simulationPlaybackGenerationRef.current,
        mode: event.mode ?? "sequence",
        traceNodeId: event.traceNodeId ?? null,
      });
    },
    [],
  );

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
      simulationPlayback,
      publishSimulationPlayback,
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
      simulationPlayback,
      publishSimulationPlayback,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
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
