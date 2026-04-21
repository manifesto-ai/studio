import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import {
  createMonacoAdapter,
  type MonacoEditorLike,
  type MonacoLike,
  type MonacoMarkerData,
} from "../monaco-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const todoMel = readFileSync(
  join(
    repoRoot,
    "packages",
    "studio-adapter-headless",
    "src",
    "__tests__",
    "fixtures",
    "todo.mel",
  ),
  "utf8",
);

/**
 * Parity gate (P1-SC-2). Mirrors the headless `smoke.test.ts` flow — set
 * source → build → create + dispatch intent → inspect snapshot — but the
 * adapter under test is the Monaco one using a duck-typed fake editor.
 * If this passes, INV-SE-3 holds: a real widget adapter is plug-compatible
 * with the headless adapter used by Phase 0 tests.
 */
function makeMonacoFake(initial: string) {
  let value = initial;
  const model = { __kind: "fake-model" };
  const listeners = new Set<() => void>();
  const editor: MonacoEditorLike = {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
      for (const l of listeners) l();
    },
    getModel: () => model,
    onDidChangeModelContent: (cb) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
  };
  const setModelMarkers = vi.fn<
    [unknown, string, MonacoMarkerData[]],
    void
  >();
  const monaco: MonacoLike = { editor: { setModelMarkers } };
  return { editor, monaco, setModelMarkers };
}

describe("P1-SC-2 — headless parity with Monaco adapter", () => {
  it("todo.mel loads, builds, and dispatches through the Monaco adapter", async () => {
    const fake = makeMonacoFake(todoMel);
    const adapter = createMonacoAdapter({
      editor: fake.editor,
      monaco: fake.monaco,
    });
    const core = createStudioCore();
    core.attach(adapter);

    const result = await core.build();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.module.schema.id).toMatch(/todoapp/i);
    expect(Object.keys(result.module.schema.actions)).toContain("addTodo");

    const intent = core.createIntent("addTodo", { title: "from monaco" });
    const dispatched = await core.dispatchAsync(intent);
    expect(dispatched.kind).toBe("completed");

    const snap = core.getSnapshot() as unknown as {
      data: { todos: ReadonlyArray<{ title: string }> };
    };
    expect(snap.data.todos).toHaveLength(1);
    expect(snap.data.todos[0]?.title).toBe("from monaco");
    adapter.dispose();
  });

  it("rebuild with a computed-body change preserves state_field:todos (SC-3 parity)", async () => {
    const v1 = todoMel;
    const v2 = todoMel.replace(
      "computed todoCount = len(todos)",
      "computed todoCount = add(len(todos), 0)",
    );
    expect(v2).not.toBe(v1);

    const fake = makeMonacoFake(v1);
    const adapter = createMonacoAdapter({
      editor: fake.editor,
      monaco: fake.monaco,
    });
    const core = createStudioCore();
    core.attach(adapter);

    await core.build();
    await core.dispatchAsync(core.createIntent("addTodo", { title: "keepme" }));

    adapter.setSource(v2);
    const rebuilt = await core.build();
    expect(rebuilt.kind).toBe("ok");
    if (rebuilt.kind !== "ok") return;
    expect(rebuilt.plan.snapshotPlan.preserved).toContain("state_field:todos");

    const snap = core.getSnapshot() as unknown as {
      data: { todos: ReadonlyArray<{ title: string }> };
    };
    expect(snap.data.todos).toHaveLength(1);
    expect(snap.data.todos[0]?.title).toBe("keepme");
    adapter.dispose();
  });

  it("diagnostics flow surfaces markers through Monaco's setModelMarkers", async () => {
    const fake = makeMonacoFake("domain Bad { oops");
    const adapter = createMonacoAdapter({
      editor: fake.editor,
      monaco: fake.monaco,
    });
    const core = createStudioCore();
    core.attach(adapter);

    const result = await core.build();
    expect(result.kind).toBe("fail");
    // setMarkers must have reached monaco (studio-core's build-pipeline
    // emits markers on every build, successful or not).
    expect(fake.setModelMarkers).toHaveBeenCalled();
    const lastCall =
      fake.setModelMarkers.mock.calls[fake.setModelMarkers.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    if (lastCall === undefined) return;
    const [, , forwarded] = lastCall;
    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded[0]?.severity).toBeGreaterThan(0);
    adapter.dispose();
  });
});
