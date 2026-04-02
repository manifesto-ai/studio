import {
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from "react";
import { compileMelDomain } from "@manifesto-ai/compiler";
import { createStudioSession, type ProjectionPreset } from "@manifesto-ai/studio-core";
import { createManifesto } from "@manifesto-ai/sdk";

import {
  StudioStateProvider,
  StudioDispatchProvider,
  StudioRefsProvider,
  type AppRuntime,
  type AppSnapshot,
  type StudioRefs
} from "./studio-context.js";
import { studioReducer, createInitialState } from "./studio-reducer.js";
import {
  STARTER_MEL_SOURCE,
  buildActionSpecs,
  buildInitialFieldValues,
  summarizeCompilerState
} from "../authoring.js";

function createRuntime(schema: any) {
  const manifesto = createManifesto<any>(schema, {});
  return manifesto.activate();
}

function buildDefaultPreset(schema: any): ProjectionPreset {
  const stateFields = Object.entries(schema.state.fields) as Array<
    [string, { type: unknown }]
  >;
  const observe: ProjectionPreset["observe"] = [];
  const groupBy: ProjectionPreset["groupBy"] = [];

  for (const [key, field] of stateFields) {
    if (typeof field.type === "string" && field.type === "boolean") {
      observe.push({ kind: "state", path: key, label: key });
      groupBy.push({
        source: "state",
        path: key,
        label: key,
        transform: { kind: "boolean" }
      });
    }
  }

  for (const key of Object.keys(schema.computed.fields)) {
    observe.push({ kind: "computed", id: key, label: key });
    groupBy.push({
      source: "computed",
      id: key,
      label: key,
      transform: { kind: "boolean" }
    });
  }

  for (const actionId of Object.keys(schema.actions)) {
    observe.push({ kind: "action", id: actionId, label: actionId });
  }

  return {
    id: "default",
    name: "Default Lens",
    observe,
    groupBy,
    options: { includeBlocked: true, includeDryRun: true }
  };
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(studioReducer, STARTER_MEL_SOURCE, createInitialState);

  const runtimeRef = useRef<AppRuntime | null>(null);
  const sessionRef = useRef<ReturnType<typeof createStudioSession> | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const pendingRef = useRef<{
    actionId: string;
    args: unknown[];
    beforeSnapshot: AppSnapshot;
    blocker: any;
    startedAt: number;
  } | null>(null);

  const refs = useMemo<StudioRefs>(
    () => ({
      get runtime() {
        return runtimeRef.current;
      },
      get session() {
        return sessionRef.current;
      }
    }),
    []
  );

  useEffect(() => {
    return () => {
      teardownRef.current?.();
    };
  }, []);

  const runCompile = useEffectEvent(
    (nextSource: string, reason: "auto" | "manual") => {
      dispatch({ type: "COMPILE_START" });

      const result = compileMelDomain(nextSource, { mode: "domain" });
      const diagnostics = [...result.errors, ...result.warnings];
      const hasErrors = result.errors.length > 0 || !result.schema;

      if (hasErrors || !result.schema) {
        dispatch({
          type: "COMPILE_ERROR",
          diagnostics,
          message: summarizeCompilerState(diagnostics, Boolean(state.activeSchema))
        });
        return;
      }

      teardownRef.current?.();

      const runtime = createRuntime(result.schema);
      const snapshot = runtime.getSnapshot() as AppSnapshot;
      const session = createStudioSession({ schema: result.schema, snapshot });

      runtimeRef.current = runtime;
      sessionRef.current = session;
      pendingRef.current = null;

      const defaultPreset = buildDefaultPreset(result.schema);

      dispatch({
        type: "COMPILE_SUCCESS",
        schema: result.schema,
        source: nextSource,
        diagnostics,
        message: summarizeCompilerState(diagnostics, true),
        snapshot
      });

      // Set default preset if current one is empty
      if (state.projectionPreset.groupBy.length === 0) {
        dispatch({ type: "SET_PROJECTION_PRESET", preset: defaultPreset });
      }

      // Set initial field values for first action
      const actionIds = Object.keys(result.schema.actions);
      const firstActionId = actionIds[0];
      if (firstActionId) {
        const specs = buildActionSpecs(result.schema, []);
        const spec = specs.find((s) => s.id === firstActionId) ?? null;
        dispatch({ type: "SET_FIELD_VALUES", values: buildInitialFieldValues(spec) });
      }

      const unsubscribes = [
        runtime.on("dispatch:completed", ({ intent, snapshot: nextSnapshot }: any) => {
          const pending = pendingRef.current;
          session.attachSnapshot(nextSnapshot);

          if (pending) {
            dispatch({
              type: "EXECUTE_COMMITTED",
              snapshot: nextSnapshot as AppSnapshot,
              record: {
                id: crypto.randomUUID(),
                mode: "live",
                actionId: pending.actionId,
                args: pending.args,
                outcome: "committed",
                beforeSnapshot: pending.beforeSnapshot,
                afterSnapshot: nextSnapshot,
                blocker: pending.blocker,
                timestamp: pending.startedAt
              },
              message: `${intent.type} committed at snapshot v${nextSnapshot.meta.version}.`
            });
          }

          pendingRef.current = null;
        }),
        runtime.on("dispatch:rejected", ({ intent, reason }: any) => {
          const pending = pendingRef.current;
          const blocker = session.explainActionBlocker(intent.type);

          dispatch({
            type: "EXECUTE_REJECTED",
            record: {
              id: crypto.randomUUID(),
              mode: "live",
              actionId: pending?.actionId ?? intent.type,
              args: pending?.args ?? [],
              outcome: "blocked",
              beforeSnapshot:
                pending?.beforeSnapshot ?? (runtime.getSnapshot() as AppSnapshot),
              blocker: pending?.blocker ?? blocker,
              timestamp: pending?.startedAt ?? Date.now()
            },
            message: `${intent.type} rejected: ${reason}`
          });

          pendingRef.current = null;
        }),
        runtime.on(
          "dispatch:failed",
          ({ intent, error, snapshot: failedSnapshot }: any) => {
            const pending = pendingRef.current;

            if (failedSnapshot) {
              session.attachSnapshot(failedSnapshot);
            }

            dispatch({
              type: "EXECUTE_FAILED",
              snapshot: failedSnapshot as AppSnapshot | undefined,
              record: {
                id: crypto.randomUUID(),
                mode: "live",
                actionId: pending?.actionId ?? intent.type,
                args: pending?.args ?? [],
                outcome: "failed",
                beforeSnapshot:
                  pending?.beforeSnapshot ?? (runtime.getSnapshot() as AppSnapshot),
                afterSnapshot: failedSnapshot,
                blocker: pending?.blocker,
                timestamp: pending?.startedAt ?? Date.now()
              },
              message: `${intent.type} failed: ${error.message}`
            });

            pendingRef.current = null;
          }
        )
      ];

      teardownRef.current = () => {
        unsubscribes.forEach((u) => u());
        session.dispose();
        runtime.dispose();
        runtimeRef.current = null;
        sessionRef.current = null;
      };
    }
  );

  // Auto-compile effect
  useEffect(() => {
    if (!state.autoCompile) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      runCompile(state.source, "auto");
    }, 320);

    return () => window.clearTimeout(timeoutId);
  }, [state.autoCompile, runCompile, state.source]);

  // Expose compile and execute actions via a stable ref that panels can use
  // We attach these to the refs object for imperative operations
  const stableRefs = useMemo(() => {
    const base = refs as StudioRefs & {
      compile: (source: string, reason: "auto" | "manual") => void;
      execute: (actionId: string, args: unknown[]) => Promise<void>;
      resetRuntime: () => void;
      pendingRef: typeof pendingRef;
    };

    base.compile = (source: string, reason: "auto" | "manual") => {
      runCompile(source, reason);
    };

    base.execute = async (actionId: string, args: unknown[]) => {
      const runtime = runtimeRef.current;
      const session = sessionRef.current;
      if (!runtime || !session) {
        return;
      }

      const beforeSnapshot = runtime.getSnapshot() as AppSnapshot;
      const actionBlocker = session.explainActionBlocker(actionId);

      pendingRef.current = {
        actionId,
        args,
        beforeSnapshot,
        blocker: actionBlocker,
        startedAt: Date.now()
      };

      dispatch({ type: "EXECUTE_START", actionId });

      try {
        const actionRef = runtime.MEL.actions[actionId];
        const intent = runtime.createIntent(actionRef as any, ...args);
        await runtime.dispatchAsync(intent);
      } catch (error) {
        pendingRef.current = null;
        dispatch({
          type: "SET_RUNTIME_MESSAGE",
          message: error instanceof Error ? error.message : "Runtime execution failed."
        });
      }
    };

    base.resetRuntime = () => {
      if (state.compiledSource) {
        runCompile(state.compiledSource, "manual");
      }
    };

    base.pendingRef = pendingRef;

    return base;
  }, [refs, runCompile, state.compiledSource]);

  return (
    <StudioStateProvider value={state}>
      <StudioDispatchProvider value={dispatch}>
        <StudioRefsProvider value={stableRefs}>
          {children}
        </StudioRefsProvider>
      </StudioDispatchProvider>
    </StudioStateProvider>
  );
}
