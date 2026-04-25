import type { AgentTool, ToolRunResult } from "./tools.js";

export type AnswerAndTurnEndContext = {
  readonly isTurnRunning: () => boolean | Promise<boolean>;
  readonly endTurn: (answer: string) => Promise<void> | void;
};

export type AnswerAndTurnEndInput = {
  readonly answer: string;
};

export type AnswerAndTurnEndOutput = {
  readonly turnEnded: true;
  readonly answer: string;
};

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: {
      type: "string",
      description:
        "The full visible answer to the user. Calling this tool delivers the answer and ends the durable turn.",
    },
  },
} satisfies Record<string, unknown>;

export function createAnswerAndTurnEndTool(): AgentTool<
  AnswerAndTurnEndInput,
  AnswerAndTurnEndOutput,
  AnswerAndTurnEndContext
> {
  return {
    name: "answerAndTurnEnd",
    description:
      "Reply to the user and end the current durable turn. Use this as the terminal tool when the answer is ready.",
    jsonSchema: JSON_SCHEMA,
    run: (input, context) => runAnswerAndTurnEnd(input, context),
  };
}

export async function runAnswerAndTurnEnd(
  input: AnswerAndTurnEndInput,
  context: AnswerAndTurnEndContext,
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
  if (!(await context.isTurnRunning())) {
    return {
      ok: false,
      kind: "runtime_error",
      message: "No durable turn is currently running.",
    };
  }
  await context.endTurn(input.answer);
  return {
    ok: true,
    output: {
      turnEnded: true,
      answer: input.answer,
    },
  };
}
