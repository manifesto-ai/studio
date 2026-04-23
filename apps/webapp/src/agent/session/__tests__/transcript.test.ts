/**
 * Transcript store tests.
 *
 * The store is a tiny append-only value plus a pub/sub hook. These
 * tests exercise the four invariants we rely on in the AgentLens UI:
 *
 *   1. `beginTurn` seeds a `user` entry and returns a stable id.
 *   2. `appendStep` fans llm / tool out with the correct turnId.
 *   3. `endTurn` appends a `turn-end` summary.
 *   4. `subscribe` fires on every push and returns an unsubscribe.
 *
 * Plus `groupByTurn` is exercised so the Lens UI renderer can rely
 * on the bucketing contract without duplicating it.
 */
import { describe, expect, it } from "vitest";
import { createTranscriptStore, groupByTurn } from "../transcript.js";
import type { OrchestratorStep } from "../../agents/orchestrator.js";

function stepClock(start: number = 0): () => string {
  let i = start;
  return () => {
    const d = new Date(Date.UTC(2024, 0, 1, 0, 0, i));
    i += 1;
    return d.toISOString();
  };
}

describe("transcript store — basic lifecycle", () => {
  it("appends user → llm → tool → llm → turn-end in order", () => {
    const store = createTranscriptStore(stepClock());
    const turn = store.beginTurn("why blocked?");
    const llmStep: OrchestratorStep = {
      kind: "llm",
      message: {
        role: "assistant",
        toolCalls: [
          { id: "c1", name: "legalityInspect", argumentsJson: '{}' },
        ],
      },
    };
    const toolStep: OrchestratorStep = {
      kind: "tool",
      toolCall: { id: "c1", name: "legalityInspect", argumentsJson: '{}' },
      resultJson: '{"ok":true}',
    };
    const finalStep: OrchestratorStep = {
      kind: "llm",
      message: { role: "assistant", content: "answer" },
    };
    store.appendStep(turn, llmStep);
    store.appendStep(turn, toolStep);
    store.appendStep(turn, finalStep);
    store.endTurn(turn, { stoppedAtCap: false, toolUses: 1 });

    const snap = store.getSnapshot();
    expect(snap.map((e) => e.kind)).toEqual([
      "user",
      "llm",
      "tool",
      "llm",
      "turn-end",
    ]);
    // All entries share the same turnId.
    expect(new Set(snap.map((e) => e.turnId))).toEqual(new Set([turn]));
    // seq monotonic.
    for (let i = 1; i < snap.length; i += 1) {
      expect(snap[i].seq).toBeGreaterThan(snap[i - 1].seq);
    }
  });

  it("assigns distinct turnIds on successive beginTurn", () => {
    const store = createTranscriptStore(stepClock());
    const a = store.beginTurn("first");
    const b = store.beginTurn("second");
    expect(a).not.toBe(b);
    expect(store.getSnapshot().filter((e) => e.kind === "user")).toHaveLength(2);
  });
});

describe("transcript store — subscribe / clear", () => {
  it("fires listeners on every mutation and supports unsubscribe", () => {
    const store = createTranscriptStore(stepClock());
    const seen: number[] = [];
    const off = store.subscribe((entries) => {
      seen.push(entries.length);
    });
    const turn = store.beginTurn("go");
    store.appendStep(turn, {
      kind: "llm",
      message: { role: "assistant", content: "hi" },
    });
    off();
    store.endTurn(turn, { stoppedAtCap: false, toolUses: 0 });
    // 2 emits observed; third skipped after unsubscribe.
    expect(seen).toEqual([1, 2]);
  });

  it("clear wipes all entries and resets seq", () => {
    const store = createTranscriptStore(stepClock());
    store.beginTurn("a");
    store.beginTurn("b");
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    const turn = store.beginTurn("c");
    const snap = store.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].seq).toBe(1);
    expect(turn).toBe("turn-1");
  });
});

describe("transcript store — streaming partials", () => {
  it("creates a pending entry on first delta and accumulates subsequent ones", () => {
    const store = createTranscriptStore(stepClock());
    const turn = store.beginTurn("q");
    store.appendStreamDelta(turn, 1, { content: "hel" });
    store.appendStreamDelta(turn, 1, { content: "lo " });
    store.appendStreamDelta(turn, 1, { reasoning: "thinking..." });
    const snap = store.getSnapshot();
    const pending = snap.find((e) => e.kind === "llm-pending");
    expect(pending).toBeDefined();
    if (pending?.kind === "llm-pending") {
      expect(pending.content).toBe("hel" + "lo ");
      expect(pending.reasoning).toBe("thinking...");
      expect(pending.stepIndex).toBe(1);
    }
  });

  it("replaces the pending entry when the finalized llm step arrives", () => {
    const store = createTranscriptStore(stepClock());
    const turn = store.beginTurn("q");
    store.appendStreamDelta(turn, 2, { content: "streaming…" });
    expect(
      store.getSnapshot().filter((e) => e.kind === "llm-pending"),
    ).toHaveLength(1);
    store.appendStep(turn, {
      kind: "llm",
      message: { role: "assistant", content: "final answer" },
      reasoning: "done thinking",
    });
    const snap = store.getSnapshot();
    expect(snap.filter((e) => e.kind === "llm-pending")).toHaveLength(0);
    const finalEntry = snap.find((e) => e.kind === "llm");
    expect(finalEntry?.kind).toBe("llm");
    if (finalEntry?.kind === "llm") {
      expect(finalEntry.message.content).toBe("final answer");
      expect(finalEntry.reasoning).toBe("done thinking");
    }
  });
});

describe("groupByTurn", () => {
  it("buckets entries by turnId in discovery order", () => {
    const store = createTranscriptStore(stepClock());
    const a = store.beginTurn("first");
    store.appendStep(a, {
      kind: "llm",
      message: { role: "assistant", content: "ok" },
    });
    store.endTurn(a, { stoppedAtCap: false, toolUses: 0 });
    const b = store.beginTurn("second");
    store.appendStep(b, {
      kind: "llm",
      message: { role: "assistant", content: "yes" },
    });
    const turns = groupByTurn(store.getSnapshot());
    expect(turns.map((t) => t.turnId)).toEqual([a, b]);
    expect(turns[0].userPrompt).toBe("first");
    expect(turns[0].end?.kind).toBe("turn-end");
    expect(turns[1].end).toBeNull(); // still open
    expect(turns[1].steps.map((s) => s.kind)).toEqual(["llm"]);
  });
});
