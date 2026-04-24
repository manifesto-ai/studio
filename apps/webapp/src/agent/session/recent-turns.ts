import type { RecentTurn } from "./agent-context.js";

export type AgentMessagePartLike = {
  readonly type: string;
  readonly text?: string;
};

export type AgentMessageLike = {
  readonly id: string;
  readonly role: string;
  readonly parts: readonly AgentMessagePartLike[];
};

export type BuildRecentTurnsOptions = {
  readonly limit?: number;
  readonly excerptCap?: number;
};

const DEFAULT_RECENT_TURN_LIMIT = 5;
const DEFAULT_RECENT_TURN_EXCERPT_CAP = 280;

/**
 * Pair chronological user -> next assistant messages, keep the latest
 * N settled turns, and return them newest-first for prompt injection.
 */
export function buildRecentTurnsFromMessages(
  messages: readonly AgentMessageLike[],
  options: BuildRecentTurnsOptions = {},
): readonly RecentTurn[] {
  const limit = options.limit ?? DEFAULT_RECENT_TURN_LIMIT;
  const excerptCap = options.excerptCap ?? DEFAULT_RECENT_TURN_EXCERPT_CAP;
  if (limit <= 0) return [];

  const chronological: RecentTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const userText = extractText(m);
    const next = messages[i + 1];
    if (next === undefined || next.role !== "assistant") continue;
    const answer = extractText(next);
    const toolCount = next.parts.filter(isToolPart).length;
    chronological.push({
      turnId: m.id,
      userPrompt: userText,
      assistantExcerpt: capExcerpt(answer, excerptCap),
      toolCount,
    });
  }

  return chronological.slice(-limit).reverse();
}

function extractText(m: AgentMessageLike): string {
  return m.parts
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

function isToolPart(p: AgentMessagePartLike): boolean {
  return p.type.startsWith("tool-");
}

function capExcerpt(s: string, cap: number): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= cap) return collapsed;
  if (cap <= 0) return "";
  if (cap <= 3) return ".".repeat(cap);
  return collapsed.slice(0, cap - 3) + "...";
}
