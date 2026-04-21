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
import type {
  World,
  WorldHead,
  WorldId,
  WorldLineage,
} from "../internal/lineage-tracker.js";

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
  /**
   * Coarse availability check — `true` when the action's `available
   * when` guard holds on the current snapshot. Does NOT evaluate
   * `dispatchable when` (that needs a constructed intent). Drives the
   * Harness UI split (Pillar 1) between "things you can do now" and
   * "things that are currently unavailable".
   */
  readonly isActionAvailable: (name: string) => boolean;
  readonly getTraceHistory: () => readonly TraceRecord[];
  readonly getLastReconciliationPlan: () => ReconciliationPlan | null;
  readonly getModule: () => DomainModule | null;
  readonly getDiagnostics: () => readonly Marker[];
  readonly getEditHistory: (
    query?: EditHistoryQuery,
  ) => Promise<readonly EditIntentEnvelope[]>;
  /**
   * Synthetic Merkle-ish world lineage (Pillar 4 — "Time is first-class").
   * Each successful build or completed dispatch emits a World linked to
   * its parent by id. Read via `getLineage()` for the full chain or
   * `getLatestHead()` for the current tip. Type shapes mirror
   * `@manifesto-ai/lineage` for future swap.
   */
  readonly getLineage: () => WorldLineage;
  readonly getLatestHead: () => WorldHead | null;
  readonly getWorld: (id: WorldId) => World | null;
};
