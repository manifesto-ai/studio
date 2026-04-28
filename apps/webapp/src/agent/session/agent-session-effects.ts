/**
 * AgentSessionDriver — orchestrates the agent's turn lifecycle by
 * subscribing to AgentSession phase transitions and invoking the
 * host's model + tool effect handlers. Replaces the AI SDK's useChat
 * loop (which currently owns the model HTTP call and the auto-resend
 * after tool results) with a Manifesto-native dispatch chain.
 *
 * Responsibilities:
 *   - When phase transitions to `awaitingModel`, the driver calls the
 *     ModelAdapter, consumes its event stream, and dispatches
 *     recordToolCall / recordAssistantSettled / recordModelInvocationFailed
 *     based on what the model emits.
 *   - When phase transitions to `awaitingTool`, the driver calls the
 *     ToolExecutor with the pending tool call info from the snapshot
 *     and dispatches recordToolResult.
 *   - After each stage settles, the driver re-checks the current
 *     phase and chains into the next stage automatically. A turn
 *     that interleaves model → tool → model → settled drives itself.
 *
 * Boundary discipline (agent/session/ — future-core):
 *   - No React, no AI SDK, no webapp aliases.
 *   - All effects are injected via interface arguments.
 *   - The driver doesn't know what model is being called or which
 *     transport carries it; the ModelAdapter abstracts that.
 *
 * In step 5a this driver is shipped as infrastructure but NOT wired
 * to AgentLens. Tests verify it can drive a turn end-to-end against
 * a mock adapter + executor. Step 5b swaps useChat out and routes
 * production through this driver.
 */
import type { Intent, StudioDispatchResult } from "@manifesto-ai/studio-core";
import type {
  AgentSessionSnapshot,
  ModelTier,
  ToolOutcome,
} from "./agent-session-types.js";

// ---------- Model adapter ---------------------------------------------------

/**
 * Events the ModelAdapter emits while streaming a model invocation.
 * The driver consumes them in order and translates them into MEL
 * dispatches.
 *
 * Streaming-text strategy decision (v0): text deltas accumulate in
 * the host-side `onTextDelta` callback (UI-only buffer) — they do
 * NOT enter MEL. Only `tool-call` / `settled` / `failed` events
 * become world dispatches. This keeps lineage focused on decisions
 * and avoids the "500 worlds per response" failure mode.
 */
export type ModelStreamEvent =
  | { readonly kind: "text-delta"; readonly delta: string }
  | {
      readonly kind: "tool-call";
      readonly callId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly kind: "settled"; readonly finalText: string }
  | { readonly kind: "failed"; readonly reason: string };

export type ModelStreamArgs = {
  readonly tier: ModelTier;
  readonly invocationId: string;
  readonly snapshot: AgentSessionSnapshot;
  readonly signal?: AbortSignal;
};

export type ModelAdapter = {
  readonly stream: (args: ModelStreamArgs) => AsyncIterable<ModelStreamEvent>;
};

// ---------- Tool executor ---------------------------------------------------

export type ToolExecutionRequest = {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly snapshot: AgentSessionSnapshot;
};

export type ToolExecutionResult = {
  readonly outcome: ToolOutcome;
  readonly output: unknown;
};

export type ToolExecutor = {
  readonly execute: (
    request: ToolExecutionRequest,
  ) => Promise<ToolExecutionResult>;
};

// ---------- Dispatcher contract --------------------------------------------

/**
 * Narrow seam the driver uses to write into AgentSession. Implemented
 * by `AgentSessionShadow` in production and by stubs in tests. Each
 * method returns a boolean so the driver can detect a rejection
 * (legality gate, runtime not ready, etc.) and stop the loop instead
 * of continuing on a stale assumption about phase.
 */
export type AgentSessionDispatcher = {
  readonly recordModelInvocation: (
    tier: ModelTier,
  ) => Promise<string | null>;
  /**
   * Tool input is captured in the host body store (typically the
   * shadow's projection). MEL receives only the callId + name.
   */
  readonly recordToolCall: (
    callId: string,
    toolName: string,
    input: unknown,
  ) => Promise<boolean>;
  /**
   * Tool output is captured in the host body store. MEL receives
   * only callId + outcome.
   */
  readonly recordToolResult: (
    callId: string,
    outcome: ToolOutcome,
    output: unknown,
  ) => Promise<boolean>;
  readonly recordAssistantSettled: (finalText: string) => Promise<boolean>;
  readonly recordModelInvocationFailed: (reason: string) => Promise<boolean>;
  /**
   * Record a cost delta in millicents for the most recent inference.
   * Called by the driver after each invocation settles. The MEL
   * dispatch is fire-and-forget; failures are swallowed (cost
   * tracking shouldn't break the turn).
   */
  readonly recordBudget: (deltaMc: number) => Promise<boolean>;
  /**
   * Look up the input body the model emitted for this tool call.
   * Returns null when the call hasn't been recorded yet. The driver
   * uses this during tool execution because MEL state holds only
   * callId + name, not the input bytes.
   */
  readonly getToolInput: (callId: string) => unknown;
};

// ---------- Effect runtime --------------------------------------------------

/**
 * The runtime view the driver needs. Larger than `AgentSessionShadowRuntime`
 * because the driver also subscribes to phase transitions (which the
 * shadow doesn't need — the shadow is fired from the host side
 * imperatively). In production this is implemented over the StudioCore
 * via `core.subscribeAfterDispatch`.
 */
export type AgentSessionEffectRuntime = {
  readonly ready: boolean;
  readonly snapshot: AgentSessionSnapshot;
  readonly createIntent: (action: string, ...args: unknown[]) => Intent;
  readonly dispatchAsync: (intent: Intent) => Promise<StudioDispatchResult>;
  /** Returns an unsubscribe handle. Listener fires after every settled dispatch. */
  readonly subscribeAfterDispatch: (
    listener: (result: StudioDispatchResult) => void,
  ) => () => void;
};

// ---------- Driver ----------------------------------------------------------

export type AgentSessionDriverHandlers = {
  /**
   * Live text accumulation for the in-flight assistant response. Fires
   * on every text-delta event. Does NOT enter MEL — host stores in a
   * UI-only buffer so the renderer can show streaming text without
   * polluting lineage. Buffer is cleared by the host on each new turn.
   */
  readonly onTextDelta?: (delta: string) => void;
  /** Called when the driver starts processing a model invocation. */
  readonly onInvocationStart?: (invocationId: string, tier: ModelTier) => void;
  /** Called when the driver finishes processing a model invocation (any outcome). */
  readonly onInvocationEnd?: () => void;
  /** Called when an unexpected error escapes the driver loop. */
  readonly onUnexpectedError?: (err: unknown) => void;
};

export type CreateAgentSessionDriverArgs = {
  readonly runtime: AgentSessionEffectRuntime;
  readonly dispatcher: AgentSessionDispatcher;
  readonly modelAdapter: ModelAdapter;
  readonly toolExecutor: ToolExecutor;
  /** Tier used for every model invocation in v0. step 5c will route per-call. */
  readonly defaultTier?: ModelTier;
  /**
   * Cost in millicents charged to budget per model invocation, by
   * tier. Used by the driver to dispatch recordBudget after each
   * invocation settles. Defaults are placeholder estimates — a real
   * implementation should derive these from the response usage.
   */
  readonly costByTier?: Readonly<Record<ModelTier, number>>;
  readonly handlers?: AgentSessionDriverHandlers;
};

const DEFAULT_COST_BY_TIER: Readonly<Record<ModelTier, number>> = {
  tiny: 1,
  small: 10,
  mid: 50,
  large: 100,
};

export type AgentSessionDriver = {
  /** Tear down the subscription. Idempotent. */
  readonly stop: () => void;
};

export function createAgentSessionDriver(
  args: CreateAgentSessionDriverArgs,
): AgentSessionDriver {
  const {
    runtime,
    dispatcher,
    modelAdapter,
    toolExecutor,
    defaultTier = "large",
    costByTier = DEFAULT_COST_BY_TIER,
    handlers = {},
  } = args;

  // Re-entry guard. The driver receives subscribeAfterDispatch
  // notifications for its own dispatches too (recordModelInvocation,
  // recordToolCall, ...). Without a guard we would recurse: dispatch
  // recordModelInvocation → notification fires → checkAndDrive sees
  // phase=streaming, no-op (good); but mid-flight we don't want to
  // start a SECOND drivenModelCall just because a fresh notification
  // landed. The boolean is fine because all logic runs on the
  // microtask queue (no concurrent mutators).
  let inFlight = false;
  let stopped = false;

  function checkAndDrive(): void {
    if (stopped || inFlight || !runtime.ready) return;
    const phase = runtime.snapshot.phase;
    if (phase === "awaitingModel") {
      inFlight = true;
      void drivenModelCall().finally(() => {
        inFlight = false;
        // After one stage settles, the next dispatch (recordToolCall
        // / recordAssistantSettled) has already moved us forward. If
        // that put us in awaitingTool / awaitingModel again, chain.
        checkAndDrive();
      });
    } else if (phase === "awaitingTool") {
      inFlight = true;
      void drivenToolCall().finally(() => {
        inFlight = false;
        checkAndDrive();
      });
    }
  }

  async function drivenModelCall(): Promise<void> {
    const tier = defaultTier;
    const invocationId = await dispatcher.recordModelInvocation(tier);
    if (invocationId === null) {
      // Budget exhausted, stop requested, or other guard rejection.
      // Force the session to phase=stopped so the checkAndDrive loop
      // doesn't spin forever on awaitingModel — the user can submit
      // a new turn, which transitions back to awaitingModel from
      // stopped (allowed by recordUserTurn's guard).
      const snap = runtime.snapshot;
      handlers.onUnexpectedError?.(
        new Error(
          `recordModelInvocation rejected (phase=${snap.phase}, budgetUsedMc=${snap.budgetUsedMc}, budgetCeilingMc=${snap.budgetCeilingMc}) — stopping session`,
        ),
      );
      try {
        const stopIntent = runtime.createIntent("recordSessionStop");
        await runtime.dispatchAsync(stopIntent);
      } catch {
        // best-effort; if stop also fails the host can recover
      }
      return;
    }
    handlers.onInvocationStart?.(invocationId, tier);
    let accumulatedText = "";
    let terminal = false;
    try {
      const stream = modelAdapter.stream({
        tier,
        invocationId,
        snapshot: runtime.snapshot,
      });
      for await (const event of stream) {
        // Mid-stream stop: dispatch and bail. We accept that the
        // underlying transport may keep buffering; the next iteration
        // simply stops consuming it. phase=stopped is set by
        // recordSessionStop on the host side.
        if (runtime.snapshot.phase === "stopped") break;
        if (event.kind === "text-delta") {
          accumulatedText += event.delta;
          handlers.onTextDelta?.(event.delta);
          continue;
        }
        if (event.kind === "tool-call") {
          await dispatcher.recordToolCall(
            event.callId,
            event.toolName,
            event.input,
          );
          terminal = true;
          break;
        }
        if (event.kind === "settled") {
          const finalText = event.finalText !== "" ? event.finalText : accumulatedText;
          await dispatcher.recordAssistantSettled(finalText);
          terminal = true;
          break;
        }
        if (event.kind === "failed") {
          await dispatcher.recordModelInvocationFailed(event.reason);
          terminal = true;
          break;
        }
      }
      if (!terminal) {
        // Stream ended without a terminal event. Could be: caller
        // closed it, abort fired, or model returned no content. If
        // we got *some* text we settle; otherwise we mark failed so
        // the runtime doesn't stay stuck in `streaming`.
        if (accumulatedText !== "") {
          await dispatcher.recordAssistantSettled(accumulatedText);
        } else if (runtime.snapshot.phase === "streaming") {
          await dispatcher.recordModelInvocationFailed(
            "stream ended without content",
          );
        }
      }
    } catch (err) {
      // Adapter threw mid-stream — settle as failure. We do this
      // best-effort: if MEL rejects (e.g., phase already moved), the
      // host warning is enough.
      if (runtime.snapshot.phase === "streaming") {
        await dispatcher.recordModelInvocationFailed(errorMessage(err));
      }
      handlers.onUnexpectedError?.(err);
    } finally {
      // Charge the budget once per invocation regardless of outcome
      // (a failed call still costs the request). Fire-and-forget;
      // a budget rejection should not propagate into the loop.
      const cost = costByTier[tier] ?? 0;
      if (cost > 0) void dispatcher.recordBudget(cost);
      handlers.onInvocationEnd?.();
    }
  }

  async function drivenToolCall(): Promise<void> {
    const snapshot = runtime.snapshot;
    const callId = snapshot.pendingToolCallId;
    const toolName = snapshot.pendingToolName;
    if (callId === null || toolName === null) {
      // Defensive: we shouldn't reach here without pending fields.
      // The phase guard should have prevented it; if it did, that's
      // a MEL bug worth surfacing.
      handlers.onUnexpectedError?.(
        new Error(
          "drivenToolCall reached without pendingToolCallId / pendingToolName",
        ),
      );
      return;
    }
    // Input body lives in the host body store (dispatcher), not in
    // MEL state. The model already gave us the input when it emitted
    // the tool-call event; the dispatcher captured it then.
    const input = dispatcher.getToolInput(callId);
    let result: ToolExecutionResult;
    try {
      result = await toolExecutor.execute({
        callId,
        toolName,
        input,
        snapshot,
      });
    } catch (err) {
      // Treat executor errors as `error` outcomes. The MEL action
      // accepts any outcome and won't itself throw.
      result = { outcome: "error", output: { error: errorMessage(err) } };
      handlers.onUnexpectedError?.(err);
    }
    await dispatcher.recordToolResult(callId, result.outcome, result.output);
  }

  const detach = runtime.subscribeAfterDispatch((result) => {
    if (result.kind !== "completed") return;
    checkAndDrive();
  });

  // Kick once in case the runtime is already in awaitingModel /
  // awaitingTool when the driver mounts (e.g., a recordUserTurn
  // dispatched before the driver subscribed).
  if (runtime.ready) checkAndDrive();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      detach();
    },
  };
}

// ---------- helpers --------------------------------------------------------

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
