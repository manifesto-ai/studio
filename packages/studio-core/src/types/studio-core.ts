import type { DomainModule } from "@manifesto-ai/compiler";
import type {
  DispatchBlocker,
  EffectHandler,
  Intent,
  IntentExplanation,
  Snapshot,
} from "@manifesto-ai/sdk";
import type { EditorAdapter, Marker } from "../adapter-interface.js";
import type { BuildResult } from "./build-result.js";
import type { StudioDispatchResult } from "./dispatch-result.js";
import type { StudioSimulateResult } from "./simulate-result.js";
import type { TraceRecord } from "./trace.js";
import type { ReconciliationPlan } from "./reconciliation.js";
import type { EditHistoryQuery, EditHistoryStore } from "./edit-history-store.js";
import type { EditIntentEnvelope } from "./edit-intent.js";

export type Detach = () => void;

export type StudioEffects = Record<string, EffectHandler>;

export type StudioCoreOptions = {
  readonly traceBufferSize?: number;
  readonly editHistoryStore?: EditHistoryStore;
  /**
   * Host effect handlers registered with the underlying SDK runtime.
   *
   * SE-BUILD-6 rationale: Phase 0 shipped with hardcoded `{}` so that no
   * Host IO could fire from build paths. Phase 1 exposes this as an
   * opt-in seam so test harnesses, REPL scripts, and demos can register
   * handlers. Default remains `{}` to preserve the Phase 0 guarantee for
   * callers that do not opt in.
   */
  readonly effects?: StudioEffects;
};

export type StudioCore = {
  readonly attach: (adapter: EditorAdapter) => Detach;
  readonly build: () => Promise<BuildResult>;
  readonly getSnapshot: () => Snapshot<unknown> | null;
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly explainIntent: (intent: Intent) => IntentExplanation;
  readonly why: (intent: Intent) => IntentExplanation;
  readonly whyNot: (intent: Intent) => readonly DispatchBlocker[] | null;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
  readonly simulate: (intent: Intent) => StudioSimulateResult;
  readonly getTraceHistory: () => readonly TraceRecord[];
  readonly getLastReconciliationPlan: () => ReconciliationPlan | null;
  readonly getModule: () => DomainModule | null;
  readonly getDiagnostics: () => readonly Marker[];
  readonly getEditHistory: (
    query?: EditHistoryQuery,
  ) => Promise<readonly EditIntentEnvelope[]>;
};
