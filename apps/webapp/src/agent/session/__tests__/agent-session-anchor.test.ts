/**
 * AgentSessionAnchorEffect tests.
 *
 * Drives the anchor effect against a real AgentSession runtime + a
 * stub summarizer. The "real" parts: the MEL phase machine, the
 * conversation projection from shadow, and the dispatched
 * `anchorWindow` action. The "mock" parts: the model summarizer
 * (returns a canned string after a microtask delay).
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
  buildAnchorSummaryPrompt,
  createAgentSessionAnchorEffect,
  type AnchorDispatcher,
  type AnchorSummarizeArgs,
  type AnchorSummarizer,
} from "../agent-session-anchor.js";
import type { AgentSessionEffectRuntime } from "../agent-session-effects.js";
import type {
  AgentSessionSnapshot,
  TurnEntry,
} from "../agent-session-types.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentSessionMelSource = readFileSync(
  join(here, "..", "..", "..", "domain", "agent-session.mel"),
  "utf8",
);

async function bootRuntime() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({
    initialSource: agentSessionMelSource,
  });
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

function makeRuntime(core: StudioCore): AgentSessionEffectRuntime {
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

function makeAnchorDispatcher(core: StudioCore): AnchorDispatcher {
  return {
    anchorWindow: async (fromWorldId, toWorldId, summary) => {
      const intent = core.createIntent(
        "anchorWindow",
        fromWorldId,
        toWorldId,
        summary,
      );
      const result = (await core.dispatchAsync(
        intent as Parameters<typeof core.dispatchAsync>[0],
      )) as StudioDispatchResult;
      return result.kind === "completed";
    },
  };
}

/** Walks the runtime through N completed turns. */
async function settleTurns(
  shadow: ReturnType<typeof createAgentSessionShadow>,
  turns: readonly { readonly user: string; readonly assistant: string }[],
): Promise<void> {
  for (const turn of turns) {
    await shadow.onUserTurn(turn.user);
    await shadow.onModelInvocation("large");
    await shadow.onAssistantSettled(turn.assistant);
  }
}

let idCounter: number;
const generateId = () => `id-${++idCounter}`;

beforeEach(() => {
  idCounter = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAgentSessionAnchorEffect — trigger policy", () => {
  it("does not anchor when below threshold", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi.fn(async () => "should not be called");
    const dispatcher = makeAnchorDispatcher(core);
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-X",
      dispatcher,
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 5 },
    });
    try {
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
        { user: "c", assistant: "3" },
        { user: "d", assistant: "4" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      expect(summarize).not.toHaveBeenCalled();
      expect(readSnapshot(core).lastAnchorSummary).toBe(null);
    } finally {
      effect.stop();
    }
  });

  it("anchors when threshold is crossed and dispatches anchorWindow", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi.fn(
      async (_args: AnchorSummarizeArgs) => "session summary one",
    );
    const onAnchorSettled = vi.fn();
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-end-of-window-1",
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 3 },
      handlers: { onAnchorSettled },
    });
    try {
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
        { user: "c", assistant: "3" },
      ]);
      // Effect runs in microtask queue after the third recordAssistantSettled.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(summarize).toHaveBeenCalledTimes(1);
      const callArgs = summarize.mock.calls[0]![0]!;
      expect(callArgs.turns).toHaveLength(3);
      expect(callArgs.priorAnchor).toBe(null);

      const snap = readSnapshot(core);
      expect(snap.lastAnchorSummary).toBe("session summary one");
      expect(snap.lastAnchorFromWorldId).toBe("session-start");
      expect(snap.lastAnchorToWorldId).toBe("world-end-of-window-1");
      expect(onAnchorSettled).toHaveBeenCalledWith({
        fromWorldId: "session-start",
        toWorldId: "world-end-of-window-1",
        summary: "session summary one",
      });
    } finally {
      effect.stop();
    }
  });

  it("uses prior anchor as context for the next anchor and chains from/to ids", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarizeReturns = ["first anchor", "second anchor"];
    let toIdReturn = "world-A";
    const summarize = vi.fn(
      async (_args: AnchorSummarizeArgs) => summarizeReturns.shift()!,
    );
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => toIdReturn,
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 2 },
    });
    try {
      // First two turns trigger first anchor.
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(readSnapshot(core).lastAnchorSummary).toBe("first anchor");
      expect(readSnapshot(core).lastAnchorFromWorldId).toBe("session-start");
      expect(readSnapshot(core).lastAnchorToWorldId).toBe("world-A");

      // Two more turns trigger second anchor.
      toIdReturn = "world-B";
      await settleTurns(shadow, [
        { user: "c", assistant: "3" },
        { user: "d", assistant: "4" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(summarize).toHaveBeenCalledTimes(2);
      const secondCall = summarize.mock.calls[1]![0]!;
      expect(secondCall.priorAnchor).toBe("first anchor");
      expect(secondCall.turns).toHaveLength(2);
      expect(readSnapshot(core).lastAnchorSummary).toBe("second anchor");
      expect(readSnapshot(core).lastAnchorFromWorldId).toBe("world-A");
      expect(readSnapshot(core).lastAnchorToWorldId).toBe("world-B");
    } finally {
      effect.stop();
    }
  });

  it("does not anchor when policy.turnsBetweenAnchors is 0", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi.fn(async () => "x");
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-X",
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 0 },
    });
    try {
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
        { user: "c", assistant: "3" },
        { user: "d", assistant: "4" },
        { user: "e", assistant: "5" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      expect(summarize).not.toHaveBeenCalled();
    } finally {
      effect.stop();
    }
  });
});

describe("createAgentSessionAnchorEffect — robustness", () => {
  it("swallows summarizer failures and keeps trying on next eligible settle", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi
      .fn<AnchorSummarizer["summarize"]>()
      .mockImplementationOnce(async () => {
        throw new Error("first try fails");
      })
      .mockImplementationOnce(async () => "second try works");
    const onAnchorFailed = vi.fn();
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-X",
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 2 },
      handlers: { onAnchorFailed },
    });
    try {
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(onAnchorFailed).toHaveBeenCalledTimes(1);
      expect(readSnapshot(core).lastAnchorSummary).toBe(null);

      // Two more turns — eligibility re-evaluates and second attempt succeeds.
      await settleTurns(shadow, [
        { user: "c", assistant: "3" },
        { user: "d", assistant: "4" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(summarize).toHaveBeenCalledTimes(2);
      expect(readSnapshot(core).lastAnchorSummary).toBe("second try works");
    } finally {
      effect.stop();
    }
  });

  it("does not anchor with empty summary text", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi.fn(async () => "   ");
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-X",
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 2 },
    });
    try {
      await settleTurns(shadow, [
        { user: "a", assistant: "1" },
        { user: "b", assistant: "2" },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(readSnapshot(core).lastAnchorSummary).toBe(null);
    } finally {
      effect.stop();
    }
  });

  it("stop() is idempotent and prevents post-stop anchoring", async () => {
    const core = await bootRuntime();
    const shadow = createAgentSessionShadow(makeShadowRuntime(core), {
      generateId,
    });
    const summarize = vi.fn(async () => "won't matter");
    const effect = createAgentSessionAnchorEffect({
      runtime: makeRuntime(core),
      conversation: () => shadow.getConversation(),
      getLatestWorldId: () => "world-X",
      dispatcher: makeAnchorDispatcher(core),
      summarizer: { summarize },
      policy: { turnsBetweenAnchors: 1 },
    });
    effect.stop();
    effect.stop(); // idempotent
    await settleTurns(shadow, [{ user: "a", assistant: "1" }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe("buildAnchorSummaryPrompt", () => {
  it("includes prior anchor section when provided", () => {
    const turns: TurnEntry[] = [
      {
        turnId: "t1",
        userText: "hi",
        steps: [],
        settledText: "hello",
        stopped: false,
        errorReason: null,
      },
    ];
    const prompt = buildAnchorSummaryPrompt(turns, "earlier summary text");
    expect(prompt).toContain("Earlier session context");
    expect(prompt).toContain("earlier summary text");
    expect(prompt).toContain("New turns to incorporate");
  });

  it("omits prior anchor section when null", () => {
    const turns: TurnEntry[] = [
      {
        turnId: "t1",
        userText: "hi",
        steps: [],
        settledText: "hello",
        stopped: false,
        errorReason: null,
      },
    ];
    const prompt = buildAnchorSummaryPrompt(turns, null);
    expect(prompt).not.toContain("Earlier session context");
  });

  it("lists tool names when steps include tool calls", () => {
    const turns: TurnEntry[] = [
      {
        turnId: "t1",
        userText: "what's focused?",
        steps: [
          {
            kind: "tool-call",
            callId: "c1",
            toolName: "inspectFocus",
            input: {},
            output: { focus: null },
            outcome: "ok",
          },
          {
            kind: "model-invocation",
            invocationId: "i1",
            tier: "large",
          },
        ],
        settledText: "Nothing focused.",
        stopped: false,
        errorReason: null,
      },
    ];
    const prompt = buildAnchorSummaryPrompt(turns, null);
    expect(prompt).toContain("Tools: inspectFocus");
  });
});
