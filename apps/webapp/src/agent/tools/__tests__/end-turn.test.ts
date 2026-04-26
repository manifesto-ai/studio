import { describe, expect, it, vi } from "vitest";
import {
  createEndTurnTool,
  type EndTurnContext,
} from "../end-turn.js";

describe("endTurn", () => {
  it("rejects when no turn is running", async () => {
    const ctx: EndTurnContext = {
      isTurnRunning: () => false,
      concludeAgentTurn: vi.fn(async () => {}),
    };
    const result = await createEndTurnTool().run({}, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("runtime_error");
    expect(ctx.concludeAgentTurn).not.toHaveBeenCalled();
  });

  it("ends the turn with summary defaulted when not provided", async () => {
    const spy = vi.fn(async () => {});
    const ctx: EndTurnContext = {
      isTurnRunning: () => true,
      concludeAgentTurn: spy,
    };
    const result = await createEndTurnTool().run({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.turnEnded).toBe(true);
    expect(result.output.summary).toBe("(turn ended by agent)");
    expect(spy).toHaveBeenCalledWith("(turn ended by agent)");
  });

  it("trims and forwards an explicit summary", async () => {
    let resolved = false;
    const ctx: EndTurnContext = {
      isTurnRunning: () => true,
      concludeAgentTurn: async (summary) => {
        await Promise.resolve();
        resolved = true;
        expect(summary).toBe("Added priority field");
      },
    };
    const result = await createEndTurnTool().run(
      { summary: "  Added priority field  " },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.summary).toBe("Added priority field");
    // Ensure the tool awaited the dispatch — sendAutomaticallyWhen
    // must see "ended" by the time the tool returns, otherwise the
    // harness races and re-invokes.
    expect(resolved).toBe(true);
  });
});
