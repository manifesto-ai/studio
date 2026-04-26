/**
 * Legality tool tests — stubs a minimal `LegalityContext` so we don't
 * depend on a real StudioCore. Covers:
 *
 *   1. Admitted path (available + dispatchable).
 *   2. Unavailable path (the `available when` guard blocks).
 *   3. Not-dispatchable path (available but `dispatchable when` fails).
 *   4. Invalid-input path — `createIntent` throws.
 *   5. Unknown action guarded by `listActionNames`.
 *   6. Expression pretty-printer renders `get > lit` as `path > value`.
 */
import { describe, expect, it } from "vitest";
import {
  createLegalityTool,
  renderExpr,
  runLegality,
  type BlockerLike,
  type LegalityContext,
} from "../legality.js";

type IntentStub = { readonly action: string; readonly args: readonly unknown[] };

function makeCtx(overrides: Partial<LegalityContext> = {}): LegalityContext {
  return {
    isActionAvailable: () => true,
    createIntent: (action, ...args) => ({ action, args }) satisfies IntentStub,
    explainIntent: () => ({
      kind: "admitted",
      available: true,
      dispatchable: true,
    }),
    whyNot: () => null,
    ...overrides,
  };
}

describe("explainLegality — admitted", () => {
  it("returns dispatchable=true and empty blockers", async () => {
    const res = await runLegality(
      { action: "toggleTodo", args: ["t1"] },
      makeCtx(),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output).toMatchObject({
      action: "toggleTodo",
      available: true,
      inputValid: true,
      dispatchable: true,
      blockers: [],
    });
    expect(res.output.summary).toMatch(/dispatchable/i);
  });

  it("normalizes graph action node ids before checking legality", async () => {
    const seen: string[] = [];
    const res = await runLegality(
      { action: "action:restoreTask", args: ["t1"] },
      makeCtx({
        listActionNames: () => ["restoreTask"],
        isActionAvailable: (action) => {
          seen.push(action);
          return true;
        },
        createIntent: (action, ...args) => {
          seen.push(action);
          return { action, args };
        },
      }),
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.action).toBe("restoreTask");
    expect(seen).toEqual(["restoreTask", "restoreTask"]);
  });
});

describe("explainLegality — blocked at the `available` layer", () => {
  it("surfaces the failing guard expression", async () => {
    const blocker: BlockerLike = {
      layer: "available",
      expression: {
        kind: "gt",
        left: { kind: "get", path: "todos.remaining" },
        right: { kind: "lit", value: 0 },
      },
      evaluatedResult: false,
      description: "must have at least one open todo",
    };
    const res = await runLegality(
      { action: "clearDone" },
      makeCtx({
        isActionAvailable: () => false,
        explainIntent: () => ({
          kind: "blocked",
          available: false,
          dispatchable: false,
          blockers: [blocker],
        }),
        whyNot: () => [blocker],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.available).toBe(false);
    expect(res.output.dispatchable).toBe(false);
    expect(res.output.blockers).toHaveLength(1);
    expect(res.output.blockers[0]).toMatchObject({
      layer: "available",
      expression: "todos.remaining > 0",
      expressionKind: "gt",
      evaluatedResult: false,
      description: "must have at least one open todo",
    });
    expect(res.output.summary).toContain("unavailable");
    expect(res.output.summary).toContain("todos.remaining > 0");
  });
});

describe("explainLegality — available but not dispatchable", () => {
  it("separates the layer in summary + keeps structured blocker", async () => {
    const blocker: BlockerLike = {
      layer: "dispatchable",
      expression: {
        kind: "eq",
        left: { kind: "get", path: "board.current" },
        right: { kind: "lit", value: "p1" },
      },
      evaluatedResult: false,
    };
    const res = await runLegality(
      { action: "playCard", args: [{ id: "c1" }] },
      makeCtx({
        isActionAvailable: () => true,
        explainIntent: () => ({
          kind: "blocked",
          available: true,
          dispatchable: false,
          blockers: [blocker],
        }),
        whyNot: () => [blocker],
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.available).toBe(true);
    expect(res.output.dispatchable).toBe(false);
    expect(res.output.summary).toMatch(/available but not dispatchable/);
    expect(res.output.blockers[0]?.expression).toBe(
      'board.current == "p1"',
    );
  });
});

describe("explainLegality — invalid input", () => {
  it("catches createIntent errors without propagating them", async () => {
    const res = await runLegality(
      { action: "addTodo", args: [] },
      makeCtx({
        createIntent: () => {
          throw new Error("addTodo requires 1 arg; got 0");
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.output.inputValid).toBe(false);
    expect(res.output.dispatchable).toBe(false);
    expect(res.output.summary).toContain("inputs invalid");
    expect(res.output.summary).toContain("addTodo requires 1 arg");
  });
});

describe("explainLegality — unknown action", () => {
  it("rejects early when listActionNames is provided", async () => {
    const res = await runLegality(
      { action: "nonesuch" },
      makeCtx({
        listActionNames: () => ["toggleTodo", "addTodo"],
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
    expect(res.message).toContain("nonesuch");
    expect(res.message).toContain("toggleTodo");
  });
});

describe("explainLegality — shape validation", () => {
  it("rejects when action is missing / empty", async () => {
    const res = await runLegality({} as never, makeCtx());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("invalid_input");
    expect(res.message).toMatch(/action: string/);
  });
});

describe("createLegalityTool — registry-facing shape", () => {
  it("exposes the JSON schema + delegates to runLegality", async () => {
    const tool = createLegalityTool();
    expect(tool.name).toBe("explainLegality");
    // (describe-block titles above still read "legalityInspect" as a
    // shorthand for the legality-tool family; the tool itself is named
    // `explainLegality` to pair semantically with `dispatch`.)
    expect(tool.jsonSchema).toMatchObject({
      type: "object",
      required: ["action"],
    });
    const res = await tool.run({ action: "toggleTodo" }, makeCtx());
    expect(res.ok).toBe(true);
  });
});

describe("renderExpr — pretty-printer", () => {
  it("prints compound boolean expressions with infix + parens", () => {
    const out = renderExpr({
      kind: "and",
      args: [
        {
          kind: "gt",
          left: { kind: "get", path: "a" },
          right: { kind: "lit", value: 0 },
        },
        { kind: "not", arg: { kind: "get", path: "locked" } },
      ],
    });
    expect(out).toBe("(a > 0 && !locked)");
  });

  it("falls back to `kind(args)` for unknown kinds", () => {
    const out = renderExpr({
      kind: "mystery",
      arg: { kind: "get", path: "x" },
    });
    expect(out).toBe("mystery(x)");
  });
});
