import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeForDeterminismCompare,
  createInMemoryEditHistoryStore,
  createStudioCore,
  replayHistory,
} from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

type TodoState = {
  readonly todos: ReadonlyArray<{ readonly title: string }>;
};

describe("SC-5 — replay determinism", () => {
  it("every successful build appends an envelope (SE-HIST-1)", async () => {
    const store = createInMemoryEditHistoryStore();
    const v1 = loadFixture("todo.mel");
    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore({ editHistoryStore: store });
    core.attach(adapter);

    const r1 = await core.build();
    expect(r1.kind).toBe("ok");
    expect(await core.getEditHistory()).toHaveLength(1);

    adapter.setSource(
      v1.replace(
        "computed todoCount = len(todos)",
        "computed todoCount = add(len(todos), 0)",
      ),
    );
    const r2 = await core.build();
    expect(r2.kind).toBe("ok");

    const history = await core.getEditHistory();
    expect(history).toHaveLength(2);
    expect(history[0]?.payloadKind).toBe("rebuild");
    expect(history[0]?.prevSchemaHash).toBeNull();
    expect(history[1]?.prevSchemaHash).toBe(history[0]?.nextSchemaHash);
  });

  it("replay of the same envelope stream yields identical data snapshot", async () => {
    const store = createInMemoryEditHistoryStore();
    const v1 = loadFixture("todo.mel");
    const v2 = v1.replace(
      "computed todoCount = len(todos)",
      "computed todoCount = add(len(todos), 0)",
    );

    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore({ editHistoryStore: store });
    core.attach(adapter);

    await core.build();
    await core.dispatchAsync(core.createIntent("addTodo", { title: "alpha" }));
    await core.dispatchAsync(core.createIntent("addTodo", { title: "beta" }));
    adapter.setSource(v2);
    await core.build();

    const first = await replayHistory(store);
    const second = await replayHistory(store);

    // INV-SE-4: replaying the same envelope stream twice yields identical
    // final module (same schema hash) and identical `data` tree.
    expect(first.module?.schema.hash).toBe(second.module?.schema.hash);
    expect(first.plans.length).toBe(second.plans.length);
    expect(canonicalizeForDeterminismCompare(first.canonicalSnapshot)).toEqual(
      canonicalizeForDeterminismCompare(second.canonicalSnapshot),
    );
  });

  it("replay result's final schema matches the live pipeline's final schema", async () => {
    const store = createInMemoryEditHistoryStore();
    const v1 = loadFixture("todo.mel");
    const v2 = v1.replace(
      "computed completedCount = len(filter(todos, $item.completed))",
      "computed completedCount = len(filter(todos, eq($item.completed, true)))",
    );

    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore({ editHistoryStore: store });
    core.attach(adapter);

    const liveV1 = await core.build();
    expect(liveV1.kind).toBe("ok");
    adapter.setSource(v2);
    const liveV2 = await core.build();
    expect(liveV2.kind).toBe("ok");
    if (liveV2.kind !== "ok") return;

    const replay = await replayHistory(store);
    expect(replay.module?.schema.hash).toBe(liveV2.schemaHash);
    expect(replay.plans).toHaveLength(2);
  });

  it("replay does not carry dispatches (Phase 0 envelope kinds are rebuild-only)", async () => {
    const store = createInMemoryEditHistoryStore();
    const v1 = loadFixture("todo.mel");
    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore({ editHistoryStore: store });
    core.attach(adapter);

    await core.build();
    await core.dispatchAsync(core.createIntent("addTodo", { title: "live" }));

    // Live snapshot has the dispatched todo.
    const live = core.getSnapshot() as unknown as { data: TodoState };
    expect(live.data.todos).toHaveLength(1);

    // Replay starts from empty snapshot — dispatches are not envelopes in Phase 0.
    const replay = await replayHistory(store);
    const replayed = replay.canonicalSnapshot as unknown as { data: TodoState };
    expect(replayed.data.todos).toHaveLength(0);
  });
});
