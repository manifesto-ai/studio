/**
 * AnchorScorer — interface for scoring anchors by relevance to a
 * search query.
 *
 * The agent's `searchAnchors` tool delegates ranking to an
 * implementation of this interface so we can swap scoring backends
 * (LLM-as-judge, embedding similarity, hybrid) without touching the
 * tool surface.
 *
 * v0 implementation: AI SDK transport hitting a small model with a
 * scoring system prompt that returns JSON. Falls back to substring
 * matching on parse failure (see `aisdk-anchor-scorer.ts`).
 */

export type AnchorCandidate = {
  readonly id: string;
  readonly topic: string;
};

export type AnchorScoreInput = {
  readonly query: string;
  readonly candidates: readonly AnchorCandidate[];
  readonly signal?: AbortSignal;
};

export type AnchorScore = {
  readonly id: string;
  /** Relevance 0..1. Higher is more relevant. Caller sorts. */
  readonly score: number;
};

export type AnchorScorer = {
  readonly score: (
    input: AnchorScoreInput,
  ) => Promise<readonly AnchorScore[]>;
};

/**
 * Substring-match fallback: every word in the query that appears in
 * the topic contributes 0.25 (capped at 1.0). Topics with no matches
 * get score 0 and are excluded. Used by the AI SDK scorer when
 * model output can't be parsed.
 */
export function substringMatchScorer(): AnchorScorer {
  return {
    score: async ({ query, candidates }) => {
      const tokens = tokenize(query);
      if (tokens.length === 0) {
        // No query terms → nothing to match. Return all with equal
        // small score so the caller still has an ordered list.
        return candidates.map((c) => ({ id: c.id, score: 0.05 }));
      }
      const out: AnchorScore[] = [];
      for (const c of candidates) {
        const topicLc = c.topic.toLowerCase();
        let hits = 0;
        for (const t of tokens) {
          if (topicLc.includes(t)) hits += 1;
        }
        if (hits === 0) continue;
        out.push({ id: c.id, score: Math.min(hits * 0.25, 1) });
      }
      return out;
    },
  };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/u)
    .filter((t) => t.length >= 2);
}
