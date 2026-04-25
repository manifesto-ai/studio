/**
 * Saga session — durable-turn flavor of the agent loop.
 *
 * A saga is an interruption-resilient agent turn. Its status lives
 * in the StudioUi Manifesto runtime (see `domain/studio.mel`
 * beginAgentSaga / concludeAgentSaga / incrementSagaResend), which
 * means:
 *   - Browser refresh mid-turn → status survives, can be resumed.
 *   - LLM stream drop mid-response → status still "running", harness
 *     re-invokes.
 *   - Model announces-but-doesn't-call → status still "running",
 *     harness re-invokes.
 *
 * Structural termination: the turn ends EXACTLY when the model calls
 * `answerAndTurnEnd({ answer })`. That tool is the ONLY channel for
 * user-visible replies — SagaLens runs with `toolChoice: "required"`,
 * so naked text can't escape. "Speaking to the user" and "ending the
 * turn" are the same physical event; no amount of model rambling can
 * separate them. The prompt below names the rule once; the actual
 * enforcement is structural, not linguistic.
 */
import type { StudioAgentContext } from "./agent-context.js";
import { buildAgentSystemPrompt } from "./agent-context.js";

/**
 * Compact saga snapshot the system prompt + UI read from. Mirrors
 * the fields StudioUiRuntime exposes; kept here as its own type so
 * the saga module can be reasoned about without the runtime type.
 */
export type SagaProjection = {
  readonly id: string | null;
  readonly status: "running" | "ended" | null;
  readonly prompt: string | null;
  readonly conclusion: string | null;
  readonly resendCount: number;
};

/**
 * Hard cap on how many times the harness will re-invoke the LLM
 * within one saga before force-concluding. Prevents runaway token
 * spend when a pathological loop occurs (e.g. the model keeps
 * calling inspect tools without ever calling answerAndTurnEnd).
 *
 * Normal Q&A is ZERO resends — the model answers and ends in a
 * single invocation. Multi-step workflows (inspect → read →
 * propose → answer) also fit in one invocation via AI SDK multi-
 * step. The cap is purely a safety valve for pathological loops;
 * 20 gives substantial headroom for long investigations before
 * force-ending.
 */
export const SAGA_RESEND_HARD_CAP = 20;

/**
 * Extend the shared system prompt with the saga's structural note.
 * Short on purpose — the actual rule is enforced by toolChoice +
 * answerAndTurnEnd, not by prose. The block below exists so the
 * model knows WHY its only callable reply channel is a tool, not
 * because we're pleading with it to follow a convention.
 */
export function buildSagaSystemPrompt(input: {
  readonly agentContext: StudioAgentContext;
  readonly saga: SagaProjection;
}): string {
  const base = buildAgentSystemPrompt(input.agentContext);
  const saga = input.saga;
  const sagaLines: string[] = [
    "",
    "# Saga turn — structural rules",
    "You are in a saga. User-visible replies can only be emitted through the `answerAndTurnEnd({ answer })` tool. Plain text responses are not delivered to the user and will not end the turn; toolChoice:required enforces this at the transport layer.",
    "",
    "Workflow:",
    "- Use inspect / read / dispatch / propose tools freely while doing the work.",
    "- When you are ready to speak to the user, call `answerAndTurnEnd({ answer })` with the full reply text. That single call delivers the answer and ends the saga.",
    "- If you can answer the user in one go (Q&A, summary, explanation), do it: call answerAndTurnEnd immediately — you do not need any other tool first.",
    "- If you cannot complete the request, call answerAndTurnEnd with an answer that explains why. The saga ends either way.",
  ];
  if (saga.status === "running" && saga.resendCount > 0) {
    sagaLines.push(
      "",
      `# RESUME — saga ${saga.id ?? "(unknown)"}, resend #${saga.resendCount}`,
      "The prior invocation finished without calling answerAndTurnEnd. Call it now with whatever answer you have — even a short acknowledgement of what was attempted. Do not keep working silently.",
    );
  }
  return [base, ...sagaLines].join("\n");
}
