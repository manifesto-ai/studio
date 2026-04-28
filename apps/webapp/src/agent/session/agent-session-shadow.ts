/**
 * AgentSessionShadow — thin recorder that mirrors the AI SDK chat
 * lifecycle into the AgentSession Manifesto runtime.
 *
 * Used in step 2 of the AgentSession migration: AgentLens still owns
 * the chat via `useChat`, but every meaningful event (user prompt,
 * model invocation, tool call/result, settled response, stop) is
 * dispatched in parallel into AgentSession so its lineage grows with
 * real conversations. This validates the schema before we cut over
 * to make AgentSession the source of truth.
 *
 * Discipline:
 *   - Never throws into the chat flow. Every dispatch is wrapped
 *     in try/catch + console.warn.
 *   - Awaits dispatches so `recordUserTurn` settles before
 *     `recordModelInvocation` fires. Without sequencing, the second
 *     dispatch hits the wrong phase and gets rejected.
 *   - Logs (but does not surface to the user) when the runtime
 *     rejects a dispatch. The AgentSession snapshot is the source of
 *     truth — if its phase doesn't advance, the shadow stays out of
 *     sync until the next user turn.
 *   - When the runtime is not yet ready (build still in flight), all
 *     methods noop. This keeps app boot resilient.
 */
import type { Intent, StudioDispatchResult } from "@manifesto-ai/studio-core";
import type {
  AgentSessionSnapshot,
  ConversationProjection,
  ModelTier,
  ToolOutcome,
  TurnEntry,
  TurnStep,
} from "./agent-session-types.js";
import { EMPTY_CONVERSATION } from "./agent-session-types.js";

/**
 * Minimal slice of the AgentSession runtime the shadow needs.
 * Matches `AgentSessionContextValue` shape but kept narrow so tests
 * can pass a stub without constructing a React context.
 */
export type AgentSessionShadowRuntime = {
  readonly ready: boolean;
  readonly snapshot: AgentSessionSnapshot;
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
};

export type AgentSessionShadow = {
  readonly snapshot: AgentSessionSnapshot;
  readonly ready: boolean;
  /** Current host-side conversation projection. Updated only on successful MEL dispatch. */
  readonly getConversation: () => ConversationProjection;
  /** Subscribe to projection changes. Returns unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Drop the projection back to empty. Does NOT touch MEL — call resetSession on the runtime separately if needed. */
  readonly clearConversation: () => void;
  /**
   * Look up the input body for a tool call by callId. Used by the
   * driver during tool execution — the tool's actual input lives
   * here, not in MEL state, because input bodies can be large JSON.
   * Returns null if the call hasn't been recorded or has been
   * cleared.
   */
  readonly getToolInput: (callId: string) => unknown;
  /** Record a user turn. Returns the generated turnId on success, null otherwise. */
  readonly onUserTurn: (text: string) => Promise<string | null>;
  /** Record a model invocation. Returns the generated invocationId on success, null otherwise. */
  readonly onModelInvocation: (tier: ModelTier) => Promise<string | null>;
  /** Record a tool call about to be executed. Returns true if dispatch settled. */
  readonly onToolCall: (
    callId: string,
    toolName: string,
    input: unknown,
  ) => Promise<boolean>;
  /** Record a tool call result after execution. Returns true if dispatch settled. */
  readonly onToolResult: (
    callId: string,
    outcome: ToolOutcome,
    output: unknown,
  ) => Promise<boolean>;
  /** Record a settled assistant response. Returns true if dispatch settled. */
  readonly onAssistantSettled: (finalText: string) => Promise<boolean>;
  /** Record a system-level model invocation failure (network, API error). */
  readonly onModelInvocationFailed: (reason: string) => Promise<boolean>;
  /** Record an explicit session stop (user pressed stop / budget exhausted). */
  readonly onSessionStop: () => Promise<boolean>;
  /** Record an inference cost delta (millicents). */
  readonly recordBudget: (deltaMc: number) => Promise<boolean>;
};

export type CreateAgentSessionShadowOptions = {
  /** Override the id generator. Defaults to crypto.randomUUID with a fallback. */
  readonly generateId?: () => string;
  /** Override the warn sink. Defaults to console.warn. */
  readonly warn?: (message: string, detail?: unknown) => void;
};

export function createAgentSessionShadow(
  runtime: AgentSessionShadowRuntime,
  options: CreateAgentSessionShadowOptions = {},
): AgentSessionShadow {
  const generateId = options.generateId ?? defaultGenerateId;
  const warn = options.warn ?? defaultWarn;

  // Projection state. Replaced (not mutated) on every change so React
  // identity equality works for memoization. Starts empty; resets only
  // via clearConversation (when the host explicitly drops history).
  let conversation: ConversationProjection = EMPTY_CONVERSATION;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const l of listeners) l();
  }

  function setConversation(next: ConversationProjection): void {
    conversation = next;
    emit();
  }

  async function dispatchSafe(
    label: string,
    action: string,
    args: readonly unknown[],
  ): Promise<boolean> {
    if (!runtime.ready) return false;
    let intent: Intent;
    try {
      intent = runtime.createIntent(action, ...args);
    } catch (err) {
      warn(`[agent-session-shadow] createIntent("${action}") threw`, err);
      return false;
    }
    let result: StudioDispatchResult;
    try {
      result = await runtime.dispatchAsync(intent);
    } catch (err) {
      warn(`[agent-session-shadow] ${label} dispatchAsync threw`, err);
      return false;
    }
    if (result.kind !== "completed") {
      warn(`[agent-session-shadow] ${label} not completed`, {
        action,
        result,
        snapshotPhase: runtime.snapshot.phase,
      });
      return false;
    }
    return true;
  }

  return {
    get snapshot() {
      return runtime.snapshot;
    },
    get ready() {
      return runtime.ready;
    },
    getConversation: () => conversation,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clearConversation: () => {
      setConversation(EMPTY_CONVERSATION);
    },
    getToolInput: (callId) => {
      // Walk newest turn backwards looking for the matching call;
      // most lookups happen on the active turn, so this is O(steps
      // in the active turn) ≈ O(small).
      for (let t = conversation.turns.length - 1; t >= 0; t -= 1) {
        const turn = conversation.turns[t]!;
        for (let i = turn.steps.length - 1; i >= 0; i -= 1) {
          const step = turn.steps[i]!;
          if (step.kind === "tool-call" && step.callId === callId) {
            return step.input;
          }
        }
      }
      return null;
    },
    onUserTurn: async (text) => {
      const turnId = generateId();
      const ok = await dispatchSafe("onUserTurn", "recordUserTurn", [
        turnId,
        text,
      ]);
      if (!ok) return null;
      const turn: TurnEntry = {
        turnId,
        userText: text,
        steps: [],
        settledText: null,
        stopped: false,
        errorReason: null,
      };
      setConversation({ turns: [...conversation.turns, turn] });
      return turnId;
    },
    onModelInvocation: async (tier) => {
      const invocationId = generateId();
      const ok = await dispatchSafe(
        "onModelInvocation",
        "recordModelInvocation",
        [invocationId, tier],
      );
      if (!ok) return null;
      const step: TurnStep = { kind: "model-invocation", invocationId, tier };
      setConversation(appendStepToCurrentTurn(conversation, step));
      return invocationId;
    },
    onToolCall: async (callId, toolName, input) => {
      // Bodies live in projection only — MEL takes just the
      // skeleton (callId + name). Input is captured in the projection
      // step so the driver can later look it up via getToolInput().
      const ok = await dispatchSafe("onToolCall", "recordToolCall", [
        callId,
        toolName,
      ]);
      if (!ok) return false;
      const step: TurnStep = {
        kind: "tool-call",
        callId,
        toolName,
        input,
        output: null,
        outcome: null,
      };
      setConversation(appendStepToCurrentTurn(conversation, step));
      return true;
    },
    onToolResult: async (callId, outcome, output) => {
      // Output body kept in projection; MEL only sees outcome.
      const ok = await dispatchSafe("onToolResult", "recordToolResult", [
        callId,
        outcome,
      ]);
      if (!ok) return false;
      setConversation(settleToolCallInCurrentTurn(conversation, callId, outcome, output));
      return true;
    },
    onAssistantSettled: async (finalText) => {
      const ok = await dispatchSafe(
        "onAssistantSettled",
        "recordAssistantSettled",
        [finalText],
      );
      if (!ok) return false;
      setConversation(settleAssistantInCurrentTurn(conversation, finalText));
      return true;
    },
    onModelInvocationFailed: async (reason) => {
      const ok = await dispatchSafe(
        "onModelInvocationFailed",
        "recordModelInvocationFailed",
        [reason],
      );
      if (!ok) return false;
      setConversation(failCurrentTurn(conversation, reason));
      return true;
    },
    onSessionStop: async () => {
      const ok = await dispatchSafe("onSessionStop", "recordSessionStop", []);
      if (!ok) return false;
      setConversation(stopCurrentTurn(conversation));
      return true;
    },
    recordBudget: async (deltaMc) => {
      // Cost tracking — fire-and-forget through the dispatcher seam.
      // No projection update; budgetUsedMc lives in MEL state and is
      // observable via the snapshot.
      return dispatchSafe("recordBudget", "recordBudget", [deltaMc]);
    },
  };
}

// ---------- Projection update helpers (pure) -------------------------------

function appendStepToCurrentTurn(
  conv: ConversationProjection,
  step: TurnStep,
): ConversationProjection {
  if (conv.turns.length === 0) return conv;
  const turns = conv.turns.slice();
  const last = turns[turns.length - 1]!;
  turns[turns.length - 1] = { ...last, steps: [...last.steps, step] };
  return { turns };
}

function settleToolCallInCurrentTurn(
  conv: ConversationProjection,
  callId: string,
  outcome: ToolOutcome,
  output: unknown,
): ConversationProjection {
  if (conv.turns.length === 0) return conv;
  const turns = conv.turns.slice();
  const last = turns[turns.length - 1]!;
  const steps = last.steps.slice();
  // Settle the most recent matching tool-call step that is still pending.
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]!;
    if (
      step.kind === "tool-call" &&
      step.callId === callId &&
      step.output === null
    ) {
      steps[i] = { ...step, output, outcome };
      break;
    }
  }
  turns[turns.length - 1] = { ...last, steps };
  return { turns };
}

function settleAssistantInCurrentTurn(
  conv: ConversationProjection,
  finalText: string,
): ConversationProjection {
  if (conv.turns.length === 0) return conv;
  const turns = conv.turns.slice();
  const last = turns[turns.length - 1]!;
  turns[turns.length - 1] = { ...last, settledText: finalText };
  return { turns };
}

function stopCurrentTurn(conv: ConversationProjection): ConversationProjection {
  if (conv.turns.length === 0) return conv;
  const turns = conv.turns.slice();
  const last = turns[turns.length - 1]!;
  turns[turns.length - 1] = { ...last, stopped: true };
  return { turns };
}

function failCurrentTurn(
  conv: ConversationProjection,
  reason: string,
): ConversationProjection {
  if (conv.turns.length === 0) return conv;
  const turns = conv.turns.slice();
  const last = turns[turns.length - 1]!;
  turns[turns.length - 1] = { ...last, errorReason: reason };
  return { turns };
}

function defaultGenerateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function defaultWarn(message: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(message);
  } else {
    console.warn(message, detail);
  }
}

/**
 * Map a ToolRunResult-shaped output to the AgentSession ToolOutcome
 * the shadow records. Tools today return either:
 *   - { ok: true, output }                              → "ok"
 *   - { ok: false, kind: "runtime_error" | ... }        → "error"
 *   - { ok: true, output: { status: "blocked"/etc } }   → "blocked"
 *   - admission rejection (top-level ok=false from
 *     `admitToolCall`)                                  → "blocked"
 *
 * Kept here next to the shadow because the mapping is shadow-local —
 * AgentSession itself only sees the resulting outcome string.
 */
export function classifyToolOutcome(result: unknown): ToolOutcome {
  if (result === null || typeof result !== "object") return "error";
  const top = result as Record<string, unknown>;
  if (top.ok === false) {
    const kind = top.kind;
    if (kind === "tool_unavailable" || kind === "admission_rejected") {
      return "blocked";
    }
    return "error";
  }
  const body = top.output as Record<string, unknown> | undefined;
  if (body !== undefined) {
    const status = body.status;
    if (
      status === "unavailable" ||
      status === "rejected" ||
      status === "blocked"
    ) {
      return "blocked";
    }
    if (status === "failed") return "error";
  }
  return "ok";
}
