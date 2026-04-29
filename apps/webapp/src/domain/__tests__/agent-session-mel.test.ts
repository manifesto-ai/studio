/**
 * agent-session.mel runtime smoke + lifecycle test.
 *
 * Verifies the bundled AgentSession contract module:
 *   1. Compiles cleanly.
 *   2. Initial snapshot matches declared defaults.
 *   3. Phase machine transitions: idle → awaitingModel → streaming
 *      → awaitingTool → awaitingModel → streaming → settled.
 *   4. Legality gates enforce sequence (recordToolResult requires
 *      matching callId, recordModelInvocation requires awaitingModel,
 *      etc.).
 *   5. Budget ceiling blocks model invocations once exhausted.
 *   6. Stop request transitions to stopped from any phase and
 *      blocks subsequent model invocations until cleared.
 *   7. Counters are pure increments (no array accumulation).
 *   8. resetSession returns to declared defaults (modulo the
 *      preserved budget ceiling, which is intentional).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";

const here = dirname(fileURLToPath(import.meta.url));
const agentSessionMelSource = readFileSync(
  join(here, "..", "agent-session.mel"),
  "utf8",
);

async function bootAgentSessionRuntime() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: agentSessionMelSource });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") {
    throw new Error(
      `agent-session.mel failed to build: ${JSON.stringify(result.errors)}`,
    );
  }
  return core;
}

type RuntimeCore = Awaited<ReturnType<typeof bootAgentSessionRuntime>>;

function readState(core: RuntimeCore): Record<string, unknown> {
  const snap = core.getSnapshot();
  return (snap as { readonly data?: Record<string, unknown> } | null)?.data ?? {};
}

function readComputed(core: RuntimeCore): Record<string, unknown> {
  const snap = core.getSnapshot();
  return (
    (snap as { readonly computed?: Record<string, unknown> } | null)?.computed ??
    {}
  );
}

async function dispatch(
  core: RuntimeCore,
  action: string,
  ...args: readonly unknown[]
): Promise<{ readonly kind: string }> {
  const intent = core.createIntent(action, ...args);
  return core.dispatchAsync(intent) as Promise<{ readonly kind: string }>;
}

describe("agent-session.mel — compiles", () => {
  it("builds cleanly with no diagnostics", async () => {
    const core = await bootAgentSessionRuntime();
    expect(core.getModule()).not.toBeNull();
  });

  it("preserves structural @meta annotations for grounding", async () => {
    const core = await bootAgentSessionRuntime();
    const entries = (
      core.getModule() as {
        readonly annotations?: {
          readonly entries?: Record<
            string,
            readonly { readonly tag: string; readonly payload?: unknown }[]
          >;
        };
      } | null
    )?.annotations?.entries;
    expect(entries?.["domain:AgentSession"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "comment:grounding" }),
      ]),
    );
    expect(entries?.["state_field:phase"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "comment:grounding" }),
      ]),
    );
    expect(entries?.["action:recordToolResult"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "agent:invariant" }),
      ]),
    );
  });
});

describe("agent-session.mel — initial state", () => {
  it("matches declared defaults", async () => {
    const core = await bootAgentSessionRuntime();
    expect(readState(core)).toMatchObject({
      phase: "idle",
      currentTurnId: null,
      lastUserText: null,
      pendingToolCallId: null,
      pendingToolName: null,
      lastToolCallId: null,
      lastToolName: null,
      lastToolOutcome: null,
      lastResponseFinal: null,
      lastModelError: null,
      budgetUsedMc: 0,
      budgetCeilingMc: 0,
      lastAnchorFromWorldId: null,
      lastAnchorToWorldId: null,
      lastAnchorSummary: null,
      turnCount: 0,
      toolCallCount: 0,
      modelInvocationCount: 0,
    });
    expect(readComputed(core)).toMatchObject({
      idle: true,
      awaitingUser: false,
      canStartTurn: true,
      isProcessing: false,
      budgetExhausted: false,
      canInvokeModel: true,
    });
  });
});

describe("agent-session.mel — happy-path turn lifecycle", () => {
  it("walks idle → awaitingModel → streaming → settled", async () => {
    const core = await bootAgentSessionRuntime();
    expect((await dispatch(core, "recordUserTurn", "t-1", "hello")).kind).toBe(
      "completed",
    );
    expect(readState(core)).toMatchObject({
      phase: "awaitingModel",
      lastUserText: "hello",
      turnCount: 1,
    });
    expect(
      (await dispatch(core, "recordModelInvocation", "inv-1", "large")).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "streaming",
      modelInvocationCount: 1,
    });
    expect(
      (await dispatch(core, "recordAssistantSettled", "hi there")).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "settled",
      lastResponseFinal: "hi there",
    });
    expect(readComputed(core).awaitingUser).toBe(true);
  });

  it("interleaves a tool call: streaming → awaitingTool → awaitingModel → streaming → settled", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "what's focused?");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    expect(
      (
        await dispatch(core, "recordToolCall", "call-1", "inspectFocus")
      ).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "awaitingTool",
      pendingToolCallId: "call-1",
      pendingToolName: "inspectFocus",
    });
    expect(
      (await dispatch(core, "recordToolResult", "call-1", "ok")).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "awaitingModel",
      pendingToolCallId: null,
      pendingToolName: null,
      lastToolCallId: "call-1",
      lastToolName: "inspectFocus",
      lastToolOutcome: "ok",
      toolCallCount: 1,
    });
    // Effect handler re-invokes the model after a tool result.
    await dispatch(core, "recordModelInvocation", "inv-2", "large");
    await dispatch(core, "recordAssistantSettled", "Nothing is focused.");
    expect(readState(core)).toMatchObject({
      phase: "settled",
      modelInvocationCount: 2,
      toolCallCount: 1,
    });
  });

  it("records two consecutive turns without losing prior settled text until the next turn starts", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "first");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordAssistantSettled", "first-response");
    expect(readState(core).lastResponseFinal).toBe("first-response");
    expect(readState(core).currentTurnId).toBe("t-1");

    await dispatch(core, "recordUserTurn", "t-2", "second");
    // recordUserTurn clears the previous turn's settled fields so
    // mid-second-turn scrubs see only the active turn's state, and
    // currentTurnId rolls forward.
    expect(readState(core)).toMatchObject({
      phase: "awaitingModel",
      currentTurnId: "t-2",
      lastUserText: "second",
      lastResponseFinal: null,
      turnCount: 2,
    });
  });

  it("preserves currentTurnId across all step worlds within a turn", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-42", "trace this");
    expect(readState(core).currentTurnId).toBe("t-42");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    expect(readState(core).currentTurnId).toBe("t-42");
    await dispatch(core, "recordToolCall", "call-1", "foo");
    expect(readState(core).currentTurnId).toBe("t-42");
    await dispatch(core, "recordToolResult", "call-1", "ok");
    expect(readState(core).currentTurnId).toBe("t-42");
    await dispatch(core, "recordModelInvocation", "inv-2", "large");
    expect(readState(core).currentTurnId).toBe("t-42");
    await dispatch(core, "recordAssistantSettled", "done");
    // Even after settle, currentTurnId stays as the last completed
    // turn id — useful for "this turn's lineage walk" queries until
    // the next recordUserTurn rolls it forward.
    expect(readState(core).currentTurnId).toBe("t-42");
  });
});

describe("agent-session.mel — legality gates", () => {
  it("rejects recordModelInvocation outside awaitingModel", async () => {
    const core = await bootAgentSessionRuntime();
    // Idle: no user turn yet.
    expect(
      (await dispatch(core, "recordModelInvocation", "inv-x", "large")).kind,
    ).toBe("rejected");
  });

  it("rejects recordToolCall outside streaming", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    // awaitingModel, not streaming yet.
    expect(
      (await dispatch(core, "recordToolCall", "call-1", "foo")).kind,
    ).toBe("rejected");
  });

  it("rejects recordToolResult with mismatched callId", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordToolCall", "call-1", "foo");
    // Wrong callId.
    expect(
      (await dispatch(core, "recordToolResult", "call-WRONG", "ok")).kind,
    ).toBe("rejected");
    // Right callId still works.
    expect(
      (await dispatch(core, "recordToolResult", "call-1", "ok")).kind,
    ).toBe("completed");
  });

  it("rejects recordAssistantSettled outside streaming", async () => {
    const core = await bootAgentSessionRuntime();
    expect(
      (await dispatch(core, "recordAssistantSettled", "fake")).kind,
    ).toBe("rejected");
  });

  it("rejects recordUserTurn while a turn is already in flight", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "first");
    // awaitingModel — second turn not allowed.
    expect((await dispatch(core, "recordUserTurn", "t-2", "second")).kind).toBe(
      "rejected",
    );
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    // streaming — still not allowed.
    expect((await dispatch(core, "recordUserTurn", "t-2", "second")).kind).toBe(
      "rejected",
    );
    await dispatch(core, "recordAssistantSettled", "ok");
    // settled — now allowed.
    expect((await dispatch(core, "recordUserTurn", "t-2", "second")).kind).toBe(
      "completed",
    );
    expect(readState(core).currentTurnId).toBe("t-2");
  });
});

describe("agent-session.mel — budget", () => {
  it("recordBudget accumulates monotonically", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordBudget", 10);
    expect(readState(core).budgetUsedMc).toBe(10);
    await dispatch(core, "recordBudget", 25);
    expect(readState(core).budgetUsedMc).toBe(35);
  });

  it("budgetExhausted flips once usage hits the ceiling", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "setBudgetCeiling", 50);
    expect(readComputed(core).budgetExhausted).toBe(false);
    expect(readComputed(core).canInvokeModel).toBe(true);
    await dispatch(core, "recordBudget", 50);
    expect(readComputed(core).budgetExhausted).toBe(true);
    expect(readComputed(core).canInvokeModel).toBe(false);
  });

  it("blocks recordModelInvocation once budget is exhausted", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "setBudgetCeiling", 10);
    await dispatch(core, "recordBudget", 10);
    await dispatch(core, "recordUserTurn", "t-1", "hello");
    expect(
      (await dispatch(core, "recordModelInvocation", "inv-1", "large")).kind,
    ).toBe("rejected");
  });

  it("does not block when ceiling is zero (default — no ceiling)", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordBudget", 9999);
    expect(readComputed(core).budgetExhausted).toBe(false);
    expect(readComputed(core).canInvokeModel).toBe(true);
  });
});

describe("agent-session.mel — stop signal", () => {
  it("recordSessionStop transitions to stopped from any phase", async () => {
    for (const setupPhase of [
      "idle",
      "awaitingModel",
      "streaming",
      "awaitingTool",
      "settled",
    ] as const) {
      const core = await bootAgentSessionRuntime();
      if (setupPhase !== "idle") {
        await dispatch(core, "recordUserTurn", "t-1", "x");
      }
      if (setupPhase === "streaming" || setupPhase === "awaitingTool" || setupPhase === "settled") {
        await dispatch(core, "recordModelInvocation", "inv-1", "large");
      }
      if (setupPhase === "awaitingTool") {
        await dispatch(core, "recordToolCall", "call-1", "foo");
      }
      if (setupPhase === "settled") {
        await dispatch(core, "recordAssistantSettled", "ok");
      }
      const before = readState(core).phase;
      expect(before).toBe(setupPhase);
      expect((await dispatch(core, "recordSessionStop")).kind).toBe(
        "completed",
      );
      expect(readState(core).phase).toBe("stopped");
      expect(readState(core).pendingToolCallId).toBe(null);
    }
  });

  it("blocks recordModelInvocation after stop (phase=stopped guard)", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordSessionStop");
    // phase=stopped — recordModelInvocation requires awaitingModel.
    expect(
      (await dispatch(core, "recordModelInvocation", "inv-1", "large")).kind,
    ).toBe("rejected");
    // Next recordUserTurn moves us back to awaitingModel.
    await dispatch(core, "recordUserTurn", "t-1", "retry");
    expect(
      (await dispatch(core, "recordModelInvocation", "inv-2", "large")).kind,
    ).toBe("completed");
  });
});

describe("agent-session.mel — recordModelInvocationFailed", () => {
  it("transitions streaming → settled with lastModelError set", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    expect(
      (await dispatch(core, "recordModelInvocationFailed", "API 500")).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "settled",
      lastModelError: "API 500",
    });
  });

  it("rejects outside streaming", async () => {
    const core = await bootAgentSessionRuntime();
    expect(
      (await dispatch(core, "recordModelInvocationFailed", "early")).kind,
    ).toBe("rejected");
    await dispatch(core, "recordUserTurn", "t-1", "x");
    // awaitingModel — still rejected.
    expect(
      (await dispatch(core, "recordModelInvocationFailed", "early")).kind,
    ).toBe("rejected");
  });

  it("recordUserTurn clears lastModelError", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordModelInvocationFailed", "boom");
    expect(readState(core).lastModelError).toBe("boom");
    await dispatch(core, "recordUserTurn", "t-2", "retry");
    expect(readState(core).lastModelError).toBe(null);
  });
});

describe("agent-session.mel — anchoring", () => {
  it("anchorWindow records the latest anchor metadata without touching phase", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordAssistantSettled", "ok");
    expect(
      (
        await dispatch(
          core,
          "anchorWindow",
          "a-1",
          "world-1",
          "world-9",
          "agent architecture redesign",
          "Discussed lineage as history, anchor as compression.",
        )
      ).kind,
    ).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "settled",
      lastAnchorId: "a-1",
      lastAnchorFromWorldId: "world-1",
      lastAnchorToWorldId: "world-9",
      lastAnchorTopic: "agent architecture redesign",
      lastAnchorSummary: "Discussed lineage as history, anchor as compression.",
      anchorCount: 1,
    });
  });

  it("anchorWindow accumulates anchorCount across multiple dispatches", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordAssistantSettled", "ok");
    await dispatch(core, "anchorWindow", "a-1", "w-1", "w-3", "topic 1", "s 1");
    await dispatch(core, "anchorWindow", "a-2", "w-3", "w-6", "topic 2", "s 2");
    expect(readState(core)).toMatchObject({
      lastAnchorId: "a-2",
      lastAnchorTopic: "topic 2",
      anchorCount: 2,
    });
  });
});

describe("agent-session.mel — resetSession", () => {
  it("returns scalar fields to defaults, preserving the budget ceiling", async () => {
    const core = await bootAgentSessionRuntime();
    await dispatch(core, "setBudgetCeiling", 1000);
    await dispatch(core, "recordUserTurn", "t-1", "hello");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordToolCall", "call-1", "foo");
    await dispatch(core, "recordToolResult", "call-1", "ok");
    await dispatch(core, "recordBudget", 250);
    expect((await dispatch(core, "resetSession")).kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      phase: "idle",
      lastUserText: null,
      lastResponseFinal: null,
      budgetUsedMc: 0,
      budgetCeilingMc: 1000,
      turnCount: 0,
      toolCallCount: 0,
      modelInvocationCount: 0,
      pendingToolCallId: null,
      lastToolCallId: null,
    });
  });
});

describe("agent-session.mel — scalar discipline", () => {
  it("state shape is entirely scalar (no arrays) — antipattern check", async () => {
    const core = await bootAgentSessionRuntime();
    // Walk a non-trivial sequence and assert no field becomes an array.
    await dispatch(core, "recordUserTurn", "t-1", "x");
    await dispatch(core, "recordModelInvocation", "inv-1", "large");
    await dispatch(core, "recordToolCall", "call-1", "foo");
    await dispatch(core, "recordToolResult", "call-1", "ok");
    await dispatch(core, "recordModelInvocation", "inv-2", "large");
    await dispatch(core, "recordAssistantSettled", "settled");
    const state = readState(core);
    for (const [key, value] of Object.entries(state)) {
      expect(Array.isArray(value), `field ${key} is an array`).toBe(false);
    }
  });
});
