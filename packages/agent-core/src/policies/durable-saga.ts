import type { ToolChoice } from "../model.js";
import type { TurnPolicy } from "../policy.js";
import type { BoundAgentTool } from "../tools.js";

export type DurableTurnState = {
  readonly id: string | null;
  readonly status: "running" | "ended" | null;
  readonly prompt: string | null;
  readonly conclusion: string | null;
  readonly resendCount: number;
};

export type DurableTurnStateStore = {
  readonly read: () => Promise<DurableTurnState> | DurableTurnState;
  readonly begin: (id: string, prompt: string) => Promise<void> | void;
  readonly conclude: (summary: string) => Promise<void> | void;
  readonly incrementResend: () => Promise<void> | void;
};

export type DurableSagaPolicyOptions = {
  readonly store: DurableTurnStateStore;
  readonly terminalToolName?: string;
  readonly terminalTools?: readonly BoundAgentTool[];
  readonly hardCap?: number;
  readonly maxSteps?: number;
};

const DEFAULT_TERMINAL_TOOL = "answerAndTurnEnd";
const DEFAULT_HARD_CAP = 20;

export function durableSagaTurnPolicy(
  options: DurableSagaPolicyOptions,
): TurnPolicy {
  const terminalToolName = options.terminalToolName ?? DEFAULT_TERMINAL_TOOL;
  const hardCap = options.hardCap ?? DEFAULT_HARD_CAP;
  let zeroToolStreak = 0;

  return {
    kind: "durable-saga",
    maxSteps: options.maxSteps,
    terminalTools: options.terminalTools,
    beforeTurn: async (context) => {
      const state = await options.store.read();
      if (state.status === "running") return;
      zeroToolStreak = 0;
      await options.store.begin(context.turnId, context.input);
    },
    toolChoice: async (): Promise<ToolChoice> => {
      const state = await options.store.read();
      const resumedRunningTurn =
        state.status === "running" && state.resendCount > 0;
      return zeroToolStreak >= 1 || resumedRunningTurn
        ? { type: "tool", toolName: terminalToolName }
        : "required";
    },
    onModelFinish: async (context) => {
      const hadToolCall = (context.lastAssistant?.toolCalls.length ?? 0) > 0;
      zeroToolStreak = hadToolCall ? 0 : zeroToolStreak + 1;
    },
    shouldContinue: async (context) => {
      const state = await options.store.read();
      if (state.status !== "running") return false;
      if (context.lastAssistant === null) return true;

      await options.store.incrementResend();
      const afterIncrement = await options.store.read();
      if (afterIncrement.resendCount >= hardCap) {
        await options.store.conclude(
          `Saga force-ended at resend cap (${hardCap}). The agent never called ${terminalToolName}.`,
        );
        return false;
      }
      return true;
    },
  };
}
