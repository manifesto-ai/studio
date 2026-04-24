import type {
  EffectHandler,
  Marker,
  SourceSpan,
  WorldLineage,
} from "@manifesto-ai/studio-core";

export type MelAuthorToolRunOk<TOut> = {
  readonly ok: true;
  readonly output: TOut;
};

export type MelAuthorToolRunErr = {
  readonly ok: false;
  readonly kind: "invalid_input" | "runtime_error";
  readonly message: string;
  readonly detail?: unknown;
};

export type MelAuthorToolRunResult<TOut> =
  | MelAuthorToolRunOk<TOut>
  | MelAuthorToolRunErr;

export type MelAuthorTool<TInput, TOutput> = {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly run: (input: TInput) => Promise<MelAuthorToolRunResult<TOutput>>;
};

export type MelAuthorDiagnostic = {
  readonly severity: Marker["severity"];
  readonly message: string;
  readonly line: number;
  readonly column: number;
  readonly code?: string;
};

export type MelAuthorFailureKind =
  | "compile_error"
  | "unchanged_source"
  | "max_steps"
  | "missing_finalize"
  | "stalled"
  | "tool_error"
  | "ambiguous_request"
  | "provider_error";

export type MelAuthorToolTraceEntry = {
  readonly toolName: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly inputPreview?: string;
  readonly outputPreview?: string;
  readonly errorKind?: "invalid_input" | "runtime_error";
};

export type MelAuthorFailureReport = {
  readonly failureKind: MelAuthorFailureKind;
  readonly summary: string;
  readonly diagnostics: readonly MelAuthorDiagnostic[];
  readonly toolTrace: readonly MelAuthorToolTraceEntry[];
  readonly lastSourceExcerpt: string;
  readonly nextQuestion?: string;
  readonly retryAdvice?: string;
  readonly finishReason?: string;
  readonly toolCallCount?: number;
};

export type MelAuthorGuideSource = "reference" | "syntax" | "error";

export type MelAuthorGuideDocument = {
  readonly source: MelAuthorGuideSource;
  readonly text: string;
};

export type MelAuthorGuideChunk = {
  readonly id: string;
  readonly source: MelAuthorGuideSource;
  readonly headingPath: readonly string[];
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
};

export type MelAuthorGuideIndex = {
  readonly chunks: readonly MelAuthorGuideChunk[];
};

export type MelAuthorGuideSearchInput = {
  readonly query: string;
  readonly source?: MelAuthorGuideSource;
  readonly limit?: number;
};

export type MelAuthorGuideHit = {
  readonly id: string;
  readonly source: MelAuthorGuideSource;
  readonly headingPath: readonly string[];
  readonly excerpt: string;
  readonly score: number;
  readonly lineStart: number;
  readonly lineEnd: number;
};

export type MelAuthorGuideSearchOutput = {
  readonly query: string;
  readonly hitCount: number;
  readonly hits: readonly MelAuthorGuideHit[];
};

export type MelAuthorLineageOutput = {
  readonly lineage: WorldLineage;
  readonly snapshot: unknown | null;
  readonly worldCount: number;
  readonly headWorldId: string | null;
};

export type MelAuthorLifecycleResult = {
  readonly ok: boolean;
  readonly action: string;
  readonly kind?: string;
  readonly message?: string;
};

export type MelAuthorLifecycle = {
  readonly recordReadSource: () => Promise<MelAuthorLifecycleResult>;
  readonly recordMutationAttempt: (
    toolName: string,
    changed: boolean,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly recordBuild: (
    status: "ok" | "fail",
    diagnosticCount: number,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly recordGuideSearch: () => Promise<MelAuthorLifecycleResult>;
  readonly recordInspection: (
    toolName: string,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly recordSimulation: () => Promise<MelAuthorLifecycleResult>;
  readonly recordToolError: (
    toolName: string,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly markStalled: (
    reason: string,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly retry: () => Promise<MelAuthorLifecycleResult>;
  readonly giveUp: (reason: string) => Promise<MelAuthorLifecycleResult>;
  readonly recordFinalize: (
    proposalId: string,
  ) => Promise<MelAuthorLifecycleResult>;
  readonly getLineage: () => MelAuthorLineageOutput;
};

export type MelAuthorWorkspaceOptions = {
  readonly source: string;
  readonly effects?: Record<string, EffectHandler>;
  readonly traceBufferSize?: number;
};

export type MelAuthorBuildOutput = {
  readonly status: "ok" | "fail";
  readonly summary: string;
  readonly schemaHash: string | null;
  readonly diagnostics: readonly MelAuthorDiagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly actionNames: readonly string[];
  readonly stateFieldNames: readonly string[];
  readonly computedNames: readonly string[];
};

export type MelAuthorSourceOutput = {
  readonly source: string;
  readonly length: number;
  readonly lineCount: number;
  readonly version: number;
};

export type MelAuthorMutationOutput = {
  readonly changed: boolean;
  readonly length: number;
  readonly lineCount: number;
  readonly version: number;
  readonly summary: string;
};

export type MelAuthorPatchInput = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly replacement: string;
};

export type MelAuthorSourceLensKind =
  | "domain"
  | "type"
  | "state"
  | "computed"
  | "action";

export type MelAuthorSourceOutlineEntry = {
  readonly target: string;
  readonly localKey: string;
  readonly kind: MelAuthorSourceLensKind;
  readonly name: string;
  readonly span: SourceSpan | null;
  readonly preview: string;
};

export type MelAuthorSourceOutlineOutput = {
  readonly schemaHash: string;
  readonly version: number;
  readonly entryCount: number;
  readonly entries: readonly MelAuthorSourceOutlineEntry[];
  readonly domain: MelAuthorSourceOutlineEntry | null;
  readonly types: readonly MelAuthorSourceOutlineEntry[];
  readonly stateFields: readonly MelAuthorSourceOutlineEntry[];
  readonly computed: readonly MelAuthorSourceOutlineEntry[];
  readonly actions: readonly MelAuthorSourceOutlineEntry[];
};

export type MelAuthorSourceRangeInput = {
  readonly startLine: number;
  readonly endLine: number;
  readonly contextLines?: number;
};

export type MelAuthorSourceRangeOutput = {
  readonly source: string;
  readonly numberedPreview: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly requestedStartLine: number;
  readonly requestedEndLine: number;
  readonly lineCount: number;
  readonly totalLineCount: number;
  readonly truncated: boolean;
  readonly version: number;
};

export type MelAuthorReadDeclarationInput = {
  readonly target: string;
  readonly contextLines?: number;
};

export type MelAuthorReadDeclarationOutput = MelAuthorSourceRangeOutput & {
  readonly target: string;
  readonly localKey: string;
  readonly schemaHash: string;
  readonly span: SourceSpan;
};

export type MelAuthorFindSourceInput = {
  readonly query: string;
  readonly kind?: MelAuthorSourceLensKind;
  readonly limit?: number;
};

export type MelAuthorFindSourceHit = MelAuthorSourceOutlineEntry & {
  readonly score: number;
};

export type MelAuthorFindSourceOutput = {
  readonly query: string;
  readonly hitCount: number;
  readonly hits: readonly MelAuthorFindSourceHit[];
};

export type MelAuthorPatchDeclarationInput = {
  readonly target: string;
  readonly replacement: string;
};

export type MelAuthorPatchDeclarationOutput = MelAuthorMutationOutput & {
  readonly target: string;
  readonly localKey: string;
  readonly span: SourceSpan;
};

export type MelAuthorGraphOutput = {
  readonly schemaHash: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly truncated: boolean;
};

export type MelAuthorLocateOutput = {
  readonly target: string;
  readonly localKey: string;
  readonly schemaHash: string;
  readonly span: SourceSpan;
  readonly preview: string;
};

export type MelAuthorIntentInput = {
  readonly action: string;
  readonly args?: readonly unknown[];
};

export type MelAuthorIntentOutput = {
  readonly action: string;
  readonly status: "blocked" | "simulated";
  readonly available: boolean;
  readonly dispatchable: boolean;
  readonly changedPaths: readonly string[];
  readonly newAvailableActions: readonly string[];
  readonly requirementCount: number;
  readonly requirements: readonly MelAuthorRequirementSummary[];
  readonly blockers: readonly MelAuthorBlockerSummary[];
  readonly schemaHash: string | null;
  readonly summary: string;
};

export type MelAuthorRequirementSummary = {
  readonly id?: string;
  readonly type?: string;
};

export type MelAuthorBlockerSummary = {
  readonly layer: string;
  readonly description?: string;
  readonly evaluatedResult?: unknown;
};

export type MelAuthorExplanationOutput = {
  readonly action: string;
  readonly explanation: unknown;
};

export type MelAuthorWhyNotOutput = {
  readonly action: string;
  readonly blockers: readonly unknown[] | null;
};

export type MelAuthorFinalizeInput = {
  readonly title?: string;
  readonly rationale?: string;
};

export type MelAuthorFinalDraft = {
  readonly title: string;
  readonly rationale: string;
  readonly proposedSource: string;
  readonly status: "verified" | "invalid";
  readonly diagnostics: readonly MelAuthorDiagnostic[];
  readonly schemaHash: string | null;
  readonly summary: string;
};

export type MelAuthorWorkspace = {
  readonly getSource: () => string;
  readonly readSource: () => MelAuthorSourceOutput;
  readonly replaceSource: (
    nextSource: string,
  ) => MelAuthorToolRunResult<MelAuthorMutationOutput>;
  readonly patchSource: (
    patch: MelAuthorPatchInput,
  ) => MelAuthorToolRunResult<MelAuthorMutationOutput>;
  readonly build: () => Promise<MelAuthorBuildOutput>;
  readonly inspectSourceOutline: () => MelAuthorToolRunResult<MelAuthorSourceOutlineOutput>;
  readonly readSourceRange: (
    input: MelAuthorSourceRangeInput,
  ) => MelAuthorToolRunResult<MelAuthorSourceRangeOutput>;
  readonly readDeclaration: (
    input: MelAuthorReadDeclarationInput,
  ) => MelAuthorToolRunResult<MelAuthorReadDeclarationOutput>;
  readonly findSource: (
    input: MelAuthorFindSourceInput,
  ) => MelAuthorToolRunResult<MelAuthorFindSourceOutput>;
  readonly patchDeclaration: (
    input: MelAuthorPatchDeclarationInput,
  ) => MelAuthorToolRunResult<MelAuthorPatchDeclarationOutput>;
  readonly inspectGraph: (options?: {
    readonly nodeLimit?: number;
    readonly edgeLimit?: number;
  }) => MelAuthorToolRunResult<MelAuthorGraphOutput>;
  readonly locateDeclaration: (
    target: string,
  ) => MelAuthorToolRunResult<MelAuthorLocateOutput>;
  readonly simulate: (
    input: MelAuthorIntentInput,
  ) => MelAuthorToolRunResult<MelAuthorIntentOutput>;
  readonly why: (
    input: MelAuthorIntentInput,
  ) => MelAuthorToolRunResult<MelAuthorExplanationOutput>;
  readonly whyNot: (
    input: MelAuthorIntentInput,
  ) => MelAuthorToolRunResult<MelAuthorWhyNotOutput>;
  readonly finalize: (
    input?: MelAuthorFinalizeInput,
  ) => Promise<MelAuthorToolRunResult<MelAuthorFinalDraft>>;
};
