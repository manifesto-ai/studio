import type { AgentTool, ToolRunResult } from "./types.js";

/**
 * `endTurn` — terminal tool for live agent turns.
 *
 * Design (post-streaming-pivot):
 *   The agent's user-visible reply is now emitted as **assistant text**,
 *   which streams natively in every provider (text-delta protocol). Tool
 *   args don't stream reliably across providers (Ollama/gemma, in
 *   particular, sends tool calls atomically), so packing the answer
 *   into a tool arg defeats streaming UX.
 *
 *   `endTurn` is therefore a tiny signal: it carries an optional summary
 *   for logs/lineage and dispatches `concludeAgentTurn` in the StudioUi
 *   Manifesto runtime. The structural gate is preserved by
 *   the harness's `sendAutomaticallyWhen` check — bare text alone never
 *   ends the turn, the model must commit to `endTurn` for the loop to
 *   halt.
 */
export type EndTurnContext = {
  readonly isTurnRunning: () => boolean;
  /**
   * Awaitable — the tool awaits this so the runtime's snapshot is
   * definitively "ended" by the time the tool returns. Without the
   * await, the harness's post-tool `sendAutomaticallyWhen` check
   * races against the pending dispatch and sees a stale "running".
   */
  readonly concludeAgentTurn: (summary: string) => Promise<void>;
};

export type EndTurnInput = {
  readonly summary?: string;
};

export type EndTurnOutput = {
  readonly turnEnded: true;
  readonly summary: string;
};

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description:
        "Optional one-sentence note about what was accomplished or why the turn is ending. Stored in lineage for later inspection. The user-visible reply itself should be in your assistant text BEFORE this call — text streams naturally, this tool just signals turn completion.",
    },
  },
};

export function createEndTurnTool(): AgentTool<
  EndTurnInput,
  EndTurnOutput,
  EndTurnContext
> {
  return {
    name: "endTurn",
    description:
      "End the current agent turn. Call this AFTER you have emitted your visible answer as plain assistant text. The text streams to the user character-by-character; this tool then signals 'turn complete' and returns control. Without this call the harness will keep re-invoking you. Pass an optional `summary` (kept in lineage). If the user asked a question, type the answer first, then call endTurn().",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runEndTurn(input, ctx),
  };
}

export async function runEndTurn(
  input: EndTurnInput,
  ctx: EndTurnContext,
): Promise<ToolRunResult<EndTurnOutput>> {
  if (!ctx.isTurnRunning()) {
    return {
      ok: false,
      kind: "runtime_error",
      message:
        "No agent turn is running. endTurn is only valid while a turn is in flight.",
    };
  }
  const raw = typeof input?.summary === "string" ? input.summary.trim() : "";
  const summary = raw === "" ? "(turn ended by agent)" : raw;
  await ctx.concludeAgentTurn(summary);
  return {
    ok: true,
    output: { turnEnded: true, summary },
  };
}
