/**
 * AnchorScorer tests — substring fallback + AI SDK parser invariants.
 *
 * The full AI SDK transport path (with prepareSendMessagesRequest +
 * server route + AI SDK stream) is exercised end-to-end in the
 * AgentLens integration; here we test the parser surface and the
 * substring fallback, which are pure.
 */
import { describe, expect, it } from "vitest";
import { substringMatchScorer } from "../agent-session-anchor-scorer.js";
import {
  buildScorerUserPrompt,
  parseScorerResponse,
} from "../aisdk-anchor-scorer.js";

describe("substringMatchScorer", () => {
  it("scores by hit count, capped at 1.0", async () => {
    const scorer = substringMatchScorer();
    const out = await scorer.score({
      query: "agent architecture redesign",
      candidates: [
        { id: "a-1", topic: "agent architecture redesign" }, // 3 hits → 0.75
        { id: "a-2", topic: "agent runtime" }, // 1 hit → 0.25
        { id: "a-3", topic: "tool execution" }, // 0 hits → excluded
      ],
    });
    const map = new Map(out.map((s) => [s.id, s.score]));
    expect(map.get("a-1")).toBe(0.75);
    expect(map.get("a-2")).toBe(0.25);
    expect(map.has("a-3")).toBe(false);
  });

  it("returns weak default scores when query has no useful tokens", async () => {
    const scorer = substringMatchScorer();
    const out = await scorer.score({
      query: "?? .. ,,",
      candidates: [{ id: "a-1", topic: "agent architecture" }],
    });
    expect(out).toEqual([{ id: "a-1", score: 0.05 }]);
  });

  it("handles Korean tokens", async () => {
    const scorer = substringMatchScorer();
    const out = await scorer.score({
      query: "에이전트 설계",
      candidates: [
        { id: "a-1", topic: "에이전트 설계 토론" },
        { id: "a-2", topic: "tool 실행" },
      ],
    });
    expect(out.find((s) => s.id === "a-1")?.score).toBeGreaterThan(0);
    expect(out.find((s) => s.id === "a-2")).toBeUndefined();
  });

  it("returns empty array when no candidates match", async () => {
    const scorer = substringMatchScorer();
    const out = await scorer.score({
      query: "rare unmatchable query",
      candidates: [{ id: "a-1", topic: "agent" }],
    });
    expect(out).toEqual([]);
  });
});

describe("parseScorerResponse", () => {
  const candidates = [
    { id: "a-1", topic: "x" },
    { id: "a-2", topic: "y" },
  ];

  it("parses a clean JSON array", () => {
    const result = parseScorerResponse(
      `[{"id": "a-1", "score": 0.9}, {"id": "a-2", "score": 0.4}]`,
      candidates,
    );
    expect(result).toEqual([
      { id: "a-1", score: 0.9 },
      { id: "a-2", score: 0.4 },
    ]);
  });

  it("extracts first JSON array embedded in prose", () => {
    const result = parseScorerResponse(
      `Sure, here's the ranking:\n\n[{"id": "a-1", "score": 0.7}]\n\nLet me know.`,
      candidates,
    );
    expect(result).toEqual([{ id: "a-1", score: 0.7 }]);
  });

  it("returns null on invalid JSON", () => {
    const result = parseScorerResponse(
      `not json at all`,
      candidates,
    );
    expect(result).toBe(null);
  });

  it("filters out unknown anchor ids", () => {
    const result = parseScorerResponse(
      `[{"id": "ghost", "score": 0.9}, {"id": "a-1", "score": 0.5}]`,
      candidates,
    );
    expect(result).toEqual([{ id: "a-1", score: 0.5 }]);
  });

  it("clamps scores into [0, 1]", () => {
    const result = parseScorerResponse(
      `[{"id": "a-1", "score": 1.5}, {"id": "a-2", "score": -0.3}]`,
      candidates,
    );
    expect(result).toEqual([
      { id: "a-1", score: 1 },
      { id: "a-2", score: 0 },
    ]);
  });

  it("returns empty array when JSON is empty", () => {
    expect(parseScorerResponse("[]", candidates)).toEqual([]);
  });

  it("returns null on non-array JSON (e.g., object)", () => {
    expect(
      parseScorerResponse(`{"id": "a-1", "score": 0.9}`, candidates),
    ).toBe(null);
  });
});

describe("buildScorerUserPrompt", () => {
  it("includes the query and a labelled list of anchors", () => {
    const text = buildScorerUserPrompt("how does focus work", [
      { id: "a-1", topic: "focus and selection" },
      { id: "a-2", topic: "tool execution" },
    ]);
    expect(text).toContain("Query: how does focus work");
    expect(text).toContain('id="a-1"');
    expect(text).toContain('"focus and selection"');
  });

  it("escapes topic strings that would break the format", () => {
    const text = buildScorerUserPrompt("q", [
      { id: "a-1", topic: 'topic with "quotes" and \\backslashes' },
    ]);
    // JSON.stringify produces a parseable embedded string.
    expect(text).toContain(
      JSON.stringify('topic with "quotes" and \\backslashes'),
    );
  });
});
