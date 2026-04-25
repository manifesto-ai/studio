import type { AgentTool, ToolRunResult } from "./types.js";

/**
 * `answerAndTurnEnd` - the terminal tool through which an agent turn
 * speaks to the user.
 *
 * Design: this tool is the terminal action: calling it (a) delivers
 * the visible answer to the user and (b) flips the agent turn to
 * "ended" in the StudioUi Manifesto runtime. "Speaking to the user"
 * and "ending the turn" are the same physical event; no prompt-side
 * discipline can break that coupling.
 *
 * SagaLens additionally runs with `toolChoice: "required"`, so naked
 * text replies are not an option there. AgentLens uses the same tool
 * as its Manifesto-native terminal path while keeping a smaller live
 * retry budget.
 */
export type AnswerAndTurnEndContext = {
  readonly isTurnRunning: () => boolean;
  /**
   * Awaitable - the tool awaits this so the turn's status is
   * definitively "ended" in the runtime by the time the tool
   * returns. Without the await, AI SDK's post-tool
   * `sendAutomaticallyWhen` check races against the pending
   * dispatch and sees stale "running" status.
   */
  readonly concludeAgentTurn: (answer: string) => Promise<void>;
};

export type AnswerAndTurnEndInput = {
  readonly answer: string;
};

export type AnswerAndTurnEndOutput = {
  readonly turnEnded: true;
  readonly answer: string;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: {
      type: "string",
      description:
        "The full visible answer to the user, in natural language. Include everything the user should see; there is no other final-answer channel for the active agent turn.",
    },
  },
};

export function createAnswerAndTurnEndTool(): AgentTool<
  AnswerAndTurnEndInput,
  AnswerAndTurnEndOutput,
  AnswerAndTurnEndContext
> {
  return {
    name: "answerAndTurnEnd",
    description:
      "Reply to the user AND end the current agent turn. Use other tools (inspect/read/dispatch/propose) for work; when you are ready to speak to the user, call this tool with the full answer text. Calling it ends the turn.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runAnswerAndTurnEnd(input, ctx),
  };
}

export async function runAnswerAndTurnEnd(
  input: AnswerAndTurnEndInput,
  ctx: AnswerAndTurnEndContext,
): Promise<ToolRunResult<AnswerAndTurnEndOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.answer !== "string" ||
    input.answer.trim() === ""
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message:
        "`answerAndTurnEnd` requires { answer: string } with a non-empty answer.",
    };
  }
  if (!ctx.isTurnRunning()) {
    return {
      ok: false,
      kind: "runtime_error",
      message:
        "No agent turn is currently running. answerAndTurnEnd is only valid inside an active agent turn.",
    };
  }
  const answer = input.answer;
  await ctx.concludeAgentTurn(answer);
  return {
    ok: true,
    output: { turnEnded: true, answer },
  };
}
