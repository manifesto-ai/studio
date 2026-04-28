/**
 * Shared type contracts for the AgentSession Manifesto domain.
 *
 * Lives in `agent/session/` (future-core territory) so the shadow
 * recorder and any future headless agent runner can reference the
 * shapes without importing webapp-local modules. The webapp's
 * `domain/AgentSessionRuntime.tsx` re-uses these types when reading
 * the snapshot back into React.
 */

export type SessionPhase =
  | "idle"
  | "awaitingModel"
  | "streaming"
  | "awaitingTool"
  | "settled"
  | "stopped";

export type ModelTier = "tiny" | "small" | "mid" | "large";

export type ToolOutcome = "ok" | "blocked" | "error";

/**
 * Host-side render projection. Mirrors what MEL lineage represents
 * but keeps tool input / output bodies that MEL stores only as
 * stringified state at one snapshot at a time.
 *
 * Why a separate projection? `core.getLineage()` exposes worlds
 * with origin + changedPaths but not the snapshot AT a specific
 * world, so reconstructing tool args from lineage alone isn't
 * possible without scrub APIs. The shadow already has the bodies
 * in scope at record time — capturing them into a projection here
 * gives the renderer everything it needs without a side cache.
 *
 * The projection is bounded (one entry per turn / per step within
 * a turn), copy-on-written, and recoverable on lineage replay if
 * the shadow re-walks the same dispatch sequence.
 */
export type ConversationProjection = {
  readonly turns: readonly TurnEntry[];
};

export type TurnEntry = {
  readonly turnId: string;
  readonly userText: string;
  readonly steps: readonly TurnStep[];
  /** Final assistant text after recordAssistantSettled, or null while in-flight. */
  readonly settledText: string | null;
  /** Whether recordSessionStop fired during this turn. */
  readonly stopped: boolean;
};

export type TurnStep =
  | {
      readonly kind: "model-invocation";
      readonly invocationId: string;
      readonly tier: ModelTier;
    }
  | {
      readonly kind: "tool-call";
      readonly callId: string;
      readonly toolName: string;
      readonly input: unknown;
      /** Result body once recordToolResult fires; null while pending. */
      readonly output: unknown | null;
      /** Outcome once recordToolResult fires; null while pending. */
      readonly outcome: ToolOutcome | null;
    };

export const EMPTY_CONVERSATION: ConversationProjection = { turns: [] };

/**
 * React-facing read model derived from the AgentSession snapshot.
 * Field names mirror agent-session.mel's state and computed
 * sections so mistakes between the two surfaces are loud.
 */
export type AgentSessionSnapshot = {
  // Identity
  readonly sessionId: string;
  readonly phase: SessionPhase;
  readonly currentTurnId: string | null;
  // User
  readonly lastUserText: string | null;
  // Model side (in flight)
  readonly pendingModelInvocationId: string | null;
  readonly pendingModelTier: ModelTier | null;
  // Tool side (in flight)
  readonly pendingToolCallId: string | null;
  readonly pendingToolName: string | null;
  readonly pendingToolInputJson: string | null;
  // Tool side (most recent settled)
  readonly lastToolCallId: string | null;
  readonly lastToolName: string | null;
  readonly lastToolOutcome: ToolOutcome | null;
  readonly lastToolOutputJson: string | null;
  // Settled response
  readonly lastResponseFinal: string | null;
  // Budget
  readonly budgetUsedMc: number;
  readonly budgetCeilingMc: number;
  readonly stopRequested: boolean;
  // Anchor
  readonly lastAnchorFromWorldId: string | null;
  readonly lastAnchorToWorldId: string | null;
  readonly lastAnchorSummary: string | null;
  // Counters
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly modelInvocationCount: number;
  // Computed
  readonly idle: boolean;
  readonly awaitingUser: boolean;
  readonly canStartTurn: boolean;
  readonly isProcessing: boolean;
  readonly budgetExhausted: boolean;
  readonly canInvokeModel: boolean;
};
