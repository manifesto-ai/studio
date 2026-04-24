export { MEL_AUTHOR_AGENT_MEL } from "./agent-domain.js";
export {
  buildMelAuthorSystemPrompt,
  buildMelAuthorUserPrompt,
  type MelAuthorPromptInput,
} from "./prompt.js";
export { createMelAuthorWorkspace } from "./workspace.js";
export { createMelAuthorTools } from "./tools.js";
export type {
  MelAuthorBlockerSummary,
  MelAuthorBuildOutput,
  MelAuthorDiagnostic,
  MelAuthorExplanationOutput,
  MelAuthorFinalDraft,
  MelAuthorFinalizeInput,
  MelAuthorGraphOutput,
  MelAuthorIntentInput,
  MelAuthorIntentOutput,
  MelAuthorLocateOutput,
  MelAuthorMutationOutput,
  MelAuthorPatchInput,
  MelAuthorRequirementSummary,
  MelAuthorSourceOutput,
  MelAuthorTool,
  MelAuthorToolRunErr,
  MelAuthorToolRunOk,
  MelAuthorToolRunResult,
  MelAuthorWhyNotOutput,
  MelAuthorWorkspace,
  MelAuthorWorkspaceOptions,
} from "./types.js";
