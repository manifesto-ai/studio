import {
  jsonSchema,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolChoice as AiToolChoice,
  type ToolSet,
} from "ai";
import type {
  AgentMessage,
  AgentToolCall,
  ModelAdapter,
  ModelEvent,
  ModelRequest,
  TokenUsage,
  ToolChoice,
  ToolSpec,
} from "@manifesto-ai/agent-core";

export type AiSdkModelAdapterOptions = {
  readonly name?: string;
  readonly model: LanguageModel;
  readonly maxRetries?: number;
  readonly headers?: Record<string, string>;
};

export function createAiSdkModelAdapter(
  options: AiSdkModelAdapterOptions,
): ModelAdapter {
  return {
    name: options.name ?? "ai-sdk",
    stream: (request) => streamAiSdkModel(request, options),
  };
}

export function buildAiSdkToolSet(
  tools: readonly ToolSpec[],
): ToolSet {
  return Object.fromEntries(
    tools.map((spec) => [
      spec.function.name,
      {
        description: spec.function.description,
        inputSchema: jsonSchema(spec.function.parameters as never),
      },
    ]),
  ) as ToolSet;
}

export function normalizeAiSdkToolChoice(
  value: ToolChoice | undefined,
  tools: ToolSet,
):
  | { readonly kind: "ok"; readonly value: AiToolChoice<ToolSet> | undefined }
  | { readonly kind: "error"; readonly message: string } {
  if (value === undefined) return { kind: "ok", value: undefined };
  if (typeof value === "string") return { kind: "ok", value };
  if (tools[value.toolName] === undefined) {
    return {
      kind: "error",
      message: `invalid toolChoice: unknown tool "${value.toolName}".`,
    };
  }
  return {
    kind: "ok",
    value: { type: "tool", toolName: value.toolName },
  };
}

export function toAiSdkModelMessages(
  messages: readonly AgentMessage[],
): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      const parts: unknown[] = [];
      if (message.content !== "") {
        parts.push({ type: "text", text: message.content });
      }
      if (message.reasoning !== undefined && message.reasoning !== "") {
        parts.push({ type: "reasoning", text: message.reasoning });
      }
      for (const call of message.toolCalls ?? []) {
        parts.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.name,
          input: call.input,
          providerExecuted: call.providerExecuted,
        });
      }
      const firstPart = parts[0] as
        | { readonly type?: string; readonly text?: string }
        | undefined;
      return {
        role: "assistant",
        content: parts.length === 1 && firstPart?.type === "text"
          ? firstPart.text ?? ""
          : parts,
      } as ModelMessage;
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: message.output as never,
          },
        ],
      } as ModelMessage;
    }
    return {
      role: message.role,
      content: message.content,
    } as ModelMessage;
  });
}

async function* streamAiSdkModel(
  request: ModelRequest,
  options: AiSdkModelAdapterOptions,
): AsyncIterable<ModelEvent> {
  const tools = buildAiSdkToolSet(request.tools);
  const toolChoice = normalizeAiSdkToolChoice(request.toolChoice, tools);
  if (toolChoice.kind === "error") {
    yield { type: "error", error: new Error(toolChoice.message) };
    return;
  }

  try {
    const result = streamText({
      model: options.model,
      system: request.system,
      messages: toAiSdkModelMessages(request.messages),
      tools,
      toolChoice: toolChoice.value,
      temperature: request.temperature,
      abortSignal: request.abortSignal,
      maxRetries: options.maxRetries,
      headers: options.headers,
    });

    for await (const part of result.fullStream) {
      const event = textStreamPartToModelEvent(part);
      if (event !== null) yield event;
    }
  } catch (err) {
    yield { type: "error", error: err };
  }
}

function textStreamPartToModelEvent(part: {
  readonly type: string;
  readonly [key: string]: unknown;
}): ModelEvent | null {
  if (part.type === "text-delta") {
    return { type: "text_delta", text: String(part.text ?? "") };
  }
  if (part.type === "reasoning-delta") {
    return { type: "reasoning_delta", text: String(part.text ?? "") };
  }
  if (part.type === "tool-call") {
    return {
      type: "tool_call",
      call: {
        id: String(part.toolCallId ?? ""),
        name: String(part.toolName ?? ""),
        input: part.input,
        providerExecuted:
          typeof part.providerExecuted === "boolean"
            ? part.providerExecuted
            : undefined,
        providerMetadata: part.providerMetadata,
      } satisfies AgentToolCall,
    };
  }
  if (part.type === "finish") {
    return {
      type: "finish",
      reason: String(part.finishReason ?? "unknown"),
      rawReason:
        typeof part.rawFinishReason === "string"
          ? part.rawFinishReason
          : undefined,
      usage: normalizeUsage(part.totalUsage),
    };
  }
  return null;
}

function normalizeUsage(value: unknown): TokenUsage | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    inputTokens: readNumber(record.inputTokens ?? record.promptTokens),
    outputTokens: readNumber(record.outputTokens ?? record.completionTokens),
    totalTokens: readNumber(record.totalTokens),
    ...record,
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
