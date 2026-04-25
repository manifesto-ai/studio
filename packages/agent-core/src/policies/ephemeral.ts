import type { TurnPolicy } from "../policy.js";

export function ephemeralTurnPolicy(options: {
  readonly maxSteps?: number;
  readonly toolChoice?: TurnPolicy["toolChoice"];
} = {}): TurnPolicy {
  return {
    kind: "ephemeral",
    maxSteps: options.maxSteps,
    toolChoice: options.toolChoice,
    shouldContinue: (context) =>
      (context.lastAssistant?.toolCalls.length ?? 0) > 0,
  };
}
