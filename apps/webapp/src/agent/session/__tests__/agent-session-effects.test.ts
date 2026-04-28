/**
 * AgentSessionDriver tests.
 *
 * Drives a real AgentSession runtime end-to-end with a mock
 * ModelAdapter that yields predetermined event sequences and a mock
 * ToolExecutor that returns predetermined results. The shadow is the
 * production-side dispatcher; we wrap it as `AgentSessionDispatcher`
 * for the driver.
 *
 * What we want to verify:
 *   - Happy path turn (model → settled) drives without intervention.
 *   - Tool-using turn chains through model → tool → model → settled.
 *   - Multiple consecutive tool calls in a single turn work.
 *   - Adapter `failed` events route to recordModelInvocationFailed.
 *   - Stop signal mid-stream halts the loop.
 *   - Empty stream (no events) ends with recordModelInvocationFailed.
 *   - The driver's subscription is idempotent: stop() is safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStudioCore,
  type StudioCore,
  type StudioDispatchResult,
} from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";
import { createAgentSessionShadow } from "../agent-session-shadow.js";
import {
  createAgentSessionDriver,
  type AgentSessionDispatcher,
  type AgentSessionEffectRuntime,
  type ModelAdapter,
  type ModelStreamEvent,
  type ToolExecutor,
  type ToolExecutionResult,
} from "../agent-session-effects.js";
import type {
  AgentSessionSnapshot,
  SessionPhase,
} from "../agent-session-types.js";

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
    lastAnchorFromWorldId:
      (data.lastAnchorFromWorldId as string | null) ?? null,
    lastAnchorToWorldId: (data.lastAnchorToWorldId as string | null) ?? null,
    lastAnchorSummary: (data.lastAnchorSummary as string | null) ?? null,
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

function makeShadowRuntime(core: StudioCore) {
  return {
    get ready() {
      return true;
    },
    get snapshot() {
      return readSnapshot(core);
    },
    createIntent: (action: string, ...args: unknown[]) =>
      core.createIntent(action, ...args),
    dispatchAsync: (intent: ReturnType<typeof core.createIntent>) =>
      core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      ) as Promise<StudioDispatchResult>,
  };
}

function makeEffectRuntime(core: StudioCore): AgentSessionEffectRuntime {
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
      ) as Promise<StudioDispatchResult>,
    subscribeAfterDispatch: (listener) =>
      core.subscribeAfterDispatch(listener),
  };
}

function shadowAsDispatcher(
  shadow: ReturnType<typeof createAgentSessionShadow>,
): AgentSessionDispatcher {
  return {
    recordModelInvocation: (tier) => shadow.onModelInvocation(tier),
    recordToolCall: (callId, toolName, input) =>
      shadow.onToolCall(callId, toolName, input),
    recordToolResult: (callId, outcome, output) =>
      shadow.onToolResult(callId, outcome, output),
    getToolInput: (callId) => shadow.getToolInput(callId),
    recordAssistantSettled: (finalText) =>
      shadow.onAssistantSettled(finalText),
    recordModelInvocationFailed: (reason) =>
      shadow.onModelInvocationFailed(reason),
    recordBudget: (deltaMc) => shadow.recordBudget(deltaMc),
  };
}

/**
 * Yields each predetermined sequence of stream events on successive
 * adapter.stream() calls. Tracks how many times stream() has been
 * called so a multi-step turn can supply a different event list per
 * model invocation.
 */
function makeMockAdapter(sequences: readonly (readonly ModelStreamEvent[])[]) {
  let calls = 0;
  const adapter: ModelAdapter = {
    stream: async function* () {
      const events = sequences[calls] ?? [];
      calls += 1;
      for (const e of events) {
        // Surrender to the microtask queue so the dispatcher's awaits
        // settle between yields. This lets the runtime's snapshot
        // advance one step at a time, mirroring real streaming.
        await Promise.resolve();
        yield e;
      }
    },
  };
  return {
    adapter,
    get callCount() {
      return calls;
    },
  };
}

function makeMockExecutor(
  responses: ReadonlyMap<string, ToolExecutionResult>,
): { readonly executor: ToolExecutor; readonly callIds: string[] } {
  const callIds: string[] = [];
  const executor: ToolExecutor = {
    execute: async (request) => {
      callIds.push(request.callId);
      return (
        responses.get(request.callId) ?? {
          outcome: "ok",
          output: { default: true },
        }
      );
    },
  };
  return { executor, callIds };
}

async function waitForPhase(
  core: StudioCore,
  target: SessionPhase,
  timeoutMs = 1000,
): Promise<void> {
  if (readSnapshot(core).phase === target) return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      detach();
      reject(
        new Error(
          `Timeout waiting for phase ${target} (current: ${readSnapshot(core).phase})`,
        ),
      );
    }, timeoutMs);
    const detach = core.subscribeAfterDispatch(() => {
      if (readSnapshot(core).phase === target) {
        clearTimeout(timer);
        detach();
        resolve();
      }
    });
  });
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

describe("AgentSessionDriver — happy path", () => {
  it("drives a model-only turn to settled", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [
        { kind: "text-delta", delta: "Hello" },
        { kind: "text-delta", delta: " there." },
        { kind: "settled", finalText: "Hello there." },
      ],
    ]);
    const { executor } = makeMockExecutor(new Map());
    const textChunks: string[] = [];
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
      handlers: { onTextDelta: (d) => textChunks.push(d) },
    });
    try {
      await shadow.onUserTurn("hi");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core)).toMatchObject({
        phase: "settled",
        lastResponseFinal: "Hello there.",
        modelInvocationCount: 1,
      });
      expect(textChunks).toEqual(["Hello", " there."]);
    } finally {
      driver.stop();
    }
  });

  it("chains model → tool → model → settled in one turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [
        {
          kind: "tool-call",
          callId: "c1",
          toolName: "inspectFocus",
          input: { ref: "node:1" },
        },
      ],
      [{ kind: "settled", finalText: "Focus is node:1." }],
    ]);
    const { executor, callIds } = makeMockExecutor(
      new Map([
        ["c1", { outcome: "ok" as const, output: { focus: "node:1" } }],
      ]),
    );
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("what's focused?");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core)).toMatchObject({
        phase: "settled",
        lastResponseFinal: "Focus is node:1.",
        toolCallCount: 1,
        modelInvocationCount: 2,
        lastToolCallId: "c1",
        lastToolOutcome: "ok",
      });
      expect(callIds).toEqual(["c1"]);
    } finally {
      driver.stop();
    }
  });

  it("handles two consecutive tool calls in one turn", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [
        {
          kind: "tool-call",
          callId: "c1",
          toolName: "inspectFocus",
          input: {},
        },
      ],
      [
        {
          kind: "tool-call",
          callId: "c2",
          toolName: "inspectAvailability",
          input: {},
        },
      ],
      [{ kind: "settled", finalText: "Done." }],
    ]);
    const { executor, callIds } = makeMockExecutor(
      new Map([
        ["c1", { outcome: "ok" as const, output: { a: 1 } }],
        ["c2", { outcome: "ok" as const, output: { b: 2 } }],
      ]),
    );
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("trace this");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core)).toMatchObject({
        toolCallCount: 2,
        modelInvocationCount: 3,
        lastResponseFinal: "Done.",
      });
      expect(callIds).toEqual(["c1", "c2"]);
    } finally {
      driver.stop();
    }
  });
});

describe("AgentSessionDriver — failure paths", () => {
  it("settles as failed when adapter emits a failed event", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [{ kind: "failed", reason: "API 500" }],
    ]);
    const { executor } = makeMockExecutor(new Map());
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("oops");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core)).toMatchObject({
        phase: "settled",
        lastModelError: "API 500",
        lastResponseFinal: null,
      });
    } finally {
      driver.stop();
    }
  });

  it("settles as failed when adapter throws mid-stream", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const adapter: ModelAdapter = {
      stream: async function* () {
        await Promise.resolve();
        yield { kind: "text-delta", delta: "partial" };
        await Promise.resolve();
        throw new Error("boom");
      },
    };
    const { executor } = makeMockExecutor(new Map());
    const onUnexpectedError = vi.fn();
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
      handlers: { onUnexpectedError },
    });
    try {
      await shadow.onUserTurn("oops");
      await waitForPhase(core, "settled");
      // The catch block dispatches recordModelInvocationFailed first
      // (which is what waitForPhase observes) and then calls
      // onUnexpectedError on the next tick. Flush so the assertion
      // sees it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(readSnapshot(core).lastModelError).toBe("boom");
      expect(onUnexpectedError).toHaveBeenCalled();
    } finally {
      driver.stop();
    }
  });

  it("settles with empty content when stream ends without a terminal event", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([[]]); // empty events
    const { executor } = makeMockExecutor(new Map());
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("silent");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core).lastModelError).toBe(
        "stream ended without content",
      );
    } finally {
      driver.stop();
    }
  });

  it("settles with accumulated text when stream ends after deltas only", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [{ kind: "text-delta", delta: "partial response" }],
    ]);
    const { executor } = makeMockExecutor(new Map());
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("hi");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core).lastResponseFinal).toBe("partial response");
    } finally {
      driver.stop();
    }
  });

  it("records tool execution errors as outcome=error", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    const { adapter } = makeMockAdapter([
      [
        {
          kind: "tool-call",
          callId: "c1",
          toolName: "broken",
          input: {},
        },
      ],
      [{ kind: "settled", finalText: "done despite failure" }],
    ]);
    const executor: ToolExecutor = {
      execute: async () => {
        throw new Error("tool exploded");
      },
    };
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      await shadow.onUserTurn("call broken");
      await waitForPhase(core, "settled");
      expect(readSnapshot(core)).toMatchObject({
        lastToolCallId: "c1",
        lastToolOutcome: "error",
      });
    } finally {
      driver.stop();
    }
  });
});

describe("AgentSessionDriver — cost tracking", () => {
  it("dispatches recordBudget after a successful model invocation", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const { adapter } = makeMockAdapter([
      [{ kind: "settled", finalText: "ok" }],
    ]);
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher: shadowAsDispatcher(shadow),
      modelAdapter: adapter,
      toolExecutor: makeMockExecutor(new Map()).executor,
      defaultTier: "large",
      // Default tier costs: large=100
    });
    try {
      await shadow.onUserTurn("hi");
      await waitForPhase(core, "settled");
      // recordBudget is fire-and-forget — flush microtasks once.
      await new Promise((r) => setTimeout(r, 0));
      expect(readSnapshot(core).budgetUsedMc).toBe(100);
    } finally {
      driver.stop();
    }
  });

  it("accumulates cost across multi-step turns (one charge per invocation)", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const { adapter } = makeMockAdapter([
      [
        {
          kind: "tool-call",
          callId: "c1",
          toolName: "inspectFocus",
          input: {},
        },
      ],
      [{ kind: "settled", finalText: "done" }],
    ]);
    const { executor } = makeMockExecutor(
      new Map([["c1", { outcome: "ok" as const, output: {} }]]),
    );
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher: shadowAsDispatcher(shadow),
      modelAdapter: adapter,
      toolExecutor: executor,
      defaultTier: "small", // small=10
    });
    try {
      await shadow.onUserTurn("trace");
      await waitForPhase(core, "settled");
      await new Promise((r) => setTimeout(r, 0));
      // Two invocations × 10 mc = 20 mc.
      expect(readSnapshot(core).budgetUsedMc).toBe(20);
      expect(readSnapshot(core).modelInvocationCount).toBe(2);
    } finally {
      driver.stop();
    }
  });

  it("respects a custom costByTier mapping", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const { adapter } = makeMockAdapter([
      [{ kind: "settled", finalText: "ok" }],
    ]);
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher: shadowAsDispatcher(shadow),
      modelAdapter: adapter,
      toolExecutor: makeMockExecutor(new Map()).executor,
      defaultTier: "large",
      costByTier: { tiny: 1, small: 5, mid: 25, large: 250 },
    });
    try {
      await shadow.onUserTurn("hi");
      await waitForPhase(core, "settled");
      await new Promise((r) => setTimeout(r, 0));
      expect(readSnapshot(core).budgetUsedMc).toBe(250);
    } finally {
      driver.stop();
    }
  });

  it("blocks subsequent invocations once budget ceiling is hit", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn: vi.fn(),
    });
    // Set a low ceiling that the first large invocation (100 mc) will hit.
    await shadow.recordBudget(0); // ensure starts at 0
    const intent = core.createIntent("setBudgetCeiling", 100);
    await core.dispatchAsync(
      intent as Parameters<typeof core.dispatchAsync>[0],
    );
    expect(readSnapshot(core).budgetCeilingMc).toBe(100);

    const { adapter } = makeMockAdapter([
      [{ kind: "settled", finalText: "first" }],
      [{ kind: "settled", finalText: "second" }],
    ]);
    const onUnexpectedError = vi.fn();
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher: shadowAsDispatcher(shadow),
      modelAdapter: adapter,
      toolExecutor: makeMockExecutor(new Map()).executor,
      defaultTier: "large",
      handlers: { onUnexpectedError },
    });
    try {
      await shadow.onUserTurn("first");
      await waitForPhase(core, "settled");
      await new Promise((r) => setTimeout(r, 0));
      expect(readSnapshot(core).budgetUsedMc).toBe(100);

      // Second turn should be blocked at recordModelInvocation by the
      // budget guard.
      await shadow.onUserTurn("second");
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(onUnexpectedError).toHaveBeenCalled();
      const errMsg = (onUnexpectedError.mock.calls[0]![0] as Error).message;
      expect(errMsg).toContain("recordModelInvocation rejected");
    } finally {
      driver.stop();
    }
  });
});

describe("AgentSessionDriver — concurrency", () => {
  it("stop() is idempotent", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher: shadowAsDispatcher(shadow),
      modelAdapter: makeMockAdapter([]).adapter,
      toolExecutor: makeMockExecutor(new Map()).executor,
    });
    expect(() => {
      driver.stop();
      driver.stop();
      driver.stop();
    }).not.toThrow();
  });

  it("rejects a recordUserTurn dispatched mid-flight without breaking the loop", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
      warn,
    });
    const dispatcher = shadowAsDispatcher(shadow);
    // First turn settles immediately; second turn must wait until first
    // finishes because the runtime's phase guard rejects mid-flight
    // recordUserTurn.
    const { adapter } = makeMockAdapter([
      [{ kind: "settled", finalText: "first response" }],
      [{ kind: "settled", finalText: "second response" }],
    ]);
    const { executor } = makeMockExecutor(new Map());
    const driver = createAgentSessionDriver({
      runtime: makeEffectRuntime(core),
      dispatcher,
      modelAdapter: adapter,
      toolExecutor: executor,
    });
    try {
      // Fire and forget the first turn — don't await onUserTurn so we
      // can interleave a second one before the first settles.
      void shadow.onUserTurn("first");
      // Microtask-yield so the first dispatch lands before we try the
      // second; otherwise both would fail because phase isn't yet
      // awaitingModel for the first one either.
      await Promise.resolve();
      await Promise.resolve();
      // Second turn while first is in flight — runtime should reject.
      const turnId = await shadow.onUserTurn("second");
      expect(turnId).toBe(null);

      await waitForPhase(core, "settled");
      expect(readSnapshot(core).lastResponseFinal).toBe("first response");

      // Now the first has settled — second turn becomes legal.
      const second = await shadow.onUserTurn("second-retry");
      expect(second).not.toBe(null);
      await waitForPhase(core, "settled", 2000);
      expect(readSnapshot(core).lastResponseFinal).toBe("second response");
    } finally {
      driver.stop();
    }
  });
});
