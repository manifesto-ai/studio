import type { DomainModule } from "@manifesto-ai/compiler";
import type {
  DispatchBlocker,
  DispatchReport,
  Intent,
  IntentExplanation,
  Snapshot,
} from "@manifesto-ai/sdk";
import type { EditorAdapter, Marker } from "./adapter-interface.js";
import type { BuildResult } from "./types/build-result.js";
import type { StudioDispatchResult } from "./types/dispatch-result.js";
import type { StudioSimulateResult } from "./types/simulate-result.js";
import type { ReconciliationPlan } from "./types/reconciliation.js";
import type { TraceRecord } from "./types/trace.js";
import type { Detach, StudioCore, StudioCoreOptions } from "./types/studio-core.js";
import type { EditIntentEnvelope } from "./types/edit-intent.js";
import type { EditHistoryQuery } from "./types/edit-history-store.js";
import { executeBuild } from "./internal/build-pipeline.js";
import { createInitialState, type StudioState } from "./internal/state.js";
import { createTraceBuffer } from "./internal/trace-buffer.js";
import { createInMemoryEditHistoryStore } from "./internal/in-memory-edit-history-store.js";
import { buildEnvelope } from "./internal/envelope-codec.js";

const DEFAULT_TRACE_BUFFER_SIZE = 1000;

export function createStudioCore(options?: StudioCoreOptions): StudioCore {
  const traceBuffer = createTraceBuffer(
    options?.traceBufferSize ?? DEFAULT_TRACE_BUFFER_SIZE,
  );
  const editHistoryStore =
    options?.editHistoryStore ?? createInMemoryEditHistoryStore();
  const effects = options?.effects;
  let state: StudioState = createInitialState();
  let attachedAdapter: EditorAdapter | null = null;
  let adapterUnsubscribe: (() => void) | null = null;
  let dispatchSeq = 0;

  function syncAdapterMarkers(): void {
    if (attachedAdapter !== null) {
      attachedAdapter.setMarkers(state.currentMarkers);
    }
  }

  async function build(): Promise<BuildResult> {
    if (attachedAdapter !== null) {
      state = { ...state, pendingSource: attachedAdapter.getSource() };
    }
    const source = state.pendingSource;
    const { result, nextState } = executeBuild(state, traceBuffer.getAll(), {
      effects,
    });
    state = nextState;
    syncAdapterMarkers();

    // SE-HIST-1: every successful build emits exactly one envelope.
    // SE-HIST-3: envelope carries the ReconciliationPlan.
    // SE-HIST-4: Phase 0 author is always "human".
    if (result.kind === "ok") {
      const envelope = buildEnvelope({
        payload: { kind: "rebuild", source },
        plan: result.plan,
        author: "human",
      });
      await editHistoryStore.append(envelope);
    }
    return result;
  }

  function attach(adapter: EditorAdapter): Detach {
    if (attachedAdapter !== null) {
      throw new Error(
        "[studio-core] adapter already attached; detach before attaching another",
      );
    }
    attachedAdapter = adapter;
    state = { ...state, pendingSource: adapter.getSource() };
    adapterUnsubscribe = adapter.onBuildRequest(() => {
      void build();
    });
    return () => {
      if (adapterUnsubscribe !== null) {
        adapterUnsubscribe();
        adapterUnsubscribe = null;
      }
      attachedAdapter = null;
    };
  }

  function requireRuntime(op: string) {
    if (state.runtime === null) {
      throw new Error(
        `[studio-core] cannot ${op} before first successful build`,
      );
    }
    return state.runtime;
  }

  function getSnapshot(): Snapshot<unknown> | null {
    if (state.runtime === null) return null;
    return state.runtime.getSnapshot() as Snapshot<unknown>;
  }

  function getModule(): DomainModule | null {
    return state.currentModule;
  }

  function getDiagnostics(): readonly Marker[] {
    return state.currentMarkers;
  }

  function getLastReconciliationPlan(): ReconciliationPlan | null {
    return state.lastPlan;
  }

  function getTraceHistory(): readonly TraceRecord[] {
    return traceBuffer.getAll();
  }

  async function getEditHistory(
    query?: EditHistoryQuery,
  ): Promise<readonly EditIntentEnvelope[]> {
    return editHistoryStore.list(query);
  }

  function createIntent(action: string, ...args: unknown[]): Intent {
    const runtime = requireRuntime("createIntent");
    const actionsMap = runtime.MEL.actions as Record<string, unknown>;
    const actionRef = actionsMap[action];
    if (actionRef === undefined) {
      throw new Error(`[studio-core] unknown action: ${action}`);
    }
    const typedCreate = runtime.createIntent as unknown as (
      ref: unknown,
      ...rest: unknown[]
    ) => Intent;
    return typedCreate(actionRef, ...args);
  }

  function explainIntent(intent: Intent): IntentExplanation {
    const runtime = requireRuntime("explainIntent");
    return runtime.explainIntent(intent as never) as IntentExplanation;
  }

  function why(intent: Intent): IntentExplanation {
    const runtime = requireRuntime("why");
    return runtime.why(intent as never) as IntentExplanation;
  }

  function whyNot(intent: Intent): readonly DispatchBlocker[] | null {
    const runtime = requireRuntime("whyNot");
    return runtime.whyNot(intent as never) as readonly DispatchBlocker[] | null;
  }

  function isActionAvailable(name: string): boolean {
    if (state.runtime === null) return false;
    const runtimeApi = state.runtime as unknown as {
      readonly isActionAvailable?: (n: string) => boolean;
    };
    if (typeof runtimeApi.isActionAvailable !== "function") return true;
    try {
      return runtimeApi.isActionAvailable(name);
    } catch {
      // If the runtime throws (e.g. unknown action), treat as
      // unavailable rather than propagating — callers (UI) only need
      // a yes/no and can show the raw action in a "possibly broken"
      // state through their own diagnostics path.
      return false;
    }
  }

  async function dispatchAsync(intent: Intent): Promise<StudioDispatchResult> {
    const runtime = requireRuntime("dispatchAsync");
    const schemaHash = state.currentSchemaHash;
    if (schemaHash === null) {
      throw new Error("[studio-core] schema hash missing despite active runtime");
    }
    dispatchSeq += 1;
    const intentId =
      typeof intent.intentId === "string" && intent.intentId.length > 0
        ? intent.intentId
        : `${state.currentBuildId ?? "nobuild"}:${dispatchSeq}`;

    const report = (await runtime.dispatchAsyncWithReport(
      intent as never,
    )) as DispatchReport;

    const hostTraces =
      (report.kind === "completed" || report.kind === "failed") &&
      report.diagnostics?.hostTraces
        ? report.diagnostics.hostTraces
        : [];
    const traceIds =
      hostTraces.length > 0
        ? traceBuffer.append(intentId, schemaHash, hostTraces)
        : [];

    return { ...report, traceIds } as StudioDispatchResult;
  }

  function simulate(intent: Intent): StudioSimulateResult {
    const runtime = requireRuntime("simulate");
    const schemaHash = state.currentSchemaHash;
    if (schemaHash === null) {
      throw new Error("[studio-core] schema hash missing despite active runtime");
    }
    const actionsMap = runtime.MEL.actions as Record<string, unknown>;
    const actionRef = actionsMap[intent.type];
    if (actionRef === undefined) {
      throw new Error(`[studio-core] unknown action: ${intent.type}`);
    }
    // `intent.input` is keyed by parameter name (SDK createIntent
    // convention), e.g. `{ payload: { title: "…" } }`. The SDK's
    // `simulate` takes positional args per action `params`, so we
    // unwrap by schema-declared order. Handing `intent.input` through
    // verbatim throws "Unknown field: payload" on single-parameter
    // actions like `save(payload: Payload)`. (`dispatchAsyncWithReport`
    // takes the whole intent and does this unwrap internally — simulate
    // does not, hence the asymmetry.)
    const actionSpec = (runtime.schema.actions as Record<string, { params?: readonly string[] }> | undefined)?.[intent.type];
    const paramNames = actionSpec?.params ?? [];
    const simulateArgs =
      intent.input === undefined
        ? []
        : paramNames.length === 0
          ? []
          : paramNames.map((name) =>
              (intent.input as Record<string, unknown>)[name],
            );
    const typedSimulate = runtime.simulate as unknown as (
      ref: unknown,
      ...rest: unknown[]
    ) => StudioSimulateResult;
    const result = typedSimulate(actionRef, ...simulateArgs);
    return { ...result, meta: { schemaHash } };
  }

  return {
    attach,
    build,
    getSnapshot,
    createIntent,
    explainIntent,
    why,
    whyNot,
    dispatchAsync,
    simulate,
    isActionAvailable,
    getTraceHistory,
    getLastReconciliationPlan,
    getModule,
    getDiagnostics,
    getEditHistory,
  };
}
