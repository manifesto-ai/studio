import { describe, expect, it } from "vitest";
import type { StudioAgentContext } from "../agent-context.js";
import {
  buildDurableAgentSystemPrompt,
  buildLiveAgentSystemPrompt,
  readLiveAgentTurnMode,
  readLiveAgentTurnStatus,
} from "../agent-turn-state.js";

const CTX: StudioAgentContext = {
  hasModule: true,
  melSource: "domain Todo { state { count: number = 0 } }",
  diagnostics: { errors: 0, warnings: 0 },
  recentTurns: [],
};

describe("agent turn prompts", () => {
  it("adds the live terminal-answer rule without embedding dynamic snapshot JSON", () => {
    const prompt = buildLiveAgentSystemPrompt({
      agentContext: CTX,
      turn: {
        id: "live-1",
        mode: "live",
        status: "running",
        prompt: "what is current count?",
        conclusion: null,
        resendCount: 0,
      },
    });

    expect(prompt).toContain("Agent turn - structural rules");
    expect(prompt).toContain("answerAndTurnEnd({ answer })");
    expect(prompt).toContain("Do not treat plain text as the final answer");
    expect(prompt).not.toContain("```json");
  });

  it("adds durable resume pressure after a resend", () => {
    const prompt = buildDurableAgentSystemPrompt({
      agentContext: CTX,
      turn: {
        id: "durable-1",
        mode: "durable",
        status: "running",
        prompt: "add priority",
        conclusion: null,
        resendCount: 2,
      },
    });

    expect(prompt).toContain("Durable agent turn - structural rules");
    expect(prompt).toContain("toolChoice:required");
    expect(prompt).toContain("RESUME - durable turn durable-1, resend #2");
    expect(prompt).toContain("Do not keep working silently");
  });
});

describe("agent turn live snapshot readers", () => {
  it("reads active turn status and mode from a core-like snapshot", () => {
    const core = {
      getSnapshot: () => ({
        data: {
          agentTurnStatus: "running",
          agentTurnMode: "durable",
        },
      }),
    };

    expect(readLiveAgentTurnStatus(core)).toBe("running");
    expect(readLiveAgentTurnMode(core)).toBe("durable");
  });

  it("returns null for absent or invalid turn values", () => {
    const core = {
      getSnapshot: () => ({
        data: {
          agentTurnStatus: "busy",
          agentTurnMode: "background",
        },
      }),
    };

    expect(readLiveAgentTurnStatus(core)).toBeNull();
    expect(readLiveAgentTurnMode(core)).toBeNull();
    expect(readLiveAgentTurnStatus(null)).toBeNull();
    expect(readLiveAgentTurnMode(null)).toBeNull();
  });
});
