/**
 * SearchHistoryStore — episodic memory of past `searchAnchors` calls.
 *
 * Each search the agent issues is appended here with the query and
 * the ids it received. The `inspectSearchHistory` tool reads back
 * recent entries so the agent can ask "have I searched for this
 * before? what did I find?" — meta-memory over its own retrieval
 * behaviour.
 *
 * Why a host store and not a MEL action?
 *
 * `searchAnchors` is a pure read — it doesn't change MEL state. Adding
 * a MEL action just to mark "the agent searched" adds dispatch noise
 * without buying anything: the snapshot wouldn't have a useful field
 * to update. The store keeps the episodic record while the rest of
 * the substrate stays clean. If we later want full lineage scrub for
 * search history (cross-session, etc.), we can add a recordSearchQuery
 * MEL action and migrate.
 */

export type SearchHistoryEntry = {
  /** Insertion order (0-based, monotonic, reset by clear). */
  readonly index: number;
  readonly query: string;
  readonly resultIds: readonly string[];
  readonly recordedAt: number;
};

export type SearchHistoryStoreOptions = {
  /** Cap entries kept in memory. Older entries drop off. Default 200. */
  readonly maxEntries?: number;
};

export type SearchHistoryStore = {
  readonly append: (
    query: string,
    resultIds: readonly string[],
  ) => SearchHistoryEntry;
  readonly listRecent: (
    options?: {
      readonly limit?: number;
      readonly beforeIndex?: number;
    },
  ) => readonly SearchHistoryEntry[];
  readonly count: () => number;
  readonly subscribe: (listener: () => void) => () => void;
  readonly clear: () => void;
};

export function createSearchHistoryStore(
  options: SearchHistoryStoreOptions = {},
): SearchHistoryStore {
  const max = Math.max(1, options.maxEntries ?? 200);
  const entries: SearchHistoryEntry[] = [];
  let nextIndex = 0;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const l of listeners) l();
  }

  return {
    append: (query, resultIds) => {
      const entry: SearchHistoryEntry = {
        index: nextIndex,
        query,
        resultIds: [...resultIds],
        recordedAt: Date.now(),
      };
      nextIndex += 1;
      entries.push(entry);
      // Evict oldest beyond the cap.
      while (entries.length > max) entries.shift();
      emit();
      return entry;
    },
    listRecent: (options = {}) => {
      const limit = Math.max(
        1,
        Math.min(entries.length, options.limit ?? 10),
      );
      const beforeIdx =
        typeof options.beforeIndex === "number"
          ? options.beforeIndex
          : Number.POSITIVE_INFINITY;
      // Newest-first, filter by beforeIndex (exclusive), take limit.
      const out: SearchHistoryEntry[] = [];
      for (let i = entries.length - 1; i >= 0 && out.length < limit; i -= 1) {
        const e = entries[i]!;
        if (e.index >= beforeIdx) continue;
        out.push(e);
      }
      return out;
    },
    count: () => entries.length,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear: () => {
      entries.length = 0;
      nextIndex = 0;
      emit();
    },
  };
}
