/**
 * searchAnchors tool tests — store + scorer + pheromone integration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnchorStore,
  type AnchorStore,
} from "../../session/agent-session-anchor-store.js";
import type {
  AnchorScoreInput,
  AnchorScorer,
} from "../../session/agent-session-anchor-scorer.js";
import {
  runSearchAnchors,
  type SearchAnchorsContext,
} from "../search-anchors.js";

function makeRecord(id: string, topic: string, summary: string, ts = 1_700_000_000_000) {
  return {
    anchorId: id,
    fromWorldId: `from-${id}`,
    toWorldId: `to-${id}`,
    topic,
    summary,
    recordedAt: ts,
    turnRangeStart: 0,
    turnRangeEnd: 5,
  };
}

let store: AnchorStore;

beforeEach(() => {
  store = createAnchorStore();
  store.putAnchor(makeRecord("a-1", "agent architecture redesign", "We discussed lineage as history and anchors as compression. Decided to make anchors navigable."));
  store.putAnchor(makeRecord("a-2", "tool execution flow", "How tools admit, execute, and dispatch back through MEL."));
  store.putAnchor(makeRecord("a-3", "mock data palette", "UI for seeding mock data into the user runtime."));
});

function makeScorer(scores: readonly { readonly id: string; readonly score: number }[]): AnchorScorer {
  return {
    score: vi.fn(async (_input: AnchorScoreInput) => scores) as AnchorScorer["score"],
  };
}

function makeCtx(overrides: Partial<SearchAnchorsContext> = {}): SearchAnchorsContext {
  return {
    anchorStore: store,
    scorer: overrides.scorer ?? makeScorer([
      { id: "a-1", score: 0.9 },
      { id: "a-2", score: 0.4 },
    ]),
    recentlyRecalledIds: overrides.recentlyRecalledIds ?? (() => []),
    pheromoneAlpha: overrides.pheromoneAlpha,
  };
}

describe("searchAnchors — basic ranking", () => {
  it("returns ranked results with snippets", async () => {
    const ctx = makeCtx();
    const result = await runSearchAnchors({ query: "agent design" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.results).toHaveLength(2);
    expect(result.output.results[0]!.anchorId).toBe("a-1");
    expect(result.output.results[0]!.relevance).toBe(0.9);
    expect(result.output.results[0]!.snippet).toContain("lineage");
    expect(result.output.totalAnchors).toBe(3);
  });

  it("rejects empty query", async () => {
    const ctx = makeCtx();
    const result = await runSearchAnchors({ query: "   " }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_input");
  });

  it("returns empty when scorer matches nothing", async () => {
    const ctx = makeCtx({ scorer: makeScorer([]) });
    const result = await runSearchAnchors({ query: "unrelated" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.results).toEqual([]);
    expect(result.output.totalScored).toBe(0);
    expect(result.output.hasMore).toBe(false);
  });
});

describe("searchAnchors — pagination", () => {
  it("respects limit and reports hasMore", async () => {
    const ctx = makeCtx({
      scorer: makeScorer([
        { id: "a-1", score: 0.9 },
        { id: "a-2", score: 0.7 },
        { id: "a-3", score: 0.5 },
      ]),
    });
    const result = await runSearchAnchors({ query: "x", limit: 2 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.results).toHaveLength(2);
    expect(result.output.hasMore).toBe(true);
    expect(result.output.totalScored).toBe(3);
  });

  it("excludes ids the agent has already seen", async () => {
    const ctx = makeCtx({
      scorer: makeScorer([
        { id: "a-1", score: 0.9 },
        { id: "a-2", score: 0.7 },
        { id: "a-3", score: 0.5 },
      ]),
    });
    const result = await runSearchAnchors(
      { query: "x", excludeIds: ["a-1", "a-2"] },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.results).toHaveLength(1);
    expect(result.output.results[0]!.anchorId).toBe("a-3");
  });

  it("scorer is only asked about non-excluded candidates", async () => {
    const scoreFn = vi.fn(async (input: AnchorScoreInput) => {
      // Echo: score every candidate at 0.5 (no actual ranking).
      return input.candidates.map((c) => ({ id: c.id, score: 0.5 }));
    });
    const scorer: AnchorScorer = { score: scoreFn };
    const ctx = makeCtx({ scorer });
    await runSearchAnchors(
      { query: "x", excludeIds: ["a-1"] },
      ctx,
    );
    expect(scoreFn).toHaveBeenCalledTimes(1);
    const passedCandidates = scoreFn.mock.calls[0]![0]!.candidates.map(
      (c) => c.id,
    );
    expect(passedCandidates).toEqual(["a-2", "a-3"]);
  });
});

describe("searchAnchors — pheromone bonus", () => {
  it("boosts anchors connected to recently-recalled ids", async () => {
    // a-2 has lower base relevance but a strong trail to a recently-recalled a-3.
    store.recordRecallSequence(["a-3", "a-2"]);
    store.recordRecallSequence(["a-3", "a-2"]);
    store.recordRecallSequence(["a-3", "a-2"]); // weight = 3 between a-3 and a-2
    const ctx = makeCtx({
      scorer: makeScorer([
        { id: "a-1", score: 0.5 },
        { id: "a-2", score: 0.4 },
      ]),
      recentlyRecalledIds: () => ["a-3"],
      pheromoneAlpha: 0.5, // 3 * 0.5 = 1.5 bonus
    });
    const result = await runSearchAnchors({ query: "x" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // a-2 should rank above a-1 once bonus is applied.
    expect(result.output.results[0]!.anchorId).toBe("a-2");
    expect(result.output.results[0]!.pheromoneBonus).toBeCloseTo(1.5, 5);
    expect(result.output.results[1]!.anchorId).toBe("a-1");
    expect(result.output.results[1]!.pheromoneBonus).toBe(0);
  });

  it("zero pheromone when no recent recalls", async () => {
    store.recordRecallSequence(["a-1", "a-2"]);
    const ctx = makeCtx({
      scorer: makeScorer([{ id: "a-1", score: 0.5 }]),
      recentlyRecalledIds: () => [],
    });
    const result = await runSearchAnchors({ query: "x" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.results[0]!.pheromoneBonus).toBe(0);
  });
});

describe("searchAnchors — error handling", () => {
  it("returns runtime_error when scorer throws", async () => {
    const scorer: AnchorScorer = {
      score: async () => {
        throw new Error("LLM offline");
      },
    };
    const ctx = makeCtx({ scorer });
    const result = await runSearchAnchors({ query: "x" }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("runtime_error");
    expect(result.message).toContain("LLM offline");
  });
});
