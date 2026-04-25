import type { ToolSpec } from "./tools.js";

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { readonly type: "tool"; readonly toolName: string };

export type AgentToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly providerExecuted?: boolean;
  readonly providerMetadata?: unknown;
};

export type TokenUsage = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly [key: string]: unknown;
};

export type AgentMessage =
  | {
      readonly role: "system";
      readonly content: string;
    }
  | {
      readonly role: "user";
      readonly content: string;
    }
  | {
      readonly role: "assistant";
      readonly content: string;
      readonly reasoning?: string;
      readonly toolCalls?: readonly AgentToolCall[];
    }
  | {
      readonly role: "tool";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly output: unknown;
    };

export type ModelRequest = {
  readonly system?: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly ToolSpec[];
  readonly toolChoice?: ToolChoice;
  readonly temperature?: number;
  readonly abortSignal?: AbortSignal;
};

export type ModelFinishReason = string;

export type ModelEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "reasoning_delta"; readonly text: string }
  | { readonly type: "tool_call"; readonly call: AgentToolCall }
  | {
      readonly type: "finish";
      readonly reason: ModelFinishReason;
      readonly rawReason?: string;
      readonly usage?: TokenUsage;
    }
  | { readonly type: "error"; readonly error: unknown };

export type ModelAdapter = {
  readonly name: string;
  readonly stream: (request: ModelRequest) => AsyncIterable<ModelEvent>;
};

export type AssistantStep = {
  readonly text: string;
  readonly reasoning: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly finishReason: ModelFinishReason | null;
  readonly usage?: TokenUsage;
};
