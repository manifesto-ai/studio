export { MEL_AUTHOR_AGENT_MEL } from "./agent-domain.js";
export {
  createMelAuthorLifecycle,
  type CreateMelAuthorLifecycleInput,
} from "./lifecycle.js";
export {
  buildMelAuthorSystemPrompt,
  buildMelAuthorUserPrompt,
  type MelAuthorPromptInput,
} from "./prompt.js";
export { createMelAuthorWorkspace } from "./workspace.js";
export {
  createMelAuthorTools,
  type CreateMelAuthorToolsOptions,
} from "./tools.js";
export {
  createMelAuthorGuideIndexFromDocuments,
  searchMelAuthorGuide,
} from "./guide-search.js";
export {
  classifyMelAuthorDraftFailure,
  createMelAuthorFailureReport,
  type ClassifyMelAuthorDraftFailureInput,
  type CreateMelAuthorFailureReportInput,
} from "./failure-report.js";
export type {
  MelAuthorBlockerSummary,
  MelAuthorBuildOutput,
  MelAuthorDiagnostic,
  MelAuthorExplanationOutput,
  MelAuthorFindSourceHit,
  MelAuthorFindSourceInput,
  MelAuthorFindSourceOutput,
  MelAuthorFailureKind,
  MelAuthorFailureReport,
  MelAuthorFinalDraft,
  MelAuthorFinalizeInput,
  MelAuthorGuideChunk,
  MelAuthorGuideDocument,
  MelAuthorGuideHit,
  MelAuthorGuideIndex,
  MelAuthorGuideSearchInput,
  MelAuthorGuideSearchOutput,
  MelAuthorGuideSource,
  MelAuthorGraphOutput,
  MelAuthorIntentInput,
  MelAuthorIntentOutput,
  MelAuthorLifecycle,
  MelAuthorLifecycleResult,
  MelAuthorLineageOutput,
  MelAuthorLocateOutput,
  MelAuthorMutationOutput,
  MelAuthorPatchDeclarationInput,
  MelAuthorPatchDeclarationOutput,
  MelAuthorPatchInput,
  MelAuthorReadDeclarationInput,
  MelAuthorReadDeclarationOutput,
  MelAuthorRequirementSummary,
  MelAuthorSourceLensKind,
  MelAuthorSourceOutlineEntry,
  MelAuthorSourceOutlineOutput,
  MelAuthorSourceRangeInput,
  MelAuthorSourceRangeOutput,
  MelAuthorSourceOutput,
  MelAuthorTool,
  MelAuthorToolTraceEntry,
  MelAuthorToolRunErr,
  MelAuthorToolRunOk,
  MelAuthorToolRunResult,
  MelAuthorWhyNotOutput,
  MelAuthorWorkspace,
  MelAuthorWorkspaceOptions,
} from "./types.js";
