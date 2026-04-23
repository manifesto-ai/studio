/**
 * `inspectConversation` — read the agent's own chat transcript.
 *
 * Distinct from `inspectLineage`:
 *   - lineage is every runtime dispatch (UI + user domain together);
 *   - conversation is just agent turns (user prompt + assistant reply
 *     + tool trace for that turn).
 *
 * The transcript lives in React state (the TranscriptStore). The
 * studio.mel runtime only keeps the single latest turn — full history
 * is ephemeral by design, but the agent still benefits from looking
 * back at what it already answered (to avoid repeating itself, to
 * refer to a prior explanation, to build a multi-turn plan).
 *
 * ## Projection is load-bearing
 *
 * Same rule as `inspectLineage`: default to the compact shape, opt
 * into heavy fields. A turn can carry a long assistant message,
 * reasoning tokens, and multi-step tool results; sending all of that
 * back every time the agent asks "what did I say earlier?" would
 * blow the context budget fast.
 *
 * Default response per turn: `{turnId, userPrompt, toolCount,
 * hasAssistantText, endedAt?}`. Opt in to `assistantText` /
 * `reasoning` / `toolCalls` only when the question needs it.
 */
import type { AgentTool } from "./types.js";

export type ConversationToolCall = {
  readonly name: string;
  readonly argumentsJson: string;
  readonly ok: boolean;
};

/** Per-turn shape the context hands the tool. The tool further
 *  projects + paginates based on `fields` / `limit`. */
export type FullConversationTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantText: string;
  readonly reasoning: string;
  readonly toolCalls: readonly ConversationToolCall[];
  readonly endedAt: string | null;
  readonly stoppedAtCap: boolean;
};

export type InspectConversationContext = {
  /** Returns turns newest-first. */
  readonly getTurns: () => readonly FullConversationTurn[];
};

export type ConversationField =
  | "assistantText"
  | "reasoning"
  | "toolCalls";

export type ConversationTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly toolCount: number;
  readonly hasAssistantText: boolean;
  readonly endedAt?: string | null;
  readonly stoppedAtCap?: boolean;
  /** Opt-in. Long — request only when you need the prose. */
  readonly assistantText?: string;
  /** Opt-in. Usually long. */
  readonly reasoning?: string;
  /** Opt-in. Tool-call trace for this turn, one row per call. */
  readonly toolCalls?: readonly ConversationToolCall[];
};

export type InspectConversationInput = {
  readonly limit?: number;
  readonly beforeTurnId?: string;
  readonly fields?: readonly ConversationField[];
};

export type InspectConversationOutput = {
  readonly turns: readonly ConversationTurn[];
  readonly totalTurns: number;
  readonly nextBeforeTurnId: string | null;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 30;
const ASSISTANT_TEXT_CAP = 2000;
const REASONING_TEXT_CAP = 1500;

export function createInspectConversationTool(): AgentTool<
  InspectConversationInput,
  InspectConversationOutput,
  InspectConversationContext
> {
  return {
    name: "inspectConversation",
    description:
      "Walk the agent's own chat transcript (user prompts + your " +
      "prior answers + tool traces). DEFAULT response is compact — " +
      "just {turnId, userPrompt, toolCount, hasAssistantText}. Use " +
      "`fields` to opt into assistantText / reasoning / toolCalls " +
      "when the question actually needs them (those fields can be " +
      "long; never request speculatively). Use this to avoid " +
      "repeating past explanations, refer back to earlier answers, " +
      "or build on what you already told the user.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Entries to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
        beforeTurnId: {
          type: "string",
          description:
            "Return turns older than this turnId (pagination).",
        },
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: ["assistantText", "reasoning", "toolCalls"],
          },
          description:
            "Optional heavy fields. assistantText caps at " +
            `${ASSISTANT_TEXT_CAP} chars, reasoning at ${REASONING_TEXT_CAP}; ` +
            "oversize content is truncated with a … suffix.",
        },
      },
    },
    run: async (input, ctx) => {
      const limit = Math.max(
        1,
        Math.min(MAX_LIMIT, input?.limit ?? DEFAULT_LIMIT),
      );
      const wantFields = new Set<ConversationField>(input?.fields ?? []);
      try {
        const all = ctx.getTurns();
        let cursor = 0;
        if (input?.beforeTurnId !== undefined) {
          const idx = all.findIndex(
            (t) => t.turnId === input.beforeTurnId,
          );
          if (idx === -1) {
            return {
              ok: false,
              kind: "invalid_input",
              message: `unknown turnId: ${input.beforeTurnId}`,
            };
          }
          cursor = idx + 1;
        }
        const slice = all.slice(cursor, cursor + limit);
        const projected = slice.map((t) => projectTurn(t, wantFields));
        const nextBeforeTurnId =
          cursor + limit < all.length
            ? all[cursor + limit - 1]?.turnId ?? null
            : null;
        return {
          ok: true,
          output: {
            turns: projected,
            totalTurns: all.length,
            nextBeforeTurnId,
          },
        };
      } catch (err) {
        return {
          ok: false,
          kind: "runtime_error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function projectTurn(
  t: FullConversationTurn,
  want: ReadonlySet<ConversationField>,
): ConversationTurn {
  const out: {
    turnId: string;
    userPrompt: string;
    toolCount: number;
    hasAssistantText: boolean;
    endedAt?: string | null;
    stoppedAtCap?: boolean;
    assistantText?: string;
    reasoning?: string;
    toolCalls?: readonly ConversationToolCall[];
  } = {
    turnId: t.turnId,
    userPrompt: t.userPrompt,
    toolCount: t.toolCalls.length,
    hasAssistantText: t.assistantText.length > 0,
  };
  // endedAt + stoppedAtCap are cheap scalars; include whenever the
  // turn has actually settled so the agent can tell in-flight apart
  // from capped-out.
  if (t.endedAt !== null) {
    out.endedAt = t.endedAt;
  }
  if (t.stoppedAtCap) {
    out.stoppedAtCap = true;
  }
  if (want.has("assistantText")) {
    out.assistantText = capText(t.assistantText, ASSISTANT_TEXT_CAP);
  }
  if (want.has("reasoning")) {
    out.reasoning = capText(t.reasoning, REASONING_TEXT_CAP);
  }
  if (want.has("toolCalls")) {
    out.toolCalls = t.toolCalls;
  }
  return out;
}

function capText(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1) + "…";
}
