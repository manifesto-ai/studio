/**
 * AnchorStore unit tests.
 *
 * Validates the host-side anchor index + ACO pheromone graph in
 * isolation. The store is a pure data structure with subscribe seam,
 * so tests don't need MEL booting or React.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAnchorStore,
  type AnchorStore,
} from "../agent-session-anchor-store.js";

function makeRecord(id: string, overrides: Partial<{ readonly turnRangeStart: number; readonly turnRangeEnd: number; readonly recordedAt: number; readonly fromWorldId: string; readonly toWorldId: string }> = {}) {
  return {
    anchorId: id,
    fromWorldId: overrides.fromWorldId ?? `from-${id}`,
    toWorldId: overrides.toWorldId ?? `to-${id}`,
    topic: `topic for ${id}`,
    summary: `summary for ${id}`,
    recordedAt: overrides.recordedAt ?? 1_700_000_000_000,
    turnRangeStart: overrides.turnRangeStart ?? 0,
    turnRangeEnd: overrides.turnRangeEnd ?? 5,
  };
}

let store: AnchorStore;

beforeEach(() => {
  store = createAnchorStore();
});

describe("AnchorStore — anchor records", () => {
  it("starts empty", () => {
    expect(store.anchorCount()).toBe(0);
    expect(store.listAnchors()).toEqual([]);
    expect(store.getAnchor("missing")).toBe(null);
    expect(store.hasAnchor("missing")).toBe(false);
  });

  it("putAnchor adds and getAnchor retrieves", () => {
    const r = makeRecord("a-1");
    store.putAnchor(r);
    expect(store.anchorCount()).toBe(1);
    expect(store.hasAnchor("a-1")).toBe(true);
    expect(store.getAnchor("a-1")).toEqual(r);
  });

  it("putAnchor overwrites the same id", () => {
    store.putAnchor(makeRecord("a-1"));
    const updated = { ...makeRecord("a-1"), topic: "updated topic" };
    store.putAnchor(updated);
    expect(store.getAnchor("a-1")?.topic).toBe("updated topic");
    expect(store.anchorCount()).toBe(1);
  });

  it("listAnchors returns all records (insertion order)", () => {
    store.putAnchor(makeRecord("a-1"));
    store.putAnchor(makeRecord("a-2"));
    store.putAnchor(makeRecord("a-3"));
    const ids = store.listAnchors().map((r) => r.anchorId);
    expect(ids).toEqual(["a-1", "a-2", "a-3"]);
  });

  it("clear empties everything", () => {
    store.putAnchor(makeRecord("a-1"));
    store.recordRecallSequence(["a-1", "a-1"]);
    store.clear();
    expect(store.anchorCount()).toBe(0);
    expect(store.listPheromoneEdges()).toEqual([]);
  });
});

describe("AnchorStore — pheromone graph", () => {
  it("recordRecallSequence deposits on consecutive pairs only", () => {
    // For [a, b, c, d], expect edges (a,b), (b,c), (c,d) — not (a,c) or (a,d).
    store.recordRecallSequence(["a", "b", "c", "d"]);
    expect(store.getPheromoneWeight("a", "b")).toBe(1);
    expect(store.getPheromoneWeight("b", "c")).toBe(1);
    expect(store.getPheromoneWeight("c", "d")).toBe(1);
    expect(store.getPheromoneWeight("a", "c")).toBe(0);
    expect(store.getPheromoneWeight("a", "d")).toBe(0);
  });

  it("treats edges as undirected (a→b deposit equals b→a read)", () => {
    store.recordRecallSequence(["a", "b"]);
    expect(store.getPheromoneWeight("a", "b")).toBe(1);
    expect(store.getPheromoneWeight("b", "a")).toBe(1);
  });

  it("deposits accumulate across multiple recalls of the same edge", () => {
    store.recordRecallSequence(["a", "b"]);
    store.recordRecallSequence(["a", "b"]);
    store.recordRecallSequence(["b", "a"]);
    expect(store.getPheromoneWeight("a", "b")).toBe(3);
  });

  it("respects maxEdgeWeight cap", () => {
    const capped = createAnchorStore({ initialDeposit: 4, maxEdgeWeight: 5 });
    capped.recordRecallSequence(["a", "b"]);
    capped.recordRecallSequence(["a", "b"]);
    capped.recordRecallSequence(["a", "b"]);
    expect(capped.getPheromoneWeight("a", "b")).toBe(5);
  });

  it("ignores same-id neighbours in the sequence", () => {
    store.recordRecallSequence(["a", "a", "b"]);
    expect(store.getPheromoneWeight("a", "a")).toBe(0);
    expect(store.getPheromoneWeight("a", "b")).toBe(1);
  });

  it("ignores sequences with fewer than two ids", () => {
    store.recordRecallSequence([]);
    store.recordRecallSequence(["a"]);
    expect(store.listPheromoneEdges()).toEqual([]);
  });

  it("listPheromoneEdges returns canonical undirected pairs", () => {
    store.recordRecallSequence(["b", "a"]);
    store.recordRecallSequence(["c", "a"]);
    const edges = store.listPheromoneEdges();
    expect(edges).toHaveLength(2);
    // Canonical key uses lexicographic min as anchorIdA.
    for (const e of edges) {
      expect(e.anchorIdA <= e.anchorIdB).toBe(true);
    }
  });

  it("self-edges read as zero (a == b)", () => {
    store.recordRecallSequence(["a", "b"]);
    expect(store.getPheromoneWeight("a", "a")).toBe(0);
  });
});

describe("AnchorStore — evaporation", () => {
  it("evaporateAll multiplies every edge weight", () => {
    store.recordRecallSequence(["a", "b"]);
    store.recordRecallSequence(["a", "b"]);
    expect(store.getPheromoneWeight("a", "b")).toBe(2);
    store.evaporateAll(0.5);
    expect(store.getPheromoneWeight("a", "b")).toBe(1);
  });

  it("drops edges that fall below evaporationFloor", () => {
    const cfg = createAnchorStore({
      initialDeposit: 1,
      evaporationFloor: 0.4,
    });
    cfg.recordRecallSequence(["a", "b"]);
    cfg.evaporateAll(0.5); // 1 → 0.5, above floor
    expect(cfg.getPheromoneWeight("a", "b")).toBe(0.5);
    cfg.evaporateAll(0.5); // 0.5 → 0.25, below 0.4 floor
    expect(cfg.getPheromoneWeight("a", "b")).toBe(0);
    expect(cfg.listPheromoneEdges()).toEqual([]);
  });

  it("evaporateAll is no-op when no edges exist", () => {
    store.evaporateAll(0.5);
    expect(store.listPheromoneEdges()).toEqual([]);
  });
});

describe("AnchorStore — subscribe", () => {
  it("notifies subscribers on putAnchor", () => {
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.putAnchor(makeRecord("a"));
    expect(calls).toBe(1);
    off();
    store.putAnchor(makeRecord("b"));
    expect(calls).toBe(1);
  });

  it("notifies on recordRecallSequence (when changed)", () => {
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.recordRecallSequence(["a", "b"]);
    expect(calls).toBe(1);
    // Same sequence again increments deposit so still emits.
    store.recordRecallSequence(["a", "b"]);
    expect(calls).toBe(2);
  });

  it("notifies on evaporateAll when edges exist", () => {
    let calls = 0;
    store.recordRecallSequence(["a", "b"]);
    store.subscribe(() => {
      calls += 1;
    });
    store.evaporateAll(0.5);
    expect(calls).toBe(1);
  });

  it("notifies on clear", () => {
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.clear();
    expect(calls).toBe(1);
  });
});
