import type {
  EffectHandler,
  Marker,
  SourceSpan,
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
