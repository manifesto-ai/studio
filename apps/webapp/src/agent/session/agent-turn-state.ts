/**
 * Agent turn session state.
 *
 * The active LLM turn lifecycle lives in the StudioUi Manifesto
 * runtime (see domain/studio.mel beginAgentTurn / concludeAgentTurn /
 * incrementAgentTurnResend / cancelAgentTurn).
 *
 * Structural termination: a turn ends exactly when the model calls
 * `endTurn({ summary? })`. The visible reply itself is the assistant
 * text the model emits — text streams natively in every provider,
 * which avoids the tool-arg-streaming gap (Ollama/gemma sends tool
 * calls atomically). `endTurn` is just the structural signal that
 * dispatches concludeAgentTurn in the StudioUi runtime.
 */
import type { StudioAgentContext } from "./agent-context.js";
import { buildAgentSystemPrompt } from "./agent-context.js";

export type AgentTurnMode = "live";
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

export function buildLiveAgentSystemPrompt(input: {
  readonly agentContext: StudioAgentContext;
  readonly turn: AgentTurnProjection;
}): string {
  const base = buildAgentSystemPrompt(input.agentContext);
  const turn = input.turn;
  const lines: string[] = [
    "",
    "# Agent turn - structural rules",
    "The Studio runtime has begun a live agent turn. Use inspect / dispatch tools when you need current state or mutations.",
    "Reply pattern: type your visible answer as plain assistant text (it streams character-by-character to the user), THEN call `endTurn({ summary? })` as your last tool call to mark the turn complete.",
    "Without endTurn the runtime may recover by ending plain-text answers or stopping repeated non-terminal loops, but the intended terminal path is still endTurn.",
    "",
    "# Asking the user a question",
    "**The user CANNOT respond mid-turn. They can only reply by starting a new turn.** This means: if you need clarification, missing info, or a yes/no decision from the user, treat that as the END of this turn. Type your question concisely as assistant text, then call endTurn() immediately. Do NOT keep reasoning, do NOT keep retrying, and do NOT keep apologizing. The user will read your question and reply with the next turn.",
    "",
    "If you cannot complete the request, type a brief explanation of the blocker, then call endTurn().",
  ];
  if (turn.status === "running" && turn.resendCount > 0) {
    lines.push(
      "",
      `# RESUME - live turn ${turn.id ?? "(unknown)"}, resend #${turn.resendCount}`,
      "The prior invocation finished without ending the turn. Type whatever finishing remark or question you have and call endTurn() now. Do not keep retrying silently.",
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
  return mode === "live" ? mode : null;
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
