/**
 * AgentSessionAnchorEffect — sliding-window summarization for the
 * agent's long-term memory.
 *
 * Subscribes to AgentSession dispatch results. When phase=settled
 * fires and `turnCount` has crossed the configured threshold since
 * the last anchor, the effect:
 *   1. Slices the ConversationProjection turns since the last anchor.
 *   2. Calls `summarizer.summarize(...)` (typically a small-model
 *      effect) with those turns and any prior anchor as context.
 *   3. Dispatches `anchorWindow(fromWorldId, toWorldId, summary)`
 *      via the dispatcher.
 *
 * The dispatched anchor lands in MEL state (`lastAnchorSummary`),
 * which the system prompt builder then injects into subsequent
 * agent prompts — closing the loop on "long-term memory through
 * lineage anchors" from the agent architecture memo.
 *
 * Failures are swallowed to a console.warn and try again on the
 * next eligible settle. Anchoring is best-effort; missing one
 * cycle is not catastrophic.
 *
 * Boundary discipline: lives in agent/session/ (future-core). No
 * React or webapp aliases. Summarizer + dispatcher are injected.
 */
import type {
  AgentSessionEffectRuntime,
} from "./agent-session-effects.js";
import type {
  ConversationProjection,
  TurnEntry,
} from "./agent-session-types.js";

export type AnchorSummarizeArgs = {
  /** Turns to incorporate into this anchor, oldest first. */
  readonly turns: readonly TurnEntry[];
  /** Prior anchor summary (older context), or null for the first anchor. */
  readonly priorAnchor: string | null;
  readonly signal?: AbortSignal;
};

export type AnchorSummarizer = {
  readonly summarize: (args: AnchorSummarizeArgs) => Promise<string>;
};

export type AnchorDispatcher = {
  readonly anchorWindow: (
    fromWorldId: string,
    toWorldId: string,
    summary: string,
  ) => Promise<boolean>;
  /**
   * Charge inference cost (millicents) for the summarization call.
   * Optional — when omitted the anchor effect skips cost tracking.
   */
  readonly recordBudget?: (deltaMc: number) => Promise<boolean>;
};

export type AnchorPolicy = {
  /**
   * Trigger anchoring after every N settled turns. 0 disables
   * anchoring entirely.
   */
  readonly turnsBetweenAnchors: number;
  /**
   * Cost in millicents charged per anchor summarization. Default 0
   * (no charge). Tune to reflect the small model's per-call cost.
   */
  readonly costMc?: number;
};

export type AnchorHandlers = {
  readonly onAnchorStart?: (args: { readonly turnCount: number }) => void;
  readonly onAnchorSettled?: (args: {
    readonly fromWorldId: string;
    readonly toWorldId: string;
    readonly summary: string;
  }) => void;
  readonly onAnchorFailed?: (err: unknown) => void;
};

export type CreateAnchorEffectArgs = {
  readonly runtime: AgentSessionEffectRuntime;
  /** Reads the current ConversationProjection (typically shadow.getConversation). */
  readonly conversation: () => ConversationProjection;
  /** Returns the current head world id from lineage, or null if not available. */
  readonly getLatestWorldId: () => string | null;
  readonly dispatcher: AnchorDispatcher;
  readonly summarizer: AnchorSummarizer;
  readonly policy: AnchorPolicy;
  readonly handlers?: AnchorHandlers;
};

export type AgentSessionAnchorEffect = {
  readonly stop: () => void;
};

export function createAgentSessionAnchorEffect(
  args: CreateAnchorEffectArgs,
): AgentSessionAnchorEffect {
  const { runtime, conversation, getLatestWorldId, dispatcher, summarizer, policy, handlers = {} } = args;

  let inFlight = false;
  let stopped = false;
  // Tracks the turnCount as of the last successful anchor. Initial 0
  // means "never anchored" so the first eligible window covers turns
  // [1..turnsBetweenAnchors].
  let lastAnchoredTurnCount = 0;

  const detach = runtime.subscribeAfterDispatch((result) => {
    if (stopped || inFlight) return;
    if (result.kind !== "completed") return;
    const snap = runtime.snapshot;
    if (snap.phase !== "settled") return;
    if (policy.turnsBetweenAnchors <= 0) return;
    const delta = snap.turnCount - lastAnchoredTurnCount;
    if (delta < policy.turnsBetweenAnchors) return;
    void runAnchor(snap.turnCount);
  });

  async function runAnchor(currentTurnCount: number): Promise<void> {
    inFlight = true;
    try {
      const conv = conversation();
      const startIdx = lastAnchoredTurnCount;
      const turnsToAnchor = conv.turns.slice(startIdx, currentTurnCount);
      if (turnsToAnchor.length === 0) return;

      const snap = runtime.snapshot;
      const fromWorldId = snap.lastAnchorToWorldId ?? "session-start";
      const toWorldId = getLatestWorldId() ?? `turn-${currentTurnCount}`;

      handlers.onAnchorStart?.({ turnCount: currentTurnCount });

      const summary = await summarizer.summarize({
        turns: turnsToAnchor,
        priorAnchor: snap.lastAnchorSummary,
      });

      if (stopped || summary.trim() === "") return;

      const ok = await dispatcher.anchorWindow(
        fromWorldId,
        toWorldId,
        summary,
      );
      if (!ok) {
        handlers.onAnchorFailed?.(
          new Error("anchorWindow dispatch was not completed"),
        );
        return;
      }
      // Charge the small-model cost. Best-effort: a budget rejection
      // here just means the next eligible turn won't anchor.
      if (
        policy.costMc !== undefined &&
        policy.costMc > 0 &&
        dispatcher.recordBudget !== undefined
      ) {
        void dispatcher.recordBudget(policy.costMc);
      }
      lastAnchoredTurnCount = currentTurnCount;
      handlers.onAnchorSettled?.({ fromWorldId, toWorldId, summary });
    } catch (err) {
      handlers.onAnchorFailed?.(err);
    } finally {
      inFlight = false;
    }
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      detach();
    },
  };
}

/**
 * Default summarization user-prompt builder. Public so tests can
 * snapshot it and AgentLens can compose its own variant if needed.
 */
export function buildAnchorSummaryPrompt(
  turns: readonly TurnEntry[],
  priorAnchor: string | null,
): string {
  const lines: string[] = [];
  if (priorAnchor !== null && priorAnchor.trim() !== "") {
    lines.push("## Earlier session context (from prior anchor)");
    lines.push(priorAnchor.trim());
    lines.push("");
  }
  lines.push("## New turns to incorporate (oldest first)");
  lines.push("");
  for (const turn of turns) {
    lines.push(`### Turn`);
    lines.push(`User: ${oneLine(turn.userText)}`);
    if (turn.settledText !== null && turn.settledText !== "") {
      lines.push(`Assistant: ${truncate(oneLine(turn.settledText), 600)}`);
    } else if (turn.errorReason !== null) {
      lines.push(`Assistant (errored): ${turn.errorReason}`);
    } else if (turn.stopped) {
      lines.push(`Assistant (stopped by user)`);
    }
    const toolNames = turn.steps
      .filter(
        (s): s is Extract<typeof s, { kind: "tool-call" }> =>
          s.kind === "tool-call",
      )
      .map((s) => s.toolName);
    if (toolNames.length > 0) {
      lines.push(`Tools: ${toolNames.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}
