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
  readonly todos: ReadonlyArray<{ readonly title: string }>;
};

describe("SE-RECON-7 — schema-hash skip", () => {
  it("rebuilding identical source preserves runtime state (no re-activation)", async () => {
    const source = loadFixture("todo.mel");
    const adapter = createHeadlessAdapter({ initialSource: source });
    const core = createStudioCore();
    core.attach(adapter);

    const first = await core.build();
    expect(first.kind).toBe("ok");

    // Dispatch once to diverge from a fresh activation.
    const intent = core.createIntent("addTodo", { title: "persisted" });
    await core.dispatchAsync(intent);
    const snapAfterDispatch = core.getSnapshot();
    expect(
      (snapAfterDispatch as unknown as { data: TodoState }).data.todos,
    ).toHaveLength(1);

    // Rebuild identical source — runtime state must carry through.
    const second = await core.build();
    expect(second.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(second.schemaHash).toBe(first.schemaHash);
      expect(second.plan.prevSchemaHash).toBe(second.plan.nextSchemaHash);
    }

    const snapAfterSecond = core.getSnapshot();
    const data = (snapAfterSecond as unknown as { data: TodoState }).data;
    expect(data.todos).toHaveLength(1);
    expect(data.todos[0]?.title).toBe("persisted");
  });

  it("identical rebuild marks every target as preserved", async () => {
    const adapter = createHeadlessAdapter({
      initialSource: loadFixture("todo.mel"),
    });
    const core = createStudioCore();
    core.attach(adapter);

    const first = await core.build();
    expect(first.kind).toBe("ok");

    const second = await core.build();
    expect(second.kind).toBe("ok");
    if (second.kind !== "ok") return;

    const { plan } = second;
    expect(plan.identityMap.size).toBeGreaterThan(0);
    for (const fate of plan.identityMap.values()) {
      expect(fate.kind).toBe("preserved");
    }
    expect(plan.snapshotPlan.initialized).toEqual([]);
    expect(plan.snapshotPlan.discarded).toEqual([]);
    expect(plan.snapshotPlan.warned).toEqual([]);
  });
});
