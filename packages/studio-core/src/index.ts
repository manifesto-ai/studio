export { createStudioCore } from "./create-studio-core.js";

export type {
  StudioCore,
  StudioCoreOptions,
  Detach,
} from "./types/studio-core.js";

export type {
  EditorAdapter,
  Listener,
  Marker,
  SourceSpan,
  Unsubscribe,
} from "./adapter-interface.js";

export type {
  BuildResult,
  BuildOk,
  BuildFail,
} from "./types/build-result.js";

export type { StudioDispatchResult } from "./types/dispatch-result.js";
export type { StudioSimulateResult } from "./types/simulate-result.js";

// SDK types surfaced by StudioCore signatures — re-exported so downstream
// packages (studio-react, studio-adapter-monaco, host apps) don't need a
// direct @manifesto-ai/sdk dependency just to name these types.
export type {
  CanonicalSnapshot,
  DispatchBlocker,
  DispatchReport,
  EffectHandler,
  ExecutionOutcome,
  Intent,
  IntentAdmission,
  IntentAdmissionFailure,
  IntentExplanation,
  ProjectedDiff,
  SimulationDiagnostics,
  Snapshot,
} from "@manifesto-ai/sdk";
// Also re-export the DomainModule from the compiler since it shows up on
// `core.getModule()` and on the ReconciliationPlan journey.
export type { DomainModule } from "@manifesto-ai/compiler";

// Schema graph projections — compiler already derives nodes/edges from the
// schema, so downstream (studio-react SchemaGraphView) consumes this rather
// than re-deriving. Re-exported from core to keep the studio-react ↔ compiler
// boundary mediated by studio-core (INV-P1-2).
export type {
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphEdgeRelation,
  SchemaGraphNode,
  SchemaGraphNodeId,
  SchemaGraphNodeKind,
} from "@manifesto-ai/compiler";

// Source-map projection types — needed by studio-react for click-to-source.
export type {
  SourceMapEntry,
  SourceMapIndex,
  SourceMapPath,
} from "@manifesto-ai/compiler";

// Action/field schema projections — surface area for form generation in
// studio-react InteractionEditor. Same INV-P1-1 precedent (type re-export
// only, no new runtime API).
export type {
  ActionSpec,
  ComputedFieldSpec,
  ComputedSpec,
  DomainSchema,
  FieldSpec,
  FieldType,
  StateSpec,
  TypeDefinition,
  TypeSpec,
} from "@manifesto-ai/compiler";

export type {
  HostTrace,
  TraceId,
  TraceRecord,
} from "./types/trace.js";

export type {
  IdentityFate,
  LocalTargetKey,
  ReconciliationPlan,
  SnapshotReconciliation,
  TraceRename,
  TraceTagging,
  TypeCompatWarning,
} from "./types/reconciliation.js";

export type {
  EditIntent,
  EditIntentAuthor,
  EditIntentEnvelope,
  EditIntentRecord,
  EnvelopePayloadKind,
  EnvelopeVersion,
  LineageAnchor,
  PayloadVersion,
  SerializedReconciliationPlan,
} from "./types/edit-intent.js";

export {
  deserializePlan,
  serializePlan,
} from "./types/edit-intent.js";

export type {
  EditHistoryQuery,
  EditHistoryStore,
} from "./types/edit-history-store.js";

export { createInMemoryEditHistoryStore } from "./internal/in-memory-edit-history-store.js";
// `createSqliteEditHistoryStore` is Node-only — live in `@manifesto-ai/studio-core/sqlite`
// so browser bundles do not drag better-sqlite3 into the tree.
// See packages/studio-core/src/sqlite.ts
export {
  buildEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  extractPlan,
  EnvelopeCodecError,
  type BuildEnvelopeInput,
} from "./internal/envelope-codec.js";

export {
  replayHistory,
  replayEnvelopes,
  canonicalizeForDeterminismCompare,
  type ReplayResult,
} from "./internal/replay.js";

export {
  formatPlan,
  type FormatPlanOptions,
} from "./internal/format-plan.js";

export type {
  BranchId,
  World,
  WorldHead,
  WorldId,
  WorldLineage,
  WorldOrigin,
} from "./internal/lineage-tracker.js";
