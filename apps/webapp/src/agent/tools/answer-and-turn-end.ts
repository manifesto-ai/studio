import type { AgentTool, ToolRunResult } from "./types.js";

/**
 * `answerAndTurnEnd` — the ONE tool through which a SagaLens turn
 * speaks to the user.
 *
 * Design: SagaLens runs with `toolChoice: "required"`, so naked text
 * replies are not an option — every step must be a tool call. This
 * tool is the terminal tool: calling it (a) delivers the visible
 * answer to the user and (b) flips the saga to "ended" in the
 * StudioUi Manifesto runtime. "Speaking to the user" and "ending
 * the turn" are the same physical event; no prompt-side discipline
 * can break that coupling.
 *
 * Compare to the earlier `concludeSaga({ summary })`: that was a
 * prompt-side convention ("your last tool call MUST be…") that
 * weak models routinely ignored by rambling text without calling
 * it. `answerAndTurnEnd` makes the rule structural.
 */
export type AnswerAndTurnEndContext = {
  readonly isSagaRunning: () => boolean;
  /**
   * Awaitable — the tool awaits this so the saga's status is
   * definitively "ended" in the runtime by the time the tool
   * returns. Without the await, AI SDK's post-tool
   * `sendAutomaticallyWhen` check races against the pending
   * dispatch and sees stale "running" status.
   */
  readonly concludeAgentSaga: (answer: string) => Promise<void>;
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
        "The full visible answer to the user, in natural language. This is the ONLY way to reply in a saga turn. Include everything the user should see — there is no other output channel.",
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
      "Reply to the user AND end the current saga turn. This is the ONLY way to send a user-visible answer in a SagaLens turn — naked text is not rendered. Use other tools (inspect/read/dispatch/propose) for work; when you are ready to speak to the user, call this tool with the full answer text. Calling it ends the turn.",
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
  if (!ctx.isSagaRunning()) {
    return {
      ok: false,
      kind: "runtime_error",
      message:
        "No saga is currently running. answerAndTurnEnd is only valid inside a SagaLens turn.",
    };
  }
  const answer = input.answer;
  await ctx.concludeAgentSaga(answer);
  return {
    ok: true,
    output: { turnEnded: true, answer },
  };
}
