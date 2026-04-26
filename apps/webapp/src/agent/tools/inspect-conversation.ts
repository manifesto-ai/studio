/**
 * `inspectConversation` - read-only tool over the chat transcript.
 *
 * The system prompt carries a short recent-turn tail for continuity.
 * This tool is the opt-in escape hatch when the agent needs older
 * conversation context. It returns compact user/assistant turn pairs
 * by default rather than dumping raw UIMessage JSON.
 */
import type { AgentMessageLike, AgentMessagePartLike } from "../session/recent-turns.js";
import type { AgentTool } from "./types.js";

export type InspectConversationContext = {
  readonly getMessages: () => readonly AgentMessageLike[];
};

export type ConversationTurn = {
  readonly turnId: string;
  readonly userPrompt: string;
  readonly assistantExcerpt: string;
  readonly toolCount: number;
  readonly toolNames?: readonly string[];
};

export type InspectConversationInput = {
  readonly limit?: number;
  readonly beforeTurnId?: string;
  readonly containsTool?: boolean;
  readonly includeToolNames?: boolean;
  readonly excerptCap?: number;
};

export type InspectConversationOutput = {
  readonly turns: readonly ConversationTurn[];
  readonly totalMatched: number;
  readonly totalTurns: number;
  readonly nextBeforeTurnId: string | null;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DEFAULT_EXCERPT_CAP = 280;
const MAX_EXCERPT_CAP = 1000;

export function createInspectConversationTool(): AgentTool<
  InspectConversationInput,
  InspectConversationOutput,
  InspectConversationContext
> {
  return {
    name: "inspectConversation",
    description:
      "Read compact prior conversation turns, newest first. Use this " +
      "when the user asks what was said earlier, refers to an earlier " +
      "chat turn, or needs recovery from prior tool behavior. Default " +
      "limit 5, max 20. Use beforeTurnId to page older. Set " +
      "includeToolNames only when tool provenance matters.",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many settled turns to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
        },
        beforeTurnId: {
          type: "string",
          description:
            "Return turns older than this turn id (pagination cursor).",
        },
        containsTool: {
          type: "boolean",
          description:
            "When true, return only turns that used tools. When false, return only turns with no tools.",
        },
        includeToolNames: {
          type: "boolean",
          description:
            "Include compact tool names per assistant turn. Default false.",
        },
        excerptCap: {
          type: "integer",
          minimum: 0,
          maximum: MAX_EXCERPT_CAP,
          description: `Maximum assistant excerpt chars per turn. Default ${DEFAULT_EXCERPT_CAP}, max ${MAX_EXCERPT_CAP}.`,
        },
      },
    },
    run: async (input, ctx) => {
      const limit = clampInt(input?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
      const excerptCap = clampInt(
        input?.excerptCap,
        DEFAULT_EXCERPT_CAP,
        0,
        MAX_EXCERPT_CAP,
      );
      const includeToolNames = input?.includeToolNames === true;
      try {
        const allTurns = buildConversationTurns(
          ctx.getMessages(),
          excerptCap,
          includeToolNames,
        );
        const matched =
          input?.containsTool === undefined
            ? allTurns
            : allTurns.filter((turn) =>
                input.containsTool === true
                  ? turn.toolCount > 0
                  : turn.toolCount === 0,
              );

        let cursor = 0;
        if (input?.beforeTurnId !== undefined) {
          const idx = matched.findIndex((turn) => turn.turnId === input.beforeTurnId);
          if (idx === -1) {
            return {
              ok: false,
              kind: "invalid_input",
              message: `unknown turnId: ${input.beforeTurnId}`,
            };
          }
          cursor = idx + 1;
        }

        const slice = matched.slice(cursor, cursor + limit);
        const nextBeforeTurnId =
          cursor + limit < matched.length
            ? matched[cursor + limit - 1]?.turnId ?? null
            : null;

        return {
          ok: true,
          output: {
            turns: slice,
            totalMatched: matched.length,
            totalTurns: allTurns.length,
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

function buildConversationTurns(
  messages: readonly AgentMessageLike[],
  excerptCap: number,
  includeToolNames: boolean,
): readonly ConversationTurn[] {
  const chronological: ConversationTurn[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const next = messages[i + 1];
    if (next === undefined || next.role !== "assistant") continue;
    const toolNames = next.parts.filter(isToolPart).map(readToolName);
    const turn: ConversationTurn = {
      turnId: message.id,
      userPrompt: extractText(message),
      assistantExcerpt: capExcerpt(extractText(next), excerptCap),
      toolCount: toolNames.length,
      ...(includeToolNames ? { toolNames } : {}),
    };
    chronological.push(turn);
  }
  return chronological.reverse();
}

function extractText(message: AgentMessageLike): string {
  return message.parts
    .map((part) =>
      part.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("")
    .trim();
}

function isToolPart(part: AgentMessagePartLike): boolean {
  return part.type.startsWith("tool-");
}

function readToolName(part: AgentMessagePartLike): string {
  return part.type.startsWith("tool-")
    ? part.type.slice("tool-".length)
    : part.type;
}

function capExcerpt(value: string, cap: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= cap) return collapsed;
  if (cap <= 0) return "";
  if (cap <= 3) return ".".repeat(cap);
  return collapsed.slice(0, cap - 3) + "...";
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, Math.min(max, n));
}
