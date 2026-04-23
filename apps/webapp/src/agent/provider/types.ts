/**
 * Narrow LLM-provider interface the orchestrator speaks to. Designed
 * to be implementable by any chat-style function-calling model —
 * OpenAI-compat Ollama endpoint is the only current implementation
 * (`ollama.ts`). If we ever need to swap, this file is the contract
 * to re-implement against.
 *
 * Deliberately minimal: message list in, either a terminal assistant
 * message OR a tool-call request out. Orchestrator handles the loop.
 */

export type AssistantRole = "user" | "assistant" | "tool" | "system";

/** Matches the OpenAI function-call spec shape. */
export type ToolSpec = {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>; // JSON schema
  };
};

export type UserMessage = {
  readonly role: "user";
  readonly content: string;
};

export type SystemMessage = {
  readonly role: "system";
  readonly content: string;
};

/**
 * Assistant message can carry either plain text (`content`) or a
 * tool-call request (`toolCalls`). Function-call models typically
 * emit one but not both; we treat both as optional to tolerate
 * models that emit partial text alongside a tool call.
 */
export type AssistantMessage = {
  readonly role: "assistant";
  readonly content?: string | null;
  readonly toolCalls?: readonly ToolCall[];
};

/** A single requested tool call from the model. */
export type ToolCall = {
  readonly id: string;
  readonly name: string;
  /** Raw JSON arguments as a string — the orchestrator parses per-tool. */
  readonly argumentsJson: string;
};

/**
 * The orchestrator's response to a prior tool_call. `content` is the
 * tool's output serialized as JSON (or an error message). The
 * `toolCallId` ties the response back to the original request.
 */
export type ToolMessage = {
  readonly role: "tool";
  readonly toolCallId: string;
  readonly name: string;
  readonly content: string;
};

export type ChatMessage =
  | UserMessage
  | SystemMessage
  | AssistantMessage
  | ToolMessage;

/**
 * Streaming event delivered to `ChatRequest.onStream` as tokens arrive.
 * Tool calls are not streamed piecewise — the orchestrator needs a
 * complete JSON payload before it can dispatch, so we buffer inside
 * the provider and emit `tool_call` once per completed call.
 */
export type ChatStreamEvent =
  | { readonly kind: "content"; readonly delta: string }
  | { readonly kind: "reasoning"; readonly delta: string }
  | { readonly kind: "tool_call"; readonly toolCall: ToolCall };

export type ChatRequest = {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
  readonly temperature?: number;
  /** Soft cap. Provider should enforce or surface if exceeded. */
  readonly maxToolUses?: number;
  /**
   * When present, the provider requests a streaming completion and
   * invokes this callback per event. The returned `ChatResponse` still
   * contains the assembled final message so orchestrator loops can
   * continue to treat each `chat()` call as atomic.
   */
  readonly onStream?: (event: ChatStreamEvent) => void;
  /**
   * Optional abort signal. Providers should wire this into the
   * underlying fetch so the user can interrupt an in-flight stream.
   */
  readonly signal?: AbortSignal;
};

export type ChatResponse = {
  readonly message: AssistantMessage;
  /** Reasoning tokens from thinking-capable models (gemma4, qwen3-thinking). */
  readonly reasoning?: string;
  /**
   * Provider-level diagnostics. Included for debug surfaces — the
   * orchestrator should not route on these.
   */
  readonly diagnostics?: {
    readonly totalTokens?: number;
    readonly latencyMs?: number;
    readonly endpoint?: string;
  };
};

/** Extension: AssistantMessage with reasoning attached (non-breaking). */
export type AssistantMessageWithReasoning = AssistantMessage & {
  readonly reasoning?: string;
};

export interface LlmProvider {
  readonly name: string;
  readonly modelId: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly options?: {
      readonly cause?: unknown;
      readonly status?: number;
      readonly endpoint?: string;
    },
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
