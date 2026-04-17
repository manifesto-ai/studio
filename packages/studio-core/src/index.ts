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
export {
  createSqliteEditHistoryStore,
  defaultEditHistoryDbPath,
  type SqliteStoreOptions,
} from "./internal/sqlite-edit-history-store.js";
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
