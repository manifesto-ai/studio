import { describe, expect, it, vi } from "vitest";
import {
  createAnswerAndTurnEndTool,
  type AnswerAndTurnEndContext,
} from "../answer-and-turn-end.js";

describe("answerAndTurnEnd", () => {
  it("rejects empty / missing answer as invalid_input", async () => {
    const ctx: AnswerAndTurnEndContext = {
      isTurnRunning: () => true,
      concludeAgentTurn: vi.fn(async () => {}),
    };
    const tool = createAnswerAndTurnEndTool();

    const empty = await tool.run({ answer: "" }, ctx);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.kind).toBe("invalid_input");

    const whitespace = await tool.run({ answer: "   " }, ctx);
    expect(whitespace.ok).toBe(false);
    if (!whitespace.ok) expect(whitespace.kind).toBe("invalid_input");

    expect(ctx.concludeAgentTurn).not.toHaveBeenCalled();
  });

  it("rejects when no agent turn is running", async () => {
    const ctx: AnswerAndTurnEndContext = {
      isTurnRunning: () => false,
      concludeAgentTurn: vi.fn(),
    };
    const result = await createAnswerAndTurnEndTool().run(
      { answer: "done" },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("runtime_error");
    expect(ctx.concludeAgentTurn).not.toHaveBeenCalled();
  });

  it("delivers the answer + ends the turn (awaits the dispatch)", async () => {
    const dispatchCalls: string[] = [];
    let resolved = false;
    const ctx: AnswerAndTurnEndContext = {
      isTurnRunning: () => true,
      concludeAgentTurn: async (answer) => {
        dispatchCalls.push(answer);
        // Simulate Manifesto's async dispatch settling one microtask later.
        await Promise.resolve();
        resolved = true;
      },
    };
    const result = await createAnswerAndTurnEndTool().run(
      { answer: "You have 5 deleted tasks. emptyTrash will wipe them." },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toEqual({
      turnEnded: true,
      answer: "You have 5 deleted tasks. emptyTrash will wipe them.",
    });
    expect(dispatchCalls).toEqual([
      "You have 5 deleted tasks. emptyTrash will wipe them.",
    ]);
    // Critical — the await MUST have settled before the tool returns,
    // otherwise sendAutomaticallyWhen races and re-invokes.
    expect(resolved).toBe(true);
  });
});
