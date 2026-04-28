/**
 * `inspectSearchHistory` — episodic memory of the agent's past
 * `searchAnchors` calls.
 *
 * Used so the agent can ask "have I searched for this query before?
 * what anchors did I find?" — meta-memory over its own retrieval
 * behaviour. Results are newest-first, paginated by `beforeIndex`.
 *
 * Backed by the host SearchHistoryStore, which is appended each time
 * `searchAnchors` settles. No MEL action is required because the
 * search itself doesn't change MEL state — the store is a pure
 * episodic log.
 */
import type { AgentTool, ToolRunResult } from "./types.js";
import type { SearchHistoryStore } from "../session/agent-session-search-history.js";

export type InspectSearchHistoryContext = {
  readonly searchHistory: SearchHistoryStore;
};

export type InspectSearchHistoryInput = {
  readonly limit?: number;
  readonly beforeIndex?: number;
};

export type SearchHistoryProjection = {
  readonly index: number;
  readonly query: string;
  readonly resultIds: readonly string[];
  readonly recordedAt: string;
};

export type InspectSearchHistoryOutput = {
  readonly entries: readonly SearchHistoryProjection[];
  readonly totalSearches: number;
  readonly nextBeforeIndex: number | null;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `How many history entries to return. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
    },
    beforeIndex: {
      type: "integer",
      description:
        "Pagination cursor — return entries with index strictly less than this.",
    },
  },
};

export function createInspectSearchHistoryTool(): AgentTool<
  InspectSearchHistoryInput,
  InspectSearchHistoryOutput,
  InspectSearchHistoryContext
> {
  return {
    name: "inspectSearchHistory",
    description:
      "Read the agent's own past searchAnchors queries (newest first). Use to recognise repeated questions, detect search loops, or recall which anchor ids were surfaced for a related earlier query. Paginate with `beforeIndex`.",
    jsonSchema: JSON_SCHEMA,
    run: async (input, ctx) => runInspectSearchHistory(input, ctx),
  };
}

export async function runInspectSearchHistory(
  input: InspectSearchHistoryInput,
  ctx: InspectSearchHistoryContext,
): Promise<ToolRunResult<InspectSearchHistoryOutput>> {
  const limit = clampInt(input?.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const beforeIndex =
    typeof input?.beforeIndex === "number" && Number.isFinite(input.beforeIndex)
      ? input.beforeIndex
      : undefined;

  const entries = ctx.searchHistory.listRecent({ limit, beforeIndex });
  const projected: SearchHistoryProjection[] = entries.map((e) => ({
    index: e.index,
    query: e.query,
    resultIds: e.resultIds,
    recordedAt: new Date(e.recordedAt).toISOString(),
  }));
  const total = ctx.searchHistory.count();
  const nextBeforeIndex =
    projected.length === limit && projected.length > 0
      ? projected[projected.length - 1]!.index
      : null;

  return {
    ok: true,
    output: {
      entries: projected,
      totalSearches: total,
      nextBeforeIndex,
    },
  };
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
