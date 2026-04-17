import type {
  IdentityFate,
  LocalTargetKey,
  ReconciliationPlan,
  SnapshotReconciliation,
  TraceTagging,
} from "./reconciliation.js";

/**
 * EditIntent — semantic unit of history.
 * Phase 0 recognises only two kinds. Phase 3 extends with structured agent intents.
 */
export type EditIntent =
  | { readonly kind: "rebuild"; readonly source: string }
  | {
      readonly kind: "rename_decl";
      readonly from: LocalTargetKey;
      readonly to: string;
    };

export type EditIntentAuthor = "human" | "agent";

export type EnvelopePayloadKind = EditIntent["kind"];
export type EnvelopeVersion = 1;
export type PayloadVersion = 1;

/**
 * SerializedReconciliationPlan — wire format for ReconciliationPlan.
 * identityMap is a tuple array (Maps do not JSON-serialise natively).
 */
export type SerializedReconciliationPlan = {
  readonly prevSchemaHash: string | null;
  readonly nextSchemaHash: string;
  readonly identityMap: readonly (readonly [LocalTargetKey, IdentityFate])[];
  readonly snapshotPlan: SnapshotReconciliation;
  readonly traceTag: TraceTagging;
};

/**
 * EditIntentEnvelope — the append-only record format.
 *
 * Envelope fields (everything except `payload` and `plan`) are locked for
 * the duration of Phase 0. `payload` and `plan` carry their own versions.
 *
 * SE-HIST-1: every successful build emits one envelope.
 * SE-HIST-2: append-only — stores must reject updates.
 * SE-HIST-3: each envelope carries the ReconciliationPlan that ran.
 * SE-HIST-5: envelope is serialisable so Lineage can back it up verbatim.
 */
export type EditIntentEnvelope = {
  readonly id: string;
  readonly timestamp: number;
  readonly envelopeVersion: EnvelopeVersion;
  readonly payloadKind: EnvelopePayloadKind;
  readonly payloadVersion: PayloadVersion;
  readonly prevSchemaHash: string | null;
  readonly nextSchemaHash: string;
  readonly author: EditIntentAuthor;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payload: EditIntent;
  readonly plan: SerializedReconciliationPlan;
};

export type LineageAnchor = {
  readonly branchId: string;
  readonly worldId: string;
};

/**
 * EditIntentRecord — convenience bundle for callers. The store speaks in
 * envelopes; this type is what runtime code reads when walking history.
 */
export type EditIntentRecord = {
  readonly envelope: EditIntentEnvelope;
  readonly lineageAnchor?: LineageAnchor;
};

export function serializePlan(plan: ReconciliationPlan): SerializedReconciliationPlan {
  return {
    prevSchemaHash: plan.prevSchemaHash,
    nextSchemaHash: plan.nextSchemaHash,
    identityMap: [...plan.identityMap.entries()],
    snapshotPlan: plan.snapshotPlan,
    traceTag: plan.traceTag,
  };
}

export function deserializePlan(serialized: SerializedReconciliationPlan): ReconciliationPlan {
  return {
    prevSchemaHash: serialized.prevSchemaHash,
    nextSchemaHash: serialized.nextSchemaHash,
    identityMap: new Map(serialized.identityMap),
    snapshotPlan: serialized.snapshotPlan,
    traceTag: serialized.traceTag,
  };
}
