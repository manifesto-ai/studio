/**
 * dispatch tool tests — stub a minimal `DispatchContext` and
 * exercise the three paths the orchestrator relies on:
 *
 *   1. Happy path — `core.dispatchAsync` returns `kind:"completed"`.
 *   2. Unavailable — `isActionAvailable` returns false; tool short-
 *      circuits without calling `dispatchAsync`.
 *   3. Rejected — dispatcher returns `kind:"rejected"` with a
 *      rejection reason; tool surfaces it.
 *   4. Failed — dispatcher throws.
 *   5. Shape validation — missing action name → invalid_input.
 *   6. Unknown action — `listActionNames` filters.
 */
import { describe, expect, it } from "vitest";
import {
  createDispatchTool,
  runDispatch,
  type DispatchContext,
  type DispatchResultLike,
} from "../dispatch.js";

function makeCtx(
  overrides: Partial<DispatchContext> = {},
): DispatchContext {
  return {
    isActionAvailable: () => true,
    createIntent: (action, ...args) => ({ action, args }),
    dispatchAsync: async () =>
      ({
        kind: "completed",
        outcome: { projected: { changedPaths: ["todos.items"] } },
      }) satisfies DispatchResultLike,
    listActionNames: () => ["toggleTodo", "addTodo", "clearDone"],
    ...overrides,
  };
}

describe("dispatch — happy path", () => {
  it("returns status:completed with changed paths", async () => {
    const res = await runDispatch(
      { action: "toggleTodo", args: ["t1"] },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output).toMatchObject({
      action: "toggleTodo",
      status: "completed",
      changedPaths: ["todos.items"],
    });
    expect(res.output.summary).toContain("todos.items");
  });

  it("handles the zero-changed-paths case in its summary", async () => {
    const res = await runDispatch(
      { action: "addTodo", args: [{ text: "x" }] },
      makeCtx({
        dispatchAsync: async () => ({ kind: "completed" }),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.summary).toMatch(/no state paths changed/);
  });
});

describe("dispatch — legality short-circuit", () => {
  it("returns unavailable without invoking dispatchAsync", async () => {
    let dispatched = false;
    const res = await runDispatch(
      { action: "clearDone" },
      makeCtx({
        isActionAvailable: () => false,
        dispatchAsync: async () => {
          dispatched = true;
          return { kind: "completed" };
        },
      }),
    );
    expect(dispatched).toBe(false);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.status).toBe("unavailable");
    expect(res.output.summary).toContain("explainLegality");
  });
});

describe("dispatch — rejected by runtime", () => {
  it("surfaces the rejection reason", async () => {
    const res = await runDispatch(
      { action: "playCard", args: [{ id: "c1" }] },
      makeCtx({
        listActionNames: () => ["playCard"],
        dispatchAsync: async () => ({
          kind: "rejected",
          rejection: {
            code: "INTENT_NOT_DISPATCHABLE",
            reason: "not your turn",
          },
        }),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.status).toBe("rejected");
    expect(res.output.error).toBe("not your turn");
    expect(res.output.summary).toContain("not your turn");
  });
});

describe("dispatch — dispatcher throws", () => {
  it("captures the error into status:failed", async () => {
    const res = await runDispatch(
      { action: "toggleTodo", args: ["t1"] },
      makeCtx({
        dispatchAsync: async () => {
          throw new Error("network blip");
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.status).toBe("failed");
    expect(res.output.error).toBe("network blip");
  });
});

describe("dispatch — shape + name validation", () => {
  it("rejects missing action", async () => {
    const res = await runDispatch({} as never, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
  });

  it("rejects unknown actions via listActionNames", async () => {
    const res = await runDispatch({ action: "nonesuch" }, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
    expect(res.message).toContain("nonesuch");
  });

  it("wraps createIntent failures as invalid_input", async () => {
    const res = await runDispatch(
      { action: "toggleTodo", args: [] },
      makeCtx({
        createIntent: () => {
          throw new Error("missing required arg");
        },
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
    expect(res.message).toContain("missing required arg");
  });
});

describe("createDispatchTool — registry shape", () => {
  it("exposes the JSON schema + delegates to runDispatch", async () => {
    const tool = createDispatchTool();
    expect(tool.name).toBe("dispatch");
    expect(tool.jsonSchema).toMatchObject({
      type: "object",
      required: ["action"],
    });
    const res = await tool.run({ action: "toggleTodo" }, makeCtx());
    expect(res.ok).toBe(true);
  });
});
