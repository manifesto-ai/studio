export {
  StudioProvider,
  StudioContext,
  type StudioProviderProps,
  type StudioContextValue,
} from "./StudioProvider.js";

export {
  useStudio,
  type UseStudioValue,
} from "./useStudio.js";

export { StudioHotkeys } from "./StudioHotkeys.js";
export { SourceEditor, type SourceEditorProps } from "./SourceEditor.js";
export {
  DiagnosticsPanel,
  type DiagnosticsPanelProps,
} from "./DiagnosticsPanel.js";
export { PlanPanel } from "./PlanPanel.js";
export { SnapshotTree } from "./SnapshotTree.js";
export {
  HistoryTimeline,
  type HistoryTimelineProps,
} from "./HistoryTimeline.js";

export { COLORS, FONT_STACK, MONO_STACK } from "./style-tokens.js";

export {
  SchemaGraphView,
  type SchemaGraphViewProps,
} from "./SchemaGraphView/SchemaGraphView.js";
export {
  buildGraphModel,
  fromLocalKey,
  identityFateGlyph,
  toLocalKey,
  type GraphEdge,
  type GraphEdgeRelation,
  type GraphModel,
  type GraphNode,
  type GraphNodeId,
  type GraphNodeKind,
  type SnapshotFate,
} from "./SchemaGraphView/graph-model.js";
export {
  GraphLayoutCache,
  runLayout,
  type LayoutOptions,
  type NodePosition,
  type PositionMap,
} from "./SchemaGraphView/layout.js";
export {
  buildGraphFocusLens,
  normalizeSpan,
  resolveFocusRoots,
  type GraphFocusGroup,
  type GraphFocusGroupLabel,
  type GraphFocusLens,
  type GraphFocusOrigin,
} from "./SchemaGraphView/focus-lens.js";

export {
  InteractionEditor,
  type InteractionEditorProps,
} from "./InteractionEditor/InteractionEditor.js";
export {
  ActionForm,
  type ActionFormProps,
} from "./InteractionEditor/ActionForm.js";
export {
  createIntentArgsForValue,
  toCreateIntentArg,
} from "./InteractionEditor/action-intent.js";
export {
  collectBlockerPaths,
} from "./InteractionEditor/blocker-paths.js";
export {
  BlockerList,
  type BlockerListProps,
} from "./InteractionEditor/BlockerList.js";
export {
  SimulatePreview,
  type SimulatePreviewProps,
} from "./InteractionEditor/SimulatePreview.js";
export {
  collectSimulationDiffs,
  diffSnapshots,
  extractSimulationSnapshot,
  resolveValueAtPath,
  sortPaths,
  summarizePreviewValue,
  tokenizePath,
  type SnapshotDiff,
  type SnapshotLike,
} from "./InteractionEditor/snapshot-diff.js";
export {
  useJsonDraft,
  type UseJsonDraftOptions,
  type UseJsonDraftValue,
} from "./InteractionEditor/useJsonDraft.js";
export {
  ensureAtPath,
  getAtPath,
  isPresentAtPath,
  pathToKey,
  removeAtPath,
  setAtPath,
  type FormPath,
  type FormPathSegment,
} from "./InteractionEditor/form-path-utils.js";
export {
  defaultValueFor,
  createInitialFormValue,
  descriptorForAction,
  descriptorForActionSpec,
  fromFieldSpec,
  fromTypeDefinition,
  type ArrayDescriptor,
  type EnumDescriptor,
  type EnumOption,
  type EnumOptionValue,
  type FormDescriptor,
  type FormDescriptorCommon,
  type JsonDescriptor,
  type ObjectDescriptor,
  type ObjectField,
  type PrimitiveDescriptor,
  type PrimitiveKind,
  type RecordDescriptor,
} from "./InteractionEditor/field-descriptor.js";
