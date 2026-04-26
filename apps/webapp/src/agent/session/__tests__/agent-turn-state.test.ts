import { describe, expect, it } from "vitest";
import type { StudioAgentContext } from "../agent-context.js";
import {
  buildLiveAgentSystemPrompt,
  readLiveAgentTurnMode,
  readLiveAgentTurnStatus,
} from "../agent-turn-state.js";

const CTX: StudioAgentContext = {
  hasModule: true,
  domainSummary: {
    schemaId: "Todo",
    schemaHash: "hash",
    source: { present: true, lineCount: 1, charCount: 42 },
    stateFields: ["count"],
    computedFields: [],
    actions: [],
    graph: { nodeCount: 1, edgeCount: 0 },
  },
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
    expect(prompt).toContain("endTurn({ summary? })");
    expect(prompt).toContain("plain assistant text");
    expect(prompt).not.toContain("```json");
  });

  it("adds live resume pressure after a resend", () => {
    const prompt = buildLiveAgentSystemPrompt({
      agentContext: CTX,
      turn: {
        id: "live-1",
        mode: "live",
        status: "running",
        prompt: "add priority",
        conclusion: null,
        resendCount: 2,
      },
    });

    expect(prompt).toContain("Agent turn - structural rules");
    expect(prompt).toContain("endTurn");
    expect(prompt).toContain("RESUME - live turn live-1, resend #2");
    expect(prompt).toContain("Do not keep retrying silently");
  });
});

describe("agent turn live snapshot readers", () => {
  it("reads active turn status and mode from a core-like snapshot", () => {
    const core = {
      getSnapshot: () => ({
        data: {
          agentTurnStatus: "running",
          agentTurnMode: "live",
        },
      }),
    };

    expect(readLiveAgentTurnStatus(core)).toBe("running");
    expect(readLiveAgentTurnMode(core)).toBe("live");
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
