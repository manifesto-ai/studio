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
  createMelAuthorTools,
  createMelAuthorWorkspace,
  type MelAuthorFinalDraft,
  type MelAuthorTool,
  type MelAuthorToolRunResult,
} from "@manifesto-ai/studio-mel-author-agent";
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
    return new Response(
      JSON.stringify({
        ok: false,
        kind: "runtime_error",
        message: "rate limit exceeded",
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

  const workspace = createMelAuthorWorkspace({ source: parsed.data.source });
  const authorTools = createMelAuthorTools(workspace);
  const sdkTools = toSdkTools(authorTools);
  const maxSteps = parsed.data.maxSteps ?? 8;

  try {
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

    const finalized = findFinalDraft(result);
    if (finalized !== null) {
      return jsonOk({
        ok: true,
        output: finalized,
        text: result.text,
        finishReason: result.finishReason,
        toolCallCount: countToolCalls(result),
      });
    }

    // If the model edited the workspace but forgot to call finalize,
    // still return a deterministic build-backed draft. This keeps the
    // outer proposal UI from failing just because the final tool call
    // was omitted.
    const fallback = await workspace.finalize({
      title: parsed.data.title,
      rationale:
        result.text.trim() === ""
          ? "MEL Author Agent stopped before calling finalize."
          : result.text,
    });
    if (!fallback.ok) {
      return jsonOk(fallback);
    }
    return jsonOk({
      ok: true,
      output: fallback.output,
      text: result.text,
      finishReason: result.finishReason,
      toolCallCount: countToolCalls(result),
    });
  } catch (err) {
    return jsonOk({
      ok: false,
      kind: "runtime_error",
      message: err instanceof Error ? err.message : String(err),
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
