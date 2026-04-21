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
  readonly todos: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly completed: boolean;
  }>;
  readonly filterMode: "all" | "active" | "completed";
};

describe("SC-2 smoke — source → build → dispatch → snapshot", () => {
  it("runs the full cycle on todo.mel", async () => {
    const source = loadFixture("todo.mel");
    const adapter = createHeadlessAdapter({ initialSource: source });
    const core = createStudioCore();

    const detach = core.attach(adapter);
    try {
      // before the first build
      expect(core.getSnapshot()).toBeNull();
      expect(core.getModule()).toBeNull();
      expect(core.getLastReconciliationPlan()).toBeNull();

      const build = await core.build();
      expect(build.kind).toBe("ok");
      if (build.kind !== "ok") return;

      expect(build.schemaHash).toBe(build.module.schema.hash);
      expect(build.warnings).toEqual([]);
      expect(adapter.getMarkersEmitted()).toEqual([]);
      expect(core.getDiagnostics()).toEqual([]);
      expect(core.getLastReconciliationPlan()).not.toBeNull();

      const snap0 = core.getSnapshot();
      expect(snap0).not.toBeNull();
      const data0 = (snap0 as unknown as { data: TodoState }).data;
      expect(data0.todos).toEqual([]);
      expect(data0.filterMode).toBe("all");

      const intent = core.createIntent("addTodo", { title: "first" });
      const result = await core.dispatchAsync(intent);
      expect(result.kind).toBe("completed");

      const snap1 = core.getSnapshot();
      const data1 = (snap1 as unknown as { data: TodoState }).data;
      expect(data1.todos).toHaveLength(1);
      expect(data1.todos[0]?.title).toBe("first");
      expect(data1.todos[0]?.completed).toBe(false);

      // getTraceHistory returns the buffer; for todo.mel there are no host traces.
      expect(core.getTraceHistory()).toEqual([]);
    } finally {
      detach();
    }

    // Listener cleanup after detach
    expect(() => adapter.requestBuild()).not.toThrow();
  });
});
