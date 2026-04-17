import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  BuildResult,
  EditIntentEnvelope,
  EditorAdapter,
  Intent,
  StudioCore,
  StudioDispatchResult,
  StudioSimulateResult,
} from "@manifesto-ai/studio-core";

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
  readonly build: () => Promise<BuildResult>;
  readonly dispatch: (intent: Intent) => Promise<StudioDispatchResult>;
  readonly simulate: (intent: Intent) => StudioSimulateResult;
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly setSource: (source: string) => void;
  readonly requestBuild: () => void;
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
  const dispatch = useCallback(
    (intent: Intent) => bump(() => core.dispatchAsync(intent)),
    [bump, core],
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

  const value = useMemo<StudioContextValue>(
    () => ({
      core,
      adapter,
      version,
      history,
      build,
      dispatch,
      simulate,
      createIntent,
      setSource,
      requestBuild,
    }),
    [
      core,
      adapter,
      version,
      history,
      build,
      dispatch,
      simulate,
      createIntent,
      setSource,
      requestBuild,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}
