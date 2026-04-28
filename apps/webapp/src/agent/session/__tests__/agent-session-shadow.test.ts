/**
 * Shadow recorder tests.
 *
 * Drives `createAgentSessionShadow` against a real AgentSession
 * Manifesto runtime so the lifecycle gates we care about (phase
 * progression, currentTurnId stability, counter increments,
 * graceful rejection logging) are validated end-to-end.
 *
 * The runtime is the same one the React provider uses — we just
 * skip the React layer and drive it through createIntent /
 * dispatchAsync directly via a stub `AgentSessionShadowRuntime`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore, type StudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import {
  classifyToolOutcome,
  createAgentSessionShadow,
  type AgentSessionShadowRuntime,
} from "../agent-session-shadow.js";
import type { AgentSessionSnapshot, ModelTier } from "@/domain/AgentSessionRuntime";

const here = dirname(fileURLToPath(import.meta.url));
const agentSessionMelSource = readFileSync(
  join(here, "..", "..", "..", "domain", "agent-session.mel"),
  "utf8",
);

async function bootRuntime() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: agentSessionMelSource });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") {
    throw new Error(
      `agent-session.mel build failed: ${JSON.stringify(result.errors)}`,
    );
  }
  return core;
}

function readSnapshot(core: StudioCore): AgentSessionSnapshot {
  const raw = core.getSnapshot();
  const data =
    (raw as { readonly data?: Record<string, unknown> } | null)?.data ?? {};
  const computed =
    (raw as { readonly computed?: Record<string, unknown> } | null)?.computed ??
    {};
  return {
    phase: (data.phase as AgentSessionSnapshot["phase"]) ?? "idle",
    currentTurnId: (data.currentTurnId as string | null) ?? null,
    lastUserText: (data.lastUserText as string | null) ?? null,
    pendingToolCallId: (data.pendingToolCallId as string | null) ?? null,
    pendingToolName: (data.pendingToolName as string | null) ?? null,
    lastToolCallId: (data.lastToolCallId as string | null) ?? null,
    lastToolName: (data.lastToolName as string | null) ?? null,
    lastToolOutcome:
      (data.lastToolOutcome as AgentSessionSnapshot["lastToolOutcome"]) ?? null,
    lastResponseFinal: (data.lastResponseFinal as string | null) ?? null,
    lastModelError: (data.lastModelError as string | null) ?? null,
    budgetUsedMc: (data.budgetUsedMc as number) ?? 0,
    budgetCeilingMc: (data.budgetCeilingMc as number) ?? 0,
    lastAnchorId: (data.lastAnchorId as string | null) ?? null,
    lastAnchorFromWorldId:
      (data.lastAnchorFromWorldId as string | null) ?? null,
    lastAnchorToWorldId: (data.lastAnchorToWorldId as string | null) ?? null,
    lastAnchorTopic: (data.lastAnchorTopic as string | null) ?? null,
    lastAnchorSummary: (data.lastAnchorSummary as string | null) ?? null,
    anchorCount: (data.anchorCount as number) ?? 0,
    turnCount: (data.turnCount as number) ?? 0,
    toolCallCount: (data.toolCallCount as number) ?? 0,
    modelInvocationCount: (data.modelInvocationCount as number) ?? 0,
    idle: computed.idle !== false,
    awaitingUser: Boolean(computed.awaitingUser),
    canStartTurn: computed.canStartTurn !== false,
    isProcessing: Boolean(computed.isProcessing),
    budgetExhausted: Boolean(computed.budgetExhausted),
    canInvokeModel: computed.canInvokeModel !== false,
  };
}

function makeRuntimeOver(core: StudioCore): AgentSessionShadowRuntime {
  return {
    get ready() {
      return true;
    },
    get snapshot() {
      return readSnapshot(core);
    },
    createIntent: (action, ...args) => core.createIntent(action, ...args),
    dispatchAsync: (intent) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as ReturnType<AgentSessionShadowRuntime["dispatchAsync"]>,
  };
}

type WarnFn = (message: string, detail?: unknown) => void;
let warn: ReturnType<typeof vi.fn> & WarnFn;
let idCounter: number;
const generateId = () => `id-${++idCounter}`;

beforeEach(() => {
  warn = vi.fn() as ReturnType<typeof vi.fn> & WarnFn;
  idCounter = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agent-session-shadow — lifecycle dispatch", () => {
  it("walks a tool-using turn end to end", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
      warn,
    });
    const turnId = await shadow.onUserTurn("what's focused?");
    expect(turnId).toBe("id-1");
    expect(readSnapshot(core)).toMatchObject({
      phase: "awaitingModel",
      currentTurnId: "id-1",
      lastUserText: "what's focused?",
      turnCount: 1,
    });

    const invocationId = await shadow.onModelInvocation("large" as ModelTier);
    expect(invocationId).toBe("id-2");
    expect(readSnapshot(core)).toMatchObject({
      phase: "streaming",
      modelInvocationCount: 1,
    });

    await shadow.onToolCall("call-1", "inspectFocus", { ref: "node:1" });
    expect(readSnapshot(core)).toMatchObject({
      phase: "awaitingTool",
      pendingToolCallId: "call-1",
      pendingToolName: "inspectFocus",
    });
    // Body lives in projection, not MEL — verify it round-trips via getToolInput.
    expect(shadow.getToolInput("call-1")).toEqual({ ref: "node:1" });

    await shadow.onToolResult("call-1", "ok", { focus: { id: "node:1" } });
    expect(readSnapshot(core)).toMatchObject({
      phase: "awaitingModel",
      lastToolCallId: "call-1",
      lastToolOutcome: "ok",
      toolCallCount: 1,
    });

    // Effect handler re-invokes the model after a tool result.
    await shadow.onModelInvocation("large" as ModelTier);
    expect(readSnapshot(core)).toMatchObject({
      phase: "streaming",
      modelInvocationCount: 2,
    });

    await shadow.onAssistantSettled("Nothing is focused.");
    expect(readSnapshot(core)).toMatchObject({
      phase: "settled",
      currentTurnId: "id-1",
      lastResponseFinal: "Nothing is focused.",
    });
    // No warns on the happy path.
    expect(warn).not.toHaveBeenCalled();
  });

  it("preserves currentTurnId across every step in the turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    const turnId = await shadow.onUserTurn("hello");
    expect(turnId).toBe("id-1");
    await shadow.onModelInvocation("large");
    await shadow.onToolCall("c1", "t1", {});
    await shadow.onToolResult("c1", "ok", {});
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("done");
    expect(readSnapshot(core).currentTurnId).toBe("id-1");
  });

  it("records a session stop from any phase", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    await shadow.onUserTurn("hello");
    await shadow.onModelInvocation("large");
    await shadow.onToolCall("c1", "t1", {});
    await shadow.onSessionStop();
    expect(readSnapshot(core)).toMatchObject({
      phase: "stopped",
      pendingToolCallId: null,
    });
  });
});

describe("agent-session-shadow — out-of-order dispatches log warnings", () => {
  it("logs when recordToolCall fires outside streaming and does not throw", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
      warn,
    });
    // No user turn yet — phase is idle.
    await expect(
      shadow.onToolCall("c1", "t1", { foo: "bar" }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, detail] = warn.mock.calls[0]!;
    expect(message).toContain("onToolCall not completed");
    expect(detail).toMatchObject({
      action: "recordToolCall",
      snapshotPhase: "idle",
    });
  });

  it("logs when recordModelInvocation fires before recordUserTurn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
      warn,
    });
    const id = await shadow.onModelInvocation("large");
    expect(id).toBe(null);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns null turnId when recordUserTurn rejects mid-turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
      warn,
    });
    const first = await shadow.onUserTurn("first");
    expect(first).toBe("id-1");
    await shadow.onModelInvocation("large");
    // Mid-turn — recordUserTurn requires idle/settled/stopped.
    const second = await shadow.onUserTurn("second");
    expect(second).toBe(null);
    expect(warn).toHaveBeenCalled();
  });
});

describe("agent-session-shadow — runtime not ready", () => {
  it("noops every method when runtime.ready is false", async () => {
    const stub: AgentSessionShadowRuntime = {
      ready: false,
      snapshot: makeEmptySnapshot(),
      createIntent: () => {
        throw new Error("should not be called");
      },
      dispatchAsync: async () => {
        throw new Error("should not be called");
      },
    };
    const shadow = createAgentSessionShadow(stub, { generateId, warn });
    expect(await shadow.onUserTurn("hi")).toBe(null);
    expect(await shadow.onModelInvocation("large")).toBe(null);
    await shadow.onToolCall("c1", "t1", {});
    await shadow.onToolResult("c1", "ok", {});
    await shadow.onAssistantSettled("done");
    await shadow.onSessionStop();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("agent-session-shadow — conversation projection", () => {
  it("starts empty and grows turn by turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    expect(shadow.getConversation().turns).toEqual([]);

    await shadow.onUserTurn("hello");
    let conv = shadow.getConversation();
    expect(conv.turns).toHaveLength(1);
    expect(conv.turns[0]).toMatchObject({
      turnId: "id-1",
      userText: "hello",
      steps: [],
      settledText: null,
      stopped: false,
    });

    await shadow.onModelInvocation("large");
    await shadow.onToolCall("c1", "inspectFocus", { ref: "node:1" });
    await shadow.onToolResult("c1", "ok", { focus: { id: "node:1" } });
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("Nothing is focused.");
    conv = shadow.getConversation();
    expect(conv.turns).toHaveLength(1);
    const turn = conv.turns[0]!;
    expect(turn.settledText).toBe("Nothing is focused.");
    expect(turn.steps).toHaveLength(3);
    expect(turn.steps[0]).toMatchObject({
      kind: "model-invocation",
      invocationId: "id-2",
      tier: "large",
    });
    expect(turn.steps[1]).toMatchObject({
      kind: "tool-call",
      callId: "c1",
      toolName: "inspectFocus",
      input: { ref: "node:1" },
      output: { focus: { id: "node:1" } },
      outcome: "ok",
    });
    expect(turn.steps[2]).toMatchObject({
      kind: "model-invocation",
      invocationId: "id-3",
      tier: "large",
    });
  });

  it("groups multiple turns separately", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    await shadow.onUserTurn("first");
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("first response");
    await shadow.onUserTurn("second");
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("second response");
    const turns = shadow.getConversation().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      turnId: "id-1",
      userText: "first",
      settledText: "first response",
    });
    expect(turns[1]).toMatchObject({
      turnId: "id-3",
      userText: "second",
      settledText: "second response",
    });
  });

  it("does not pollute projection when MEL dispatch rejects", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
      warn,
    });
    // recordToolCall before any user turn — phase is idle, MEL rejects.
    await shadow.onToolCall("c1", "foo", { ref: 1 });
    expect(shadow.getConversation().turns).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("settleToolCallInCurrentTurn updates the matching pending step", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    await shadow.onUserTurn("x");
    await shadow.onModelInvocation("large");
    await shadow.onToolCall("c1", "tool1", {});
    let turn = shadow.getConversation().turns[0]!;
    const pendingStep = turn.steps[1];
    expect(pendingStep).toMatchObject({
      kind: "tool-call",
      output: null,
      outcome: null,
    });
    await shadow.onToolResult("c1", "ok", { settled: true });
    turn = shadow.getConversation().turns[0]!;
    expect(turn.steps[1]).toMatchObject({
      kind: "tool-call",
      callId: "c1",
      output: { settled: true },
      outcome: "ok",
    });
  });

  it("subscribe + getConversation give listeners a path to re-render", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    let calls = 0;
    const off = shadow.subscribe(() => {
      calls += 1;
    });
    await shadow.onUserTurn("hello");
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("hi");
    expect(calls).toBe(3);
    off();
    await shadow.onUserTurn("again");
    expect(calls).toBe(3);
  });

  it("clearConversation resets the projection without touching MEL", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    await shadow.onUserTurn("hello");
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled("ok");
    expect(shadow.getConversation().turns).toHaveLength(1);
    shadow.clearConversation();
    expect(shadow.getConversation().turns).toHaveLength(0);
    // MEL state untouched: phase is still settled, turnCount is still 1.
    expect(readSnapshot(core)).toMatchObject({
      phase: "settled",
      turnCount: 1,
    });
  });

  it("flags turn as stopped when recordSessionStop fires mid-turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeRuntimeOver(core), {
      generateId,
    });
    await shadow.onUserTurn("hello");
    await shadow.onModelInvocation("large");
    await shadow.onSessionStop();
    const turn = shadow.getConversation().turns[0]!;
    expect(turn.stopped).toBe(true);
    expect(turn.settledText).toBe(null);
  });
});

describe("agent-session-shadow — classifyToolOutcome", () => {
  it("returns ok for { ok: true, output: { status: 'completed' } }", () => {
    expect(
      classifyToolOutcome({ ok: true, output: { status: "completed" } }),
    ).toBe("ok");
  });
  it("returns ok for { ok: true, output: { ... } } with no status", () => {
    expect(classifyToolOutcome({ ok: true, output: { foo: "bar" } })).toBe("ok");
  });
  it("returns blocked for status: unavailable / rejected / blocked", () => {
    for (const status of ["unavailable", "rejected", "blocked"] as const) {
      expect(classifyToolOutcome({ ok: true, output: { status } })).toBe(
        "blocked",
      );
    }
  });
  it("returns error for { ok: false } without admission kind", () => {
    expect(classifyToolOutcome({ ok: false, kind: "runtime_error" })).toBe(
      "error",
    );
  });
  it("returns blocked for admission rejection", () => {
    expect(
      classifyToolOutcome({ ok: false, kind: "admission_rejected" }),
    ).toBe("blocked");
  });
  it("returns error for non-object input", () => {
    expect(classifyToolOutcome(null)).toBe("error");
    expect(classifyToolOutcome("oops")).toBe("error");
  });
});

function makeEmptySnapshot(): AgentSessionSnapshot {
  return {
    phase: "idle",
    currentTurnId: null,
    lastUserText: null,
    lastModelError: null,
    pendingToolCallId: null,
    pendingToolName: null,
    lastToolCallId: null,
    lastToolName: null,
    lastToolOutcome: null,
    lastResponseFinal: null,
    budgetUsedMc: 0,
    budgetCeilingMc: 0,
    lastAnchorId: null,
    lastAnchorFromWorldId: null,
    lastAnchorToWorldId: null,
    lastAnchorTopic: null,
    lastAnchorSummary: null,
    anchorCount: 0,
    turnCount: 0,
    toolCallCount: 0,
    modelInvocationCount: 0,
    idle: true,
    awaitingUser: false,
    canStartTurn: true,
    isProcessing: false,
    budgetExhausted: false,
    canInvokeModel: true,
  };
}
