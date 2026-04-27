import type { AgentToolCall, AssistantStep, ToolChoice } from "./model.js";
import type { BoundAgentTool, ToolRunResult } from "./tools.js";

export type TurnContext = {
  readonly turnId: string;
  readonly input: string;
  readonly step: number;
  readonly lastAssistant: AssistantStep | null;
  readonly lastToolCall: AgentToolCall | null;
  readonly lastToolResult: ToolRunResult<unknown> | null;
};

export type TurnPolicy = {
  readonly kind: string;
  readonly maxSteps?: number;
  readonly terminalTools?: readonly BoundAgentTool[];
  readonly beforeTurn?: (context: TurnContext) => Promise<void> | void;
  readonly toolChoice?: (
    context: TurnContext,
  ) => Promise<ToolChoice | undefined> | ToolChoice | undefined;
  readonly shouldContinue: (
    context: TurnContext,
  ) => Promise<boolean> | boolean;
  readonly onModelFinish?: (context: TurnContext) => Promise<void> | void;
  readonly onToolResult?: (context: TurnContext) => Promise<void> | void;
  readonly afterTurn?: (context: TurnContext) => Promise<void> | void;
};

export function makeTurnContext(input: {
  readonly turnId: string;
  readonly userInput: string;
  readonly step: number;
  readonly lastAssistant: AssistantStep | null;
  readonly lastToolCall: AgentToolCall | null;
  readonly lastToolResult: ToolRunResult<unknown> | null;
}): TurnContext {
  return {
    turnId: input.turnId,
    input: input.userInput,
    step: input.step,
    lastAssistant: input.lastAssistant,
    lastToolCall: input.lastToolCall,
    lastToolResult: input.lastToolResult,
  };
}
