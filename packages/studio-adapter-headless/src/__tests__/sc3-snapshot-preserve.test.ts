import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

type TodoState = {
  readonly todos: ReadonlyArray<{ readonly title: string; readonly completed: boolean }>;
  readonly filterMode: string;
};

describe("SC-3 — snapshot value preservation across rebuild", () => {
  it("computed-only change keeps dispatched state values", async () => {
    const v1 = loadFixture("todo.mel");
    // v2 modifies a computed body without touching state or action shapes.
    const v2 = v1.replace(
      "computed todoCount = len(todos)",
      "computed todoCount = add(len(todos), 0)",
    );
    expect(v2).not.toBe(v1);

    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore();
    core.attach(adapter);

    const first = await core.build();
    expect(first.kind).toBe("ok");

    await core.dispatchAsync(core.createIntent("addTodo", { title: "preserved-1" }));
    await core.dispatchAsync(core.createIntent("addTodo", { title: "preserved-2" }));
    const beforeRebuild = core.getSnapshot() as unknown as { data: TodoState };
    expect(beforeRebuild.data.todos).toHaveLength(2);

    adapter.setSource(v2);
    const second = await core.build();
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;

    expect(second.schemaHash).not.toBe(first.kind === "ok" ? first.schemaHash : "");

    expect(second.plan.snapshotPlan.preserved).toContain("state_field:todos");
    expect(second.plan.snapshotPlan.preserved).toContain("state_field:filterMode");
    expect(second.plan.snapshotPlan.discarded).toEqual([]);

    const afterRebuild = core.getSnapshot() as unknown as { data: TodoState };
    expect(afterRebuild.data.todos).toHaveLength(2);
    expect(afterRebuild.data.todos[0]?.title).toBe("preserved-1");
    expect(afterRebuild.data.todos[1]?.title).toBe("preserved-2");
    expect(afterRebuild.data.filterMode).toBe("all");
  });

  it("removing a state field discards its value but keeps sibling state", async () => {
    const v1 = loadFixture("todo.mel");
    // v2 removes filterMode + its dependent action/computed reachability.
    const v2 = v1
      .replace('filterMode: "all" | "active" | "completed" = "all"', "")
      .replace(
        /action setFilter\(newFilter: "all" \| "active" \| "completed"\) \{[\s\S]*?\}\s*\}/,
        "",
      );

    const adapter = createHeadlessAdapter({ initialSource: v1 });
    const core = createStudioCore();
    core.attach(adapter);

    const first = await core.build();
    expect(first.kind).toBe("ok");

    await core.dispatchAsync(core.createIntent("addTodo", { title: "stay" }));

    adapter.setSource(v2);
    const second = await core.build();
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;

    expect(second.plan.snapshotPlan.discarded).toContain("state_field:filterMode");
    expect(second.plan.snapshotPlan.preserved).toContain("state_field:todos");

    const snap = core.getSnapshot() as unknown as { data: { todos: unknown[] } };
    expect(snap.data.todos).toHaveLength(1);
  });
});
