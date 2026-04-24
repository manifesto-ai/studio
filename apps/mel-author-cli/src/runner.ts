import {
  buildMelAuthorSystemPrompt,
  buildMelAuthorUserPrompt,
  classifyMelAuthorDraftFailure,
  createMelAuthorFailureReport,
  createMelAuthorLifecycle,
  createMelAuthorTools,
  createMelAuthorWorkspace,
  MEL_AUTHOR_AGENT_MEL,
  type MelAuthorFailureKind,
  type MelAuthorFailureReport,
  type MelAuthorFinalDraft,
  type MelAuthorLineageOutput,
  type MelAuthorTool,
  type MelAuthorToolTraceEntry,
  type MelAuthorToolRunResult,
} from "@manifesto-ai/studio-mel-author-agent";
import { createMelAuthorGuideIndex } from "@manifesto-ai/studio-mel-author-agent/guide";
import {
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
  type ToolSet,
} from "ai";
import {
  readAuthorModelConfig,
  resolveAuthorModel,
  type AuthorModelConfig,
} from "./model.js";

export type MelAuthorCliStrategy = "lens" | "full-source";

export type GenerateAuthorText = (
  options: Parameters<typeof generateText>[0],
) => Promise<unknown>;

export type MelAuthorCliRunInput = {
  readonly source: string;
  readonly request: string;
  readonly sourcePath?: string;
  readonly title?: string;
  readonly maxSteps?: number;
  readonly temperature?: number;
  readonly strategy?: MelAuthorCliStrategy;
  readonly env?: NodeJS.ProcessEnv;
  readonly generate?: GenerateAuthorText;
};

export type MelAuthorCliRunReport = {
  readonly ok: boolean;
  readonly kind?: "invalid_input" | "runtime_error";
  readonly message?: string;
  readonly output?: MelAuthorFinalDraft;
  readonly failureReport?: MelAuthorFailureReport;
  readonly text?: string;
  readonly finishReason?: string;
  readonly toolCallCount: number;
  readonly toolTrace: readonly MelAuthorToolTraceEntry[];
  readonly authorLineage?: MelAuthorLineageOutput;
  readonly strategy: MelAuthorCliStrategy;
  readonly model: AuthorModelConfig;
  readonly sourcePath?: string;
  readonly request: string;
};

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TEMPERATURE = 0.2;
const LENS_TOOL_NAMES = new Set([
  "inspectSourceOutline",
  "readSourceRange",
  "readDeclaration",
  "findSource",
  "patchDeclaration",
]);

const authorGuideIndex = createMelAuthorGuideIndex();

export async function runMelAuthorAgent(
  input: MelAuthorCliRunInput,
): Promise<MelAuthorCliRunReport> {
  const strategy = input.strategy ?? "lens";
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const env = input.env ?? process.env;
  const model = resolveAuthorModel(env);
  const modelConfig =
    model.kind === "ok" ? model.config : readAuthorModelConfig(env);

  if (model.kind === "error") {
    const failureReport = createMelAuthorFailureReport({
      failureKind: "provider_error",
      summary: model.message,
      retryAdvice: "Fix the model provider environment and rerun the CLI.",
    });
    return {
      ok: false,
      kind: "runtime_error",
      message: failureReport.summary,
      failureReport,
      toolCallCount: 0,
      toolTrace: [],
      strategy,
      model: modelConfig,
      sourcePath: input.sourcePath,
      request: input.request,
    };
  }

  const workspace = createMelAuthorWorkspace({ source: input.source });
  const lifecycle = await createMelAuthorLifecycle({ request: input.request });

  try {
    const authorTools = selectToolsForStrategy(
      createMelAuthorTools(workspace, {
        guideIndex: authorGuideIndex,
        lifecycle,
      }),
      strategy,
    );
    const result = await (input.generate ?? generateText)({
      model: model.model,
      system: buildStrategySystemPrompt(strategy, input.request),
      prompt: buildMelAuthorUserPrompt(input.request),
      tools: toSdkTools(authorTools),
      stopWhen: [
        stepCountIs(maxSteps),
        ({ steps }: { readonly steps: readonly unknown[] }) =>
          hasFinalizeToolResult(steps),
      ],
      temperature: input.temperature ?? DEFAULT_TEMPERATURE,
    });

    const toolTrace = buildToolTrace(result);
    const toolCallCount = countToolCalls(result);
    const finalized = findFinalDraft(result);
    if (finalized !== null) {
      const failureReport = classifyMelAuthorDraftFailure({
        draft: finalized,
        originalSource: input.source,
        toolTrace,
        finishReason: readFinishReason(result),
        toolCallCount,
      });
      if (failureReport !== null) {
        return failureReportResult({
          failureReport,
          lifecycle: lifecycle.getLineage(),
          strategy,
          model: modelConfig,
          sourcePath: input.sourcePath,
          request: input.request,
          text: readText(result),
          toolTrace,
          toolCallCount,
        });
      }
      return {
        ok: true,
        output: finalized,
        text: readText(result),
        finishReason: readFinishReason(result),
        toolCallCount,
        toolTrace,
        authorLineage: lifecycle.getLineage(),
        strategy,
        model: modelConfig,
        sourcePath: input.sourcePath,
        request: input.request,
      };
    }

    const failureKind = classifyIncompleteAuthorRun(
      result,
      maxSteps,
      toolTrace,
    );
    if (failureKind === "stalled") {
      await lifecycle.markStalled("read_source_only_stop");
    }
    const fallback = await workspace.finalize({
      title: input.title,
      rationale:
        readText(result).trim() === ""
          ? "MEL Author Agent stopped before calling finalize."
          : readText(result),
    });
    const failureReport = createMelAuthorFailureReport({
      failureKind,
      summary: summarizeIncompleteAuthorRun(failureKind),
      diagnostics: fallback.ok ? fallback.output.diagnostics : [],
      toolTrace,
      source: workspace.readSource().source,
      retryAdvice: retryAdviceForFailureKind(failureKind),
      finishReason: readFinishReason(result),
      toolCallCount,
    });
    return failureReportResult({
      failureReport,
      lifecycle: lifecycle.getLineage(),
      strategy,
      model: modelConfig,
      sourcePath: input.sourcePath,
      request: input.request,
      text: readText(result),
      toolTrace,
      toolCallCount,
    });
  } catch (err) {
    const failureReport = createMelAuthorFailureReport({
      failureKind: "provider_error",
      summary: `MEL Author Agent failed before producing a draft: ${
        err instanceof Error ? err.message : String(err)
      }`,
      retryAdvice:
        "Retry after checking the model provider status and CLI input.",
    });
    return {
      ok: false,
      kind: "runtime_error",
      message: failureReport.summary,
      failureReport,
      toolCallCount: 0,
      toolTrace: [],
      authorLineage: lifecycle.getLineage(),
      strategy,
      model: modelConfig,
      sourcePath: input.sourcePath,
      request: input.request,
    };
  }
}

function buildStrategySystemPrompt(
  strategy: MelAuthorCliStrategy,
  request: string,
): string {
  if (strategy === "lens") {
    return buildMelAuthorSystemPrompt({ request });
  }

  return [
    "You are the MEL Author Agent. Your job is to draft safe, focused edits to a user's Manifesto MEL source inside an ephemeral workspace.",
    "",
    "The workspace is disposable. Never claim the user's real source was changed. Your final output must be produced by calling finalize after the current workspace source builds cleanly, unless the request cannot be satisfied.",
    "Your tool calls are recorded into your lifecycle lineage. finalize is accepted only after at least one source mutation and a clean build.",
    "",
    "# CLI Strategy Override: full-source",
    "- Start by calling build, then readSource.",
    "- Use replaceSource when a complete-source rewrite is clearer; use patchSource for a tight line/column edit.",
    "- Do not stop after explaining the edit. Mutate the workspace source, build, then finalize.",
    "- After every source mutation, call build before reasoning about graph, why, whyNot, or simulate.",
    "- If MEL syntax, builtins, patch operations, guards, effects, annotations, or system values are uncertain, call searchAuthorGuide before editing.",
    "- If build returns diagnostics, searchAuthorGuide with source:\"error\" using the diagnostic code/message before retrying the edit.",
    "- Return errors as workspace diagnostics; do not pretend invalid MEL is verified.",
    "",
    "# Your Own MEL",
    "This describes your authoring lifecycle. It is your identity, not the user's domain.",
    "```mel",
    MEL_AUTHOR_AGENT_MEL,
    "```",
  ].join("\n");
}

function selectToolsForStrategy(
  tools: readonly MelAuthorTool<unknown, unknown>[],
  strategy: MelAuthorCliStrategy,
): readonly MelAuthorTool<unknown, unknown>[] {
  if (strategy === "lens") return tools;
  return tools.filter((candidate) => !LENS_TOOL_NAMES.has(candidate.name));
}

function toSdkTools(
  tools: readonly MelAuthorTool<unknown, unknown>[],
): ToolSet {
  return Object.fromEntries(
    tools.map((authorTool) => [
      authorTool.name,
      tool({
        description: authorTool.description,
        inputSchema: jsonSchema(authorTool.jsonSchema as never),
        execute: async (toolInput: unknown) => authorTool.run(toolInput),
      }),
    ]),
  ) as ToolSet;
}

function failureReportResult(input: {
  readonly failureReport: MelAuthorFailureReport;
  readonly lifecycle: MelAuthorLineageOutput;
  readonly strategy: MelAuthorCliStrategy;
  readonly model: AuthorModelConfig;
  readonly sourcePath?: string;
  readonly request: string;
  readonly text: string;
  readonly toolTrace: readonly MelAuthorToolTraceEntry[];
  readonly toolCallCount: number;
}): MelAuthorCliRunReport {
  return {
    ok: false,
    kind:
      input.failureReport.failureKind === "unchanged_source" ||
      input.failureReport.failureKind === "ambiguous_request"
        ? "invalid_input"
        : "runtime_error",
    message: input.failureReport.summary,
    failureReport: input.failureReport,
    text: input.text,
    finishReason: input.failureReport.finishReason,
    toolCallCount: input.toolCallCount,
    toolTrace: input.toolTrace,
    authorLineage: input.lifecycle,
    strategy: input.strategy,
    model: input.model,
    sourcePath: input.sourcePath,
    request: input.request,
  };
}

function findFinalDraft(result: unknown): MelAuthorFinalDraft | null {
  for (const toolResult of allToolResults(result)) {
    if (toolResultName(toolResult) !== "finalize") continue;
    const output = toolResultOutput(toolResult);
    if (isToolRunResult(output) && output.ok && isFinalDraft(output.output)) {
      return output.output;
    }
  }
  return null;
}

function hasFinalizeToolResult(steps: readonly unknown[]): boolean {
  return steps.some((step) =>
    allToolResults(step).some(
      (toolResult) => toolResultName(toolResult) === "finalize",
    ),
  );
}

function countToolCalls(result: unknown): number {
  let count = 0;
  const record = asRecord(result);
  const steps = Array.isArray(record?.steps) ? record.steps : [result];
  for (const step of steps) {
    const stepRecord = asRecord(step);
    const calls = stepRecord?.toolCalls;
    if (Array.isArray(calls)) count += calls.length;
  }
  return count;
}

function buildToolTrace(result: unknown): readonly MelAuthorToolTraceEntry[] {
  return allToolResults(result).map((toolResult) => {
    const toolName = toolResultName(toolResult) ?? "(unknown)";
    const output = toolResultOutput(toolResult);
    const toolRun = isToolRunResult(output) ? output : null;
    if (toolRun !== null) {
      if (toolRun.ok) {
        return {
          toolName,
          ok: true,
          summary: summarizeToolOutput(toolName, toolRun.output),
          inputPreview: previewJson(toolResultInput(toolResult)),
          outputPreview: previewJson(toolRun.output),
        };
      }
      return {
        toolName,
        ok: false,
        summary: toolRun.message,
        inputPreview: previewJson(toolResultInput(toolResult)),
        outputPreview: previewJson(toolRun.detail ?? toolRun.message),
        errorKind: toolRun.kind,
      };
    }
    return {
      toolName,
      ok: output !== undefined,
      summary:
        output === undefined
          ? "tool result had no output"
          : `tool returned ${previewJson(output)}`,
      inputPreview: previewJson(toolResultInput(toolResult)),
      outputPreview: previewJson(output),
    };
  });
}

function classifyIncompleteAuthorRun(
  result: unknown,
  maxSteps: number,
  toolTrace: readonly MelAuthorToolTraceEntry[],
): MelAuthorFailureKind {
  if (toolTrace.some((entry) => !entry.ok)) return "tool_error";
  if (isReadSourceOnlyStop(result, toolTrace)) return "stalled";
  if (countSteps(result) >= maxSteps) return "max_steps";
  return "missing_finalize";
}

function summarizeIncompleteAuthorRun(kind: MelAuthorFailureKind): string {
  if (kind === "stalled") {
    return "MEL Author Agent read the workspace source and stopped without attempting a source mutation.";
  }
  if (kind === "tool_error") {
    return "MEL Author Agent stopped after a tool error before producing a finalized draft.";
  }
  if (kind === "max_steps") {
    return "MEL Author Agent reached its step limit before producing a finalized draft.";
  }
  return "MEL Author Agent stopped before calling finalize.";
}

function retryAdviceForFailureKind(kind: MelAuthorFailureKind): string {
  if (kind === "stalled") {
    return "Retry with the lens strategy or explicitly require a source mutation before explanation.";
  }
  if (kind === "tool_error") {
    return "Inspect the tool error, narrow the edit, and retry with an explicit instruction to rebuild before finalizing.";
  }
  if (kind === "max_steps") {
    return "Retry with a smaller scoped request or a stricter instruction to make one minimal edit and finalize.";
  }
  return "Retry by asking the author to call finalize after the next clean build.";
}

function allToolResults(resultOrStep: unknown): readonly unknown[] {
  const record = asRecord(resultOrStep);
  if (record === null) return [];
  const direct = Array.isArray(record.toolResults) ? record.toolResults : [];
  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (steps.length === 0) return direct;
  return [...direct, ...steps.flatMap((step) => allToolResults(step))];
}

function toolResultName(value: unknown): string | null {
  const record = asRecord(value);
  if (record === null) return null;
  return typeof record.toolName === "string" ? record.toolName : null;
}

function toolResultOutput(value: unknown): unknown {
  const record = asRecord(value);
  if (record === null) return undefined;
  if ("output" in record) return record.output;
  if ("result" in record) return record.result;
  return undefined;
}

function toolResultInput(value: unknown): unknown {
  const record = asRecord(value);
  if (record === null) return undefined;
  if ("input" in record) return record.input;
  return undefined;
}

function isToolRunResult(
  value: unknown,
): value is MelAuthorToolRunResult<unknown> {
  const record = asRecord(value);
  return record !== null && typeof record.ok === "boolean";
}

function isFinalDraft(value: unknown): value is MelAuthorFinalDraft {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.title === "string" &&
    typeof record.rationale === "string" &&
    typeof record.proposedSource === "string" &&
    (record.status === "verified" || record.status === "invalid")
  );
}

function readFinishReason(result: unknown): string | undefined {
  const value = asRecord(result)?.finishReason;
  return typeof value === "string" ? value : undefined;
}

function readText(result: unknown): string {
  const value = asRecord(result)?.text;
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function countSteps(result: unknown): number {
  const record = asRecord(result);
  const steps = Array.isArray(record?.steps) ? record.steps : [];
  return steps.length;
}

function isReadSourceOnlyStop(
  result: unknown,
  toolTrace: readonly MelAuthorToolTraceEntry[],
): boolean {
  const record = asRecord(result);
  return (
    record?.finishReason === "stop" &&
    toolTrace.length === 1 &&
    toolTrace[0]?.ok === true &&
    toolTrace[0]?.toolName === "readSource"
  );
}

function summarizeToolOutput(toolName: string, output: unknown): string {
  const record = asRecord(output);
  if (record !== null && typeof record.summary === "string") {
    return record.summary;
  }
  if (toolName === "readSource" && record !== null) {
    const lineCount = record.lineCount;
    return typeof lineCount === "number"
      ? `read ${lineCount} source line${lineCount === 1 ? "" : "s"}`
      : "read source";
  }
  if (toolName === "inspectSourceOutline" && record !== null) {
    const entryCount = record.entryCount;
    return typeof entryCount === "number"
      ? `inspected ${entryCount} source declaration${
          entryCount === 1 ? "" : "s"
        }`
      : "inspected source outline";
  }
  if (
    (toolName === "readSourceRange" || toolName === "readDeclaration") &&
    record !== null
  ) {
    const lineCount = record.lineCount;
    return typeof lineCount === "number"
      ? `read ${lineCount} scoped source line${lineCount === 1 ? "" : "s"}`
      : "read scoped source";
  }
  if (toolName === "findSource" && record !== null) {
    const hitCount = record.hitCount;
    return typeof hitCount === "number"
      ? `found ${hitCount} source hit${hitCount === 1 ? "" : "s"}`
      : "searched source";
  }
  if (toolName === "patchDeclaration" && record !== null) {
    return record.changed === true
      ? "patched declaration"
      : "declaration patch was unchanged";
  }
  if (toolName === "finalize" && record !== null) {
    const status = record.status;
    return typeof status === "string"
      ? `finalized ${status} draft`
      : "finalized draft";
  }
  if (toolName === "searchAuthorGuide" && record !== null) {
    const hitCount = record.hitCount;
    return typeof hitCount === "number"
      ? `found ${hitCount} guide hit${hitCount === 1 ? "" : "s"}`
      : "searched author guide";
  }
  return `${toolName} completed`;
}

function previewJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const text =
      typeof value === "string" ? value : JSON.stringify(value, null, 0);
    return text.length <= 360 ? text : text.slice(0, 357) + "...";
  } catch {
    const text = String(value);
    return text.length <= 360 ? text : text.slice(0, 357) + "...";
  }
}
