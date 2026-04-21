import type { DomainModule } from "@manifesto-ai/compiler";
import type { CanonicalSnapshot } from "@manifesto-ai/sdk";
import type {
  EditHistoryQuery,
  EditHistoryStore,
} from "../types/edit-history-store.js";
import type { EditIntentEnvelope } from "../types/edit-intent.js";
import type { ReconciliationPlan } from "../types/reconciliation.js";
import { executeBuild } from "./build-pipeline.js";
import { disposeRuntime } from "./runtime-bridge.js";
import { createInitialState, type StudioState } from "./state.js";

export type ReplayResult = {
  readonly module: DomainModule | null;
  readonly canonicalSnapshot: CanonicalSnapshot<unknown> | null;
  readonly plans: readonly ReconciliationPlan[];
  readonly envelopes: readonly EditIntentEnvelope[];
};

/**
 * Reconstruct the final module + canonical snapshot by replaying the
 * envelope stream through the same build pipeline used at edit time.
 *
 * Determinism (INV-SE-4): executeBuild + snapshot overlay are pure given
 * the envelope sources. Running this function twice on the same envelope
 * stream must yield identical `module.schema.hash` and identical
 * `canonicalSnapshot.data` (meta.timestamp/randomSeed remain platform-dependent).
 *
 * Phase 0 recognises only `rebuild` envelopes. `rename_decl` envelopes are
 * accepted but skipped — their application requires Week 3+ rename wiring.
 */
export async function replayHistory(
  store: EditHistoryStore,
  query?: EditHistoryQuery,
): Promise<ReplayResult> {
  const envelopes = await store.list(query);
  return replayEnvelopes(envelopes);
}

export function replayEnvelopes(
  envelopes: readonly EditIntentEnvelope[],
): ReplayResult {
  let state: StudioState = createInitialState();
  const plans: ReconciliationPlan[] = [];

  for (const envelope of envelopes) {
    if (envelope.payload.kind !== "rebuild") continue;
    state = { ...state, pendingSource: envelope.payload.source };
    const { result, nextState } = executeBuild(state, []);
    state = nextState;
    if (result.kind === "ok") {
      plans.push(result.plan);
    }
  }

  const module = state.currentModule;
  const canonicalSnapshot =
    state.runtime !== null
      ? (state.runtime.getCanonicalSnapshot() as CanonicalSnapshot<unknown>)
      : null;

  // getCanonicalSnapshot() returns a frozen clone, so disposing the runtime
  // now is safe. Replay is a read-only reconstruction — we do not hand
  // the runtime back to callers.
  disposeRuntime(state.runtime);

  return { module, canonicalSnapshot, plans, envelopes };
}

/**
 * Helper for tests: strip volatile meta fields so two replay snapshots can
 * be byte-compared. Mirrors the determinism contract of INV-SE-4 — the
 * `data` tree is deterministic; `meta.timestamp` / `meta.randomSeed` are
 * host-provided and may legitimately drift.
 */
export function canonicalizeForDeterminismCompare(
  snapshot: CanonicalSnapshot<unknown> | null,
): unknown {
  if (snapshot === null) return null;
  const anySnap = snapshot as {
    readonly data?: unknown;
    readonly computed?: unknown;
    readonly input?: unknown;
    readonly system?: unknown;
  };
  return {
    data: anySnap.data ?? null,
    computed: anySnap.computed ?? null,
    input: anySnap.input ?? null,
    system: anySnap.system ?? null,
  };
}

export { disposeRuntime };
