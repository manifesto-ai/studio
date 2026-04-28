/**
 * recallAnchor + inspectAnchorLineage tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAnchorStore,
  type AnchorStore,
} from "../../session/agent-session-anchor-store.js";
import {
  runRecallAnchor,
  type RecallAnchorContext,
} from "../recall-anchor.js";
import {
  runInspectAnchorLineage,
  type InspectAnchorLineageContext,
} from "../inspect-anchor-lineage.js";
import type { FullLineageEntry } from "../inspect-lineage.js";

function makeRecord(id: string, fromW: string, toW: string) {
  return {
    anchorId: id,
    fromWorldId: fromW,
    toWorldId: toW,
    topic: `topic ${id}`,
    summary: `summary for ${id}`,
    recordedAt: 1_700_000_000_000,
    turnRangeStart: 0,
    turnRangeEnd: 5,
  };
}

let store: AnchorStore;

beforeEach(() => {
  store = createAnchorStore();
});

describe("recallAnchor", () => {
  it("returns full body and notes the recall", async () => {
    store.putAnchor(makeRecord("a-1", "from-1", "to-1"));
    const noteRecall = vi.fn();
    const ctx: RecallAnchorContext = { anchorStore: store, noteRecall };
    const result = await runRecallAnchor({ anchorId: "a-1" }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.anchorId).toBe("a-1");
    expect(result.output.summary).toBe("summary for a-1");
    expect(result.output.topic).toBe("topic a-1");
    expect(noteRecall).toHaveBeenCalledWith("a-1");
  });

  it("rejects unknown anchorId", async () => {
    const ctx: RecallAnchorContext = {
      anchorStore: store,
      noteRecall: vi.fn(),
    };
    const result = await runRecallAnchor({ anchorId: "ghost" }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("invalid_input");
    expect(result.message).toContain("ghost");
  });

  it("rejects empty anchorId", async () => {
    const ctx: RecallAnchorContext = {
      anchorStore: store,
      noteRecall: vi.fn(),
    };
    const result = await runRecallAnchor({ anchorId: "" }, ctx);
    expect(result.ok).toBe(false);
  });
});

describe("inspectAnchorLineage", () => {
  function makeWorld(
    id: string,
    intentType: string = "recordUserTurn",
  ): FullLineageEntry {
    return {
      worldId: id,
      origin: { kind: "dispatch", intentType },
      parentWorldId: null,
      schemaHash: "schema-hash",
      changedPaths: [],
      createdAt: new Date(1_700_000_000_000).toISOString(),
    };
  }

  it("returns worlds within the anchor's window in chronological order", async () => {
    store.putAnchor(makeRecord("a-1", "w-2", "w-5"));
    // newest-first lineage convention; reverse for chrono inside the tool.
    const lineage: FullLineageEntry[] = [
      makeWorld("w-7"),
      makeWorld("w-6"),
      makeWorld("w-5"),
      makeWorld("w-4"),
      makeWorld("w-3"),
      makeWorld("w-2"),
      makeWorld("w-1"),
    ];
    const ctx: InspectAnchorLineageContext = {
      anchorStore: store,
      getLineage: () => lineage,
      noteRecall: vi.fn(),
    };
    const result = await runInspectAnchorLineage(
      { anchorId: "a-1" },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Window is fromWorldId="w-2" exclusive, toWorldId="w-5" inclusive.
    // Chronological order: [w-3, w-4, w-5].
    const ids = result.output.entries.map((e) => e.worldId);
    expect(ids).toEqual(["w-3", "w-4", "w-5"]);
    expect(result.output.totalInWindow).toBe(3);
  });

  it("treats session-start as no-lower-bound", async () => {
    store.putAnchor(makeRecord("a-1", "session-start", "w-2"));
    const lineage: FullLineageEntry[] = [
      makeWorld("w-3"),
      makeWorld("w-2"),
      makeWorld("w-1"),
    ];
    const ctx: InspectAnchorLineageContext = {
      anchorStore: store,
      getLineage: () => lineage,
      noteRecall: vi.fn(),
    };
    const result = await runInspectAnchorLineage(
      { anchorId: "a-1" },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.entries.map((e) => e.worldId)).toEqual([
      "w-1",
      "w-2",
    ]);
  });

  it("paginates with beforeWorldId cursor", async () => {
    store.putAnchor(makeRecord("a-1", "session-start", "w-5"));
    const lineage: FullLineageEntry[] = [
      makeWorld("w-5"),
      makeWorld("w-4"),
      makeWorld("w-3"),
      makeWorld("w-2"),
      makeWorld("w-1"),
    ];
    const ctx: InspectAnchorLineageContext = {
      anchorStore: store,
      getLineage: () => lineage,
      noteRecall: vi.fn(),
    };
    const first = await runInspectAnchorLineage(
      { anchorId: "a-1", limit: 2 },
      ctx,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.output.entries.map((e) => e.worldId)).toEqual([
      "w-1",
      "w-2",
    ]);
    expect(first.output.nextBeforeWorldId).toBe("w-2");

    const second = await runInspectAnchorLineage(
      { anchorId: "a-1", limit: 2, beforeWorldId: "w-2" },
      ctx,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.output.entries.map((e) => e.worldId)).toEqual([
      "w-3",
      "w-4",
    ]);
  });

  it("rejects unknown anchorId", async () => {
    const ctx: InspectAnchorLineageContext = {
      anchorStore: store,
      getLineage: () => [],
      noteRecall: vi.fn(),
    };
    const result = await runInspectAnchorLineage(
      { anchorId: "ghost" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });

  it("notes the recall for pheromone tracking", async () => {
    store.putAnchor(makeRecord("a-1", "session-start", "w-1"));
    const noteRecall = vi.fn();
    const ctx: InspectAnchorLineageContext = {
      anchorStore: store,
      getLineage: () => [],
      noteRecall,
    };
    await runInspectAnchorLineage({ anchorId: "a-1" }, ctx);
    expect(noteRecall).toHaveBeenCalledWith("a-1");
  });
});
