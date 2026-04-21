import type { LocalTargetKey } from "@manifesto-ai/compiler";
import type { TraceId } from "./trace.js";

export type { LocalTargetKey };

export type IdentityFate =
  | { readonly kind: "preserved" }
  | { readonly kind: "initialized"; readonly reason: "new" | "type_changed" }
  | { readonly kind: "discarded"; readonly reason: "removed" | "type_incompatible" }
  | { readonly kind: "renamed"; readonly from: LocalTargetKey };

export type TypeCompatWarning = {
  readonly target: LocalTargetKey;
  readonly message: string;
};

export type SnapshotReconciliation = {
  readonly preserved: readonly LocalTargetKey[];
  readonly initialized: readonly LocalTargetKey[];
  readonly discarded: readonly LocalTargetKey[];
  readonly warned: readonly TypeCompatWarning[];
};

export type TraceRename = {
  readonly traceId: TraceId;
  readonly fromTarget: LocalTargetKey;
  readonly toTarget: LocalTargetKey;
};

export type TraceTagging = {
  readonly stillValid: readonly TraceId[];
  readonly obsolete: readonly TraceId[];
  readonly renamed: readonly TraceRename[];
};

export type ReconciliationPlan = {
  readonly prevSchemaHash: string | null;
  readonly nextSchemaHash: string;
  readonly identityMap: ReadonlyMap<LocalTargetKey, IdentityFate>;
  readonly snapshotPlan: SnapshotReconciliation;
  readonly traceTag: TraceTagging;
};
