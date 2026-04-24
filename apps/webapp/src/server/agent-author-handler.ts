/**
 * Server-side MEL Author Agent runner.
 *
 * The UI agent delegates source-change requests here through the
 * `authorMelProposal` client tool. This handler owns the model call,
 * while the reusable authoring workspace/tools live in
 * `@manifesto-ai/studio-mel-author-agent`.
 */
import {
  buildMelAuthorSystemPrompt,
  buildMelAuthorUserPrompt,
  classifyMelAuthorDraftFailure,
  createMelAuthorFailureReport,
  createMelAuthorLifecycle,
  createMelAuthorTools,
  createMelAuthorWorkspace,
  type MelAuthorFailureKind,
  type MelAuthorFailureReport,
  type MelAuthorFinalDraft,
  type MelAuthorLifecycle,
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
import { z } from "zod";
import { enforceChatRateLimit, identifyRequest } from "./rate-limit.js";
import { resolveAgentModel } from "./agent-chat-handler.js";

const authorGuideIndex = createMelAuthorGuideIndex();

const authorBodyShape = z
  .object({
    source: z.string().min(1),
    request: z.string().min(1),
    title: z.string().optional(),
    maxSteps: z.number().int().min(1).max(12).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

export async function handleAgentAuthor(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonError(405, "method not allowed; use POST");
  }

  const resolvedModel = resolveAgentModel();
  if (resolvedModel.kind === "error") {
    return jsonError(500, resolvedModel.message);
  }

  const identifier = identifyRequest(req);
  const rl = await enforceChatRateLimit(identifier);
  if (rl.kind === "limited") {
    const failureReport = createMelAuthorFailureReport({
      failureKind: "provider_error",
      summary: "MEL Author Agent request was rate limited.",
      retryAdvice: `Retry after ${rl.retryAfterSeconds} second${rl.retryAfterSeconds === 1 ? "" : "s"}.`,
    });
    return new Response(
      JSON.stringify({
        ok: false,
        kind: "runtime_error",
        message: "rate limit exceeded",
        detail: { failureReport },
        retryAfterSeconds: rl.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfterSeconds),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "request body must be JSON");
  }

  const parsed = authorBodyShape.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, `invalid request body: ${parsed.error.message}`);
  }

  const maxSteps = parsed.data.maxSteps ?? 8;
  const workspace = createMelAuthorWorkspace({ source: parsed.data.source });
  let lifecycle: MelAuthorLifecycle | null = null;

  try {
    lifecycle = await createMelAuthorLifecycle({
      request: parsed.data.request,
    });
    const authorTools = createMelAuthorTools(workspace, {
      guideIndex: authorGuideIndex,
      lifecycle,
    });
    const sdkTools = toSdkTools(authorTools);
    const result = await generateText({
      model: resolvedModel.model,
      system: buildMelAuthorSystemPrompt({
        request: parsed.data.request,
      }),
      prompt: buildMelAuthorUserPrompt(parsed.data.request),
      tools: sdkTools,
      stopWhen: [
        stepCountIs(maxSteps),
        ({ steps }) => hasFinalizeToolResult(steps),
      ],
      temperature: parsed.data.temperature ?? 0.2,
      abortSignal: req.signal,
    });

    const toolTrace = buildToolTrace(result);
    const toolCallCount = countToolCalls(result);
    const finalized = findFinalDraft(result);
    if (finalized !== null) {
      const failureReport = classifyMelAuthorDraftFailure({
        draft: finalized,
        originalSource: parsed.data.source,
        toolTrace,
        finishReason: result.finishReason,
        toolCallCount,
      });
      if (failureReport !== null) {
        return jsonOk(authorFailureResult(failureReport, lifecycle.getLineage()));
      }
      return jsonOk({
        ok: true,
        output: finalized,
        text: result.text,
        finishReason: result.finishReason,
        toolCallCount,
        authorLineage: lifecycle.getLineage(),
      });
    }

    const failureKind = classifyIncompleteAuthorRun(result, maxSteps, toolTrace);
    if (failureKind === "stalled") {
      await lifecycle.markStalled("read_source_only_stop");
    }
    const fallback = await workspace.finalize({
      title: parsed.data.title,
      rationale:
        result.text.trim() === ""
          ? "MEL Author Agent stopped before calling finalize."
          : result.text,
    });
    const failureReport = createMelAuthorFailureReport({
      failureKind,
      summary: summarizeIncompleteAuthorRun(failureKind),
      diagnostics: fallback.ok ? fallback.output.diagnostics : [],
      toolTrace,
      source: workspace.getSource(),
      retryAdvice: retryAdviceForFailureKind(failureKind),
      finishReason: result.finishReason,
      toolCallCount,
    });
    return jsonOk(authorFailureResult(failureReport, lifecycle.getLineage()));
  } catch (err) {
    const failureReport = createMelAuthorFailureReport({
      failureKind: "provider_error",
      summary: `MEL Author Agent failed before producing a draft: ${err instanceof Error ? err.message : String(err)}`,
      retryAdvice:
        "Retry after checking the model provider status. Do not apply any source changes from this failed attempt.",
    });
    return jsonOk({
      ok: false,
      kind: "runtime_error",
      message: failureReport.summary,
      detail: {
        failureReport,
        authorLineage: lifecycle?.getLineage(),
      },
    });
  }
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
        execute: async (input: unknown) => authorTool.run(input),
      }),
    ]),
  ) as ToolSet;
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
    return "Retry with an explicit instruction that the next response must call replaceSource or patchSource instead of explaining the edit in text.";
  }
  if (kind === "tool_error") {
    return "Inspect the tool error, narrow the edit, and retry with an explicit instruction to rebuild before finalizing.";
  }
  if (kind === "max_steps") {
    return "Retry with a smaller scoped request or a stricter instruction to make one minimal edit and finalize.";
  }
  return "Retry by asking the author to call finalize after the next clean build.";
}

function authorFailureResult(
  failureReport: MelAuthorFailureReport,
  authorLineage?: MelAuthorLineageOutput,
) {
  return {
    ok: false,
    kind:
      failureReport.failureKind === "unchanged_source" ||
      failureReport.failureKind === "ambiguous_request"
        ? "invalid_input"
        : "runtime_error",
    message: failureReport.summary,
    detail: { failureReport, authorLineage },
  } as const;
}

function allToolResults(resultOrStep: unknown): readonly unknown[] {
  const record = asRecord(resultOrStep);
  if (record === null) return [];
  const direct = Array.isArray(record.toolResults) ? record.toolResults : [];
  const steps = Array.isArray(record.steps) ? record.steps : [];
  if (steps.length === 0) return direct;
  return [
    ...direct,
    ...steps.flatMap((step) => allToolResults(step)),
  ];
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
  if (toolName === "finalize" && record !== null) {
    const status = record.status;
    return typeof status === "string" ? `finalized ${status} draft` : "finalized draft";
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

function jsonOk(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
