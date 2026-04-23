/**
 * studioDispatch tool tests — stub a minimal `StudioDispatchContext`
 * pointing at a fake studio runtime and exercise:
 *
 *   1. Happy path — focusNode completed + changedPaths surfaced.
 *   2. Legality-gated action (enterSimulation) rejected when viewMode
 *      is not "live" — returns status:unavailable.
 *   3. Runtime rejection path — SDK returns kind:"rejected".
 *   4. Dispatcher throws — status:failed + error message.
 *   5. Shape validation + unknown-action rejection.
 */
import { describe, expect, it } from "vitest";
import {
  createStudioDispatchTool,
  runStudioDispatch,
  type StudioDispatchContext,
} from "../studio-dispatch.js";
import type { DispatchResultLike } from "../dispatch.js";

const STUDIO_ACTIONS = [
  "focusNode",
  "clearFocus",
  "openLens",
  "enterSimulation",
  "exitSimulation",
  "scrubTo",
  "resetScrub",
  "switchProject",
] as const;

function makeCtx(
  overrides: Partial<StudioDispatchContext> = {},
): StudioDispatchContext {
  return {
    isActionAvailable: () => true,
    createIntent: (action, ...args) => ({ action, args }),
    dispatchAsync: async () =>
      ({
        kind: "completed",
        outcome: { projected: { changedPaths: ["data.focusedNodeId"] } },
      }) satisfies DispatchResultLike,
    listActionNames: () => STUDIO_ACTIONS,
    ...overrides,
  };
}

describe("studioDispatch — happy path", () => {
  it("returns status:completed with changed paths", async () => {
    const res = await runStudioDispatch(
      { action: "focusNode", args: ["action:toggleTodo", "action", "agent"] },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output).toMatchObject({
      action: "focusNode",
      status: "completed",
      changedPaths: ["data.focusedNodeId"],
    });
  });
});

describe("studioDispatch — viewMode gate short-circuit", () => {
  it("returns unavailable when isActionAvailable=false", async () => {
    let dispatched = false;
    const res = await runStudioDispatch(
      { action: "enterSimulation", args: ["toggleTodo"] },
      makeCtx({
        isActionAvailable: (name) => name !== "enterSimulation",
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
    expect(res.output.summary).toContain("viewMode");
  });
});

describe("studioDispatch — runtime rejection", () => {
  it("surfaces the rejection reason", async () => {
    const res = await runStudioDispatch(
      { action: "scrubTo", args: ["env-1"] },
      makeCtx({
        dispatchAsync: async () => ({
          kind: "rejected",
          rejection: {
            code: "INTENT_NOT_DISPATCHABLE",
            reason: "viewMode is simulate",
          },
        }),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.status).toBe("rejected");
    expect(res.output.error).toBe("viewMode is simulate");
  });
});

describe("studioDispatch — dispatcher throws", () => {
  it("captures the error into status:failed", async () => {
    const res = await runStudioDispatch(
      { action: "openLens", args: ["agent"] },
      makeCtx({
        dispatchAsync: async () => {
          throw new Error("runtime not ready");
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.status).toBe("failed");
    expect(res.output.error).toBe("runtime not ready");
  });
});

describe("studioDispatch — shape + name validation", () => {
  it("rejects missing action", async () => {
    const res = await runStudioDispatch({} as never, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
  });

  it("rejects unknown studio actions", async () => {
    const res = await runStudioDispatch(
      { action: "doSomething" },
      makeCtx(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
    expect(res.message).toContain("doSomething");
  });
});

describe("createStudioDispatchTool — registry shape", () => {
  it("exposes the JSON schema + delegates to runStudioDispatch", async () => {
    const tool = createStudioDispatchTool();
    expect(tool.name).toBe("studioDispatch");
    expect(tool.jsonSchema).toMatchObject({
      type: "object",
      required: ["action"],
    });
    const res = await tool.run({ action: "clearFocus" }, makeCtx());
    expect(res.ok).toBe(true);
  });
});
