import type {
  MelAuthorDiagnostic,
  MelAuthorFailureKind,
  MelAuthorFailureReport,
  MelAuthorFinalDraft,
  MelAuthorToolTraceEntry,
} from "./types.js";

const SOURCE_EXCERPT_CAP = 1600;
const TRACE_CAP = 16;

export type CreateMelAuthorFailureReportInput = {
  readonly failureKind: MelAuthorFailureKind;
  readonly summary: string;
  readonly diagnostics?: readonly MelAuthorDiagnostic[];
  readonly toolTrace?: readonly MelAuthorToolTraceEntry[];
  readonly source?: string;
  readonly nextQuestion?: string;
  readonly retryAdvice?: string;
  readonly finishReason?: string;
  readonly toolCallCount?: number;
};

export type ClassifyMelAuthorDraftFailureInput = {
  readonly draft: MelAuthorFinalDraft;
  readonly originalSource: string;
  readonly toolTrace?: readonly MelAuthorToolTraceEntry[];
  readonly finishReason?: string;
  readonly toolCallCount?: number;
};

export function createMelAuthorFailureReport(
  input: CreateMelAuthorFailureReportInput,
): MelAuthorFailureReport {
  return {
    failureKind: input.failureKind,
    summary: input.summary,
    diagnostics: input.diagnostics ?? [],
    toolTrace: (input.toolTrace ?? []).slice(-TRACE_CAP),
    lastSourceExcerpt:
      input.source === undefined
        ? ""
        : createSourceExcerpt(input.source, input.diagnostics ?? []),
    nextQuestion: normalizeOptional(input.nextQuestion),
    retryAdvice: normalizeOptional(input.retryAdvice),
    finishReason: normalizeOptional(input.finishReason),
    toolCallCount: input.toolCallCount,
  };
}

export function classifyMelAuthorDraftFailure(
  input: ClassifyMelAuthorDraftFailureInput,
): MelAuthorFailureReport | null {
  if (input.draft.status === "invalid") {
    return createMelAuthorFailureReport({
      failureKind: "compile_error",
      summary: input.draft.summary,
      diagnostics: input.draft.diagnostics,
      toolTrace: input.toolTrace,
      source: input.draft.proposedSource,
      retryAdvice:
        "Repair the reported MEL diagnostics, rebuild the workspace, and finalize only after the draft builds cleanly.",
      finishReason: input.finishReason,
      toolCallCount: input.toolCallCount,
    });
  }

  if (input.draft.proposedSource === input.originalSource) {
    return createMelAuthorFailureReport({
      failureKind: "unchanged_source",
      summary: "MEL Author Agent returned unchanged source.",
      diagnostics: input.draft.diagnostics,
      toolTrace: input.toolTrace,
      source: input.draft.proposedSource,
      retryAdvice:
        "Make a concrete source edit that satisfies the user request before finalizing.",
      finishReason: input.finishReason,
      toolCallCount: input.toolCallCount,
    });
  }

  return null;
}

function createSourceExcerpt(
  source: string,
  diagnostics: readonly MelAuthorDiagnostic[],
): string {
  if (source.length <= SOURCE_EXCERPT_CAP) return source;
  const firstDiagnostic = diagnostics[0];
  if (firstDiagnostic !== undefined) {
    const lines = source.split(/\r?\n/);
    const center = Math.max(1, firstDiagnostic.line);
    const start = Math.max(1, center - 10);
    const end = Math.min(lines.length, center + 10);
    const excerpt = lines
      .slice(start - 1, end)
      .map((line, index) => `${String(start + index).padStart(4, " ")} ${line}`)
      .join("\n");
    if (excerpt.length <= SOURCE_EXCERPT_CAP) return excerpt;
    return excerpt.slice(0, SOURCE_EXCERPT_CAP - 3) + "...";
  }
  return source.slice(0, SOURCE_EXCERPT_CAP - 3) + "...";
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}
