/**
 * inspectSearchHistory + SearchHistoryStore tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSearchHistoryStore,
  type SearchHistoryStore,
} from "../../session/agent-session-search-history.js";
import {
  runInspectSearchHistory,
  type InspectSearchHistoryContext,
} from "../inspect-search-history.js";

let store: SearchHistoryStore;

beforeEach(() => {
  store = createSearchHistoryStore();
});

describe("SearchHistoryStore", () => {
  it("appends with monotonic indices", () => {
    const a = store.append("q1", ["a-1"]);
    const b = store.append("q2", ["a-2", "a-3"]);
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(store.count()).toBe(2);
  });

  it("listRecent returns newest-first", () => {
    store.append("q1", []);
    store.append("q2", []);
    store.append("q3", []);
    const recent = store.listRecent({ limit: 2 });
    expect(recent.map((e) => e.query)).toEqual(["q3", "q2"]);
  });

  it("listRecent respects beforeIndex", () => {
    store.append("q0", []);
    store.append("q1", []);
    store.append("q2", []);
    const recent = store.listRecent({ limit: 10, beforeIndex: 2 });
    expect(recent.map((e) => e.query)).toEqual(["q1", "q0"]);
  });

  it("evicts oldest when over maxEntries", () => {
    const small = createSearchHistoryStore({ maxEntries: 3 });
    small.append("q1", []);
    small.append("q2", []);
    small.append("q3", []);
    small.append("q4", []);
    expect(small.count()).toBe(3);
    const recent = small.listRecent({ limit: 10 });
    expect(recent.map((e) => e.query)).toEqual(["q4", "q3", "q2"]);
  });

  it("subscribe fires on append and clear", () => {
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.append("q", []);
    store.clear();
    expect(calls).toBe(2);
    off();
    store.append("after off", []);
    expect(calls).toBe(2);
  });
});

describe("inspectSearchHistory tool", () => {
  it("returns paginated newest-first entries", async () => {
    store.append("first query", ["a-1"]);
    store.append("second query", ["a-2", "a-3"]);
    const ctx: InspectSearchHistoryContext = { searchHistory: store };
    const result = await runInspectSearchHistory({ limit: 5 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.entries.map((e) => e.query)).toEqual([
      "second query",
      "first query",
    ]);
    expect(result.output.totalSearches).toBe(2);
    expect(result.output.nextBeforeIndex).toBe(null);
  });

  it("nextBeforeIndex points to the cursor for the next page", async () => {
    store.append("q0", []);
    store.append("q1", []);
    store.append("q2", []);
    const ctx: InspectSearchHistoryContext = { searchHistory: store };
    const first = await runInspectSearchHistory({ limit: 2 }, ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.output.entries.map((e) => e.query)).toEqual(["q2", "q1"]);
    expect(first.output.nextBeforeIndex).toBe(1);

    const second = await runInspectSearchHistory(
      { limit: 2, beforeIndex: first.output.nextBeforeIndex! },
      ctx,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.output.entries.map((e) => e.query)).toEqual(["q0"]);
    expect(second.output.nextBeforeIndex).toBe(null);
  });

  it("returns empty when store is empty", async () => {
    const ctx: InspectSearchHistoryContext = { searchHistory: store };
    const result = await runInspectSearchHistory({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.entries).toEqual([]);
    expect(result.output.totalSearches).toBe(0);
  });
});
