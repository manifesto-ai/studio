/**
 * `searchAnchors` — agent-driven progressive memory search.
 *
 * The agent issues a natural-language query. The tool ranks all
 * known anchors by:
 *   1. LLM-as-judge relevance to the query (via injected AnchorScorer)
 *   2. ACO pheromone bonus from edges to recently-recalled anchors
 *      (so trails that worked before get reinforced)
 *
 * Results are paginated through `excludeIds` — the iterator pattern
 * the agent uses when "this batch wasn't enough, give me more from
 * across the full range." Each result carries a snippet (first
 * sentence-ish of the summary) so the agent can decide whether to
 * call `recallAnchor` for the full body.
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import type {
  AnchorRecord,
  AnchorStore,
} from "../session/agent-session-anchor-store.js";
import type {
  AnchorScorer,
} from "../session/agent-session-anchor-scorer.js";

export type SearchAnchorsContext = {
  readonly anchorStore: AnchorStore;
  readonly scorer: AnchorScorer;
  /**
   * Recently-recalled anchor ids in this session, oldest first. The
   * tool sums pheromone weights from these to each candidate as the
   * trail bonus. Empty when nothing has been recalled yet.
   */
  readonly recentlyRecalledIds: () => readonly string[];
  /**
   * Pheromone weight scaling factor applied on top of LLM relevance.
   * Default 0.2 means a maxed-out trail (10.0 cap × 0.2 = 2.0) can
   * lift a 0.4-relevance anchor above a 0.6-relevance one with no
   * trail. Tunable per host.
   */
  readonly pheromoneAlpha?: number;
  /**
   * Optional callback fired after a successful search. The host's
   * SearchHistoryStore appends here so inspectSearchHistory can
   * surface "the agent already searched for this" episodically.
   */
  readonly noteSearch?: (query: string, resultIds: readonly string[]) => void;
};

export type SearchAnchorsInput = {
  readonly query: string;
  readonly limit?: number;
  readonly excludeIds?: readonly string[];
};

export type SearchAnchorResult = {
  readonly anchorId: string;
  readonly topic: string;
  readonly snippet: string;
  readonly relevance: number;
  readonly pheromoneBonus: number;
  readonly rank: number;
  readonly fromWorldId: string;
  readonly toWorldId: string;
  readonly recordedAt: string;
  readonly turnRange: readonly [number, number];
};

export type SearchAnchorsOutput = {
  readonly query: string;
  readonly results: readonly SearchAnchorResult[];
  readonly hasMore: boolean;
  readonly totalAnchors: number;
  readonly totalScored: number;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;
const SNIPPET_MAX = 160;

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: {
      type: "string",
      description:
        "Natural-language description of the past memory to retrieve. The scorer ranks anchor topics by relevance to this query.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Max anchors to return per call. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
    },
    excludeIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Anchor ids the agent has already seen and wants to skip. Use this to paginate through results — each call passes the union of all ids returned in prior calls.",
    },
  },
};

export function createSearchAnchorsTool(): AgentTool<
  SearchAnchorsInput,
  SearchAnchorsOutput,
  SearchAnchorsContext
> {
  return {
    name: "searchAnchors",
    description:
      "Search the agent's anchor index (compressed memories of past conversation windows) by relevance to a natural-language query. Returns a ranked, paginated list with snippets. Pheromone trails from past successful retrievals are blended into the ranking. Pass `excludeIds` to fetch the next batch when the first didn't have what you needed.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runSearchAnchors(input, ctx),
  };
}

export async function runSearchAnchors(
  input: SearchAnchorsInput,
  ctx: SearchAnchorsContext,
): Promise<ToolRunResult<SearchAnchorsOutput>> {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.query !== "string"
  ) {
    return {
      ok: false,
      kind: "invalid_input",
      message: "searchAnchors requires `query: string`.",
    };
  }
  const query = input.query.trim();
  if (query === "") {
    return {
      ok: false,
      kind: "invalid_input",
      message: "searchAnchors `query` must be non-empty.",
    };
  }
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const exclude = new Set(
    Array.isArray(input.excludeIds) ? input.excludeIds : [],
  );

  const allAnchors = ctx.anchorStore.listAnchors();
  const candidates = allAnchors.filter((a) => !exclude.has(a.anchorId));
  if (candidates.length === 0) {
    return {
      ok: true,
      output: {
        query,
        results: [],
        hasMore: false,
        totalAnchors: allAnchors.length,
        totalScored: 0,
      },
    };
  }

  let scores: readonly { readonly id: string; readonly score: number }[];
  try {
    scores = await ctx.scorer.score({
      query,
      candidates: candidates.map((a) => ({
        id: a.anchorId,
        topic: a.topic,
      })),
    });
  } catch (err) {
    return {
      ok: false,
      kind: "runtime_error",
      message: `anchor scorer failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const recently = ctx.recentlyRecalledIds();
  const alpha = ctx.pheromoneAlpha ?? 0.2;
  const byId = new Map(candidates.map((a) => [a.anchorId, a]));
  type Scored = {
    record: AnchorRecord;
    relevance: number;
    pheromoneBonus: number;
    blended: number;
  };
  const scored: Scored[] = [];
  for (const s of scores) {
    const record = byId.get(s.id);
    if (record === undefined) continue;
    let bonus = 0;
    for (const recentId of recently) {
      bonus += ctx.anchorStore.getPheromoneWeight(s.id, recentId);
    }
    const scaledBonus = bonus * alpha;
    scored.push({
      record,
      relevance: s.score,
      pheromoneBonus: scaledBonus,
      blended: s.score + scaledBonus,
    });
  }
  scored.sort((a, b) => b.blended - a.blended);

  const sliced = scored.slice(0, limit);
  const results: SearchAnchorResult[] = sliced.map((s, i) => ({
    anchorId: s.record.anchorId,
    topic: s.record.topic,
    snippet: makeSnippet(s.record.summary),
    relevance: s.relevance,
    pheromoneBonus: s.pheromoneBonus,
    rank: i,
    fromWorldId: s.record.fromWorldId,
    toWorldId: s.record.toWorldId,
    recordedAt: new Date(s.record.recordedAt).toISOString(),
    turnRange: [s.record.turnRangeStart, s.record.turnRangeEnd] as const,
  }));

  // Record the search in episodic history (host-side store).
  ctx.noteSearch?.(
    query,
    results.map((r) => r.anchorId),
  );

  return {
    ok: true,
    output: {
      query,
      results,
      hasMore: scored.length > limit,
      totalAnchors: allAnchors.length,
      totalScored: scored.length,
    },
  };
}

function makeSnippet(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= SNIPPET_MAX) return trimmed;
  return `${trimmed.slice(0, SNIPPET_MAX - 3)}...`;
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
