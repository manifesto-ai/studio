/**
 * Agent turn session state.
 *
 * The active LLM turn lifecycle lives in the StudioUi Manifesto
 * runtime (see domain/studio.mel beginAgentTurn / concludeAgentTurn /
 * incrementAgentTurnResend / cancelAgentTurn). AgentLens uses the
 * "live" flavor with a small retry budget. SagaLens uses the
 * "durable" flavor with a larger retry budget and forced tool-only
 * transport.
 *
 * Structural termination: a turn ends exactly when the model calls
 * answerAndTurnEnd({ answer }). That tool is the terminal user-visible
 * reply channel and dispatches concludeAgentTurn in the StudioUi
 * runtime.
 */
import type { StudioAgentContext } from "./agent-context.js";
import { buildAgentSystemPrompt } from "./agent-context.js";

export type AgentTurnMode = "live" | "durable";
export type AgentTurnStatus = "running" | "ended";

/**
 * Compact active-turn snapshot the system prompt and UI read from.
 * Mirrors the fields StudioUiRuntime exposes; kept here as its own
 * type so session helpers do not need to import the React runtime.
 */
export type AgentTurnProjection = {
  readonly id: string | null;
  readonly mode: AgentTurnMode | null;
  readonly status: AgentTurnStatus | null;
  readonly prompt: string | null;
  readonly conclusion: string | null;
  readonly resendCount: number;
};

/**
 * Live AgentLens keeps the retry budget tight. A normal reply should
 * terminate in one invocation; the extra laps are only for providers
 * that emit text without calling the terminal tool.
 */
export const LIVE_TURN_RESEND_HARD_CAP = 3;

/**
 * Durable SagaLens gives long inspect/propose workflows more room
 * before the shell cancels a pathological loop.
 */
export const DURABLE_TURN_RESEND_HARD_CAP = 20;

export function buildLiveAgentSystemPrompt(input: {
  readonly agentContext: StudioAgentContext;
  readonly turn: AgentTurnProjection;
}): string {
  const base = buildAgentSystemPrompt(input.agentContext);
  const turn = input.turn;
  const lines: string[] = [
    "",
    "# Agent turn - structural rules",
    "The Studio runtime has begun a live agent turn. Use inspect / read / dispatch / propose tools when you need current state or mutations.",
    "When you are ready to answer the user, call `answerAndTurnEnd({ answer })` with the full visible reply. That single tool call delivers the answer and ends the Manifesto turn.",
    "Do not treat plain text as the final answer. If you can answer immediately, call answerAndTurnEnd immediately.",
    "If you cannot complete the request, call answerAndTurnEnd with a concise explanation of the blocker.",
  ];
  if (turn.status === "running" && turn.resendCount > 0) {
    lines.push(
      "",
      `# RESUME - live turn ${turn.id ?? "(unknown)"}, resend #${turn.resendCount}`,
      "The prior invocation finished without ending the turn. Call answerAndTurnEnd now with the best answer you have.",
    );
  }
  return [base, ...lines].join("\n");
}

export function buildDurableAgentSystemPrompt(input: {
  readonly agentContext: StudioAgentContext;
  readonly turn: AgentTurnProjection;
}): string {
  const base = buildAgentSystemPrompt(input.agentContext);
  const turn = input.turn;
  const lines: string[] = [
    "",
    "# Durable agent turn - structural rules",
    "You are in a durable agent turn. User-visible replies can only be emitted through the `answerAndTurnEnd({ answer })` tool. Plain text responses are not delivered as the final answer and will not end the turn; toolChoice:required enforces this at the transport layer.",
    "",
    "Workflow:",
    "- Use inspect / read / dispatch / propose tools freely while doing the work.",
    "- When you are ready to speak to the user, call `answerAndTurnEnd({ answer })` with the full reply text. That single call delivers the answer and ends the turn.",
    "- If you can answer the user in one go (Q&A, summary, explanation), do it: call answerAndTurnEnd immediately. You do not need any other tool first.",
    "- If you cannot complete the request, call answerAndTurnEnd with an answer that explains why. The turn ends either way.",
  ];
  if (turn.status === "running" && turn.resendCount > 0) {
    lines.push(
      "",
      `# RESUME - durable turn ${turn.id ?? "(unknown)"}, resend #${turn.resendCount}`,
      "The prior invocation finished without calling answerAndTurnEnd. Call it now with whatever answer you have, even a short acknowledgement of what was attempted. Do not keep working silently.",
    );
  }
  return [base, ...lines].join("\n");
}

type SnapshotReader = {
  readonly getSnapshot: () => unknown | null;
};

export function readLiveAgentTurnStatus(
  core: SnapshotReader | null,
): AgentTurnStatus | null {
  const data = readSnapshotData(core);
  const status = data?.agentTurnStatus;
  return status === "running" || status === "ended" ? status : null;
}

export function readLiveAgentTurnMode(
  core: SnapshotReader | null,
): AgentTurnMode | null {
  const data = readSnapshotData(core);
  const mode = data?.agentTurnMode;
  return mode === "live" || mode === "durable" ? mode : null;
}

export function newAgentTurnId(prefix: AgentTurnMode): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readSnapshotData(
  core: SnapshotReader | null,
): Record<string, unknown> | null {
  if (core === null) return null;
  const snap = core.getSnapshot();
  if (snap === null || typeof snap !== "object") return null;
  const data = (snap as { readonly data?: unknown }).data;
  return data !== null && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
}
