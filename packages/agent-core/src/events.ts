import type { AgentToolCall, AssistantStep, ModelEvent } from "./model.js";
import type { ToolRunResult } from "./tools.js";

export type AgentEvent =
  | { readonly type: "turn_start"; readonly turnId: string; readonly input: string }
  | { readonly type: "model_event"; readonly event: ModelEvent }
  | {
      readonly type: "assistant_step";
      readonly step: number;
      readonly assistant: AssistantStep;
    }
  | {
      readonly type: "tool_start";
      readonly step: number;
      readonly call: AgentToolCall;
    }
  | {
      readonly type: "tool_result";
      readonly step: number;
      readonly call: AgentToolCall;
      readonly result: ToolRunResult<unknown>;
    }
  | {
      readonly type: "turn_end";
      readonly turnId: string;
      readonly reason: "completed" | "max_steps" | "aborted" | "error";
    }
  | { readonly type: "error"; readonly error: unknown };
