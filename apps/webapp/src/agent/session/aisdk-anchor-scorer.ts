/**
 * AI SDK-backed AnchorScorer.
 *
 * Sends (query, candidate topics) to a small model via a
 * scoring-specific transport. Model returns JSON. We parse and
 * filter; if parsing fails we fall back to substring matching so
 * search never *fails* outright — at worst it degrades.
 *
 * Boundary: lives in agent/session/ (future-core), uses `ai` package.
 */
import type { ChatTransport, UIMessage } from "ai";
import {
  substringMatchScorer,
  type AnchorScoreInput,
  type AnchorScorer,
  type AnchorScore,
} from "./agent-session-anchor-scorer.js";

export type AiSdkAnchorScorerDeps = {
  readonly transport: ChatTransport<UIMessage>;
  readonly idPrefix?: string;
};

export function createAiSdkAnchorScorer(
  deps: AiSdkAnchorScorerDeps,
): AnchorScorer {
  const idPrefix = deps.idPrefix ?? "search";
  const fallback = substringMatchScorer();
  return {
    score: async (input) => {
      if (input.candidates.length === 0) return [];

      const promptText = buildScorerUserPrompt(input.query, input.candidates);
      const requestId = `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const messages: UIMessage[] = [
        {
          id: requestId,
          role: "user",
          parts: [{ type: "text", text: promptText }],
        },
      ];

      let raw: string;
      try {
        const stream = await deps.transport.sendMessages({
          chatId: requestId,
          messages,
          abortSignal: input.signal,
          trigger: "submit-message",
          messageId: undefined,
        });
        raw = await accumulateText(stream);
      } catch {
        return fallback.score(input);
      }

      const parsed = parseScorerResponse(raw, input.candidates);
      if (parsed === null) {
        return fallback.score(input);
      }
      return parsed;
    },
  };
}

async function accumulateText(
  stream: ReadableStream<{ readonly type: string; readonly delta?: string; readonly errorText?: string; readonly reason?: string }>,
): Promise<string> {
  const reader = stream.getReader();
  let acc = "";
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
        acc += chunk.delta;
      } else if (chunk.type === "error") {
        throw new Error(chunk.errorText ?? "scorer stream error");
      } else if (chunk.type === "abort") {
        throw new Error(chunk.reason ?? "scorer aborted");
      }
    }
  } finally {
    reader.releaseLock();
  }
  return acc.trim();
}

/**
 * Find the first JSON array in the response and parse it. Models
 * sometimes prepend prose despite the system prompt; we extract
 * the first `[ ... ]` block.
 */
export function parseScorerResponse(
  raw: string,
  candidates: readonly { readonly id: string }[],
): readonly AnchorScore[] | null {
  const text = raw.trim();
  if (text === "") return null;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const validIds = new Set(candidates.map((c) => c.id));
  const out: AnchorScore[] = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : null;
    const score = typeof e.score === "number" ? e.score : null;
    if (id === null || score === null) continue;
    if (!validIds.has(id)) continue;
    if (!Number.isFinite(score)) continue;
    const clamped = Math.max(0, Math.min(1, score));
    out.push({ id, score: clamped });
  }
  return out;
}

export function buildScorerUserPrompt(
  query: string,
  candidates: readonly { readonly id: string; readonly topic: string }[],
): string {
  const lines: string[] = [];
  lines.push(`Query: ${query}`);
  lines.push("");
  lines.push("Anchors to score:");
  for (const c of candidates) {
    lines.push(`- id="${c.id}", topic=${JSON.stringify(c.topic)}`);
  }
  return lines.join("\n");
}

export const ANCHOR_SCORING_SYSTEM_PROMPT = `
You score memory anchors by their relevance to a search query.

Each input anchor has an id and a topic line. Score how likely the
anchor is to contain information the query is asking about.

Output ONLY a JSON array of objects:
[{"id": "<anchorId>", "score": <0..1>}, ...]

Rules:
- Score range is 0.0 to 1.0. Higher = more relevant.
- Only include anchors with score >= 0.1.
- Sort the array by descending score.
- No preamble, no markdown fences, no trailing prose. ONLY the JSON.
- If no anchor is relevant, return an empty array: []
`.trim();
