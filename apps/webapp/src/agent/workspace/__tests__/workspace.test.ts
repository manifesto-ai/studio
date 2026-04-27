import { describe, expect, it } from "vitest";
import { compileMelModule } from "@manifesto-ai/compiler";
import { createWorkspace } from "../workspace.js";

const MINIMAL_DOMAIN = `domain Counter {
  state {
    count: number = 0
  }
}`;

function bootBaseModule(source: string) {
  const result = compileMelModule(source, { mode: "module" });
  if (result.module === null) {
    throw new Error(
      `fixture domain failed to compile: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.module;
}

describe("createWorkspace", () => {
  it("starts with the provided base + empty stack", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    expect(ws.getCurrentSource()).toBe(MINIMAL_DOMAIN);
    expect(ws.getStatus()).toBe("clean");
    expect(ws.snapshot()).toMatchObject({
      stackDepth: 0,
      status: "clean",
      canCommit: false, // empty stack — nothing to commit
    });
  });

  it("apply: pushes a successful op and updates currentSource", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    const result = ws.apply({
      kind: "addStateField",
      name: "lastTouched",
      type: "number",
      defaultValue: 0,
    });
    expect(result.ok).toBe(true);
    expect(result.module).toBeDefined();
    expect(ws.getStatus()).toBe("clean");
    expect(ws.canCommit()).toBe(true);
    expect(ws.getCurrentSource()).toContain("lastTouched");
    expect(ws.getCurrentSource()).not.toBe(MINIMAL_DOMAIN);
    const snap = ws.snapshot();
    expect(snap.stackDepth).toBe(1);
    expect(snap.stack[0]).toMatchObject({
      kind: "addStateField",
      target: "lastTouched",
      resultStatus: "ok",
    });
  });

  it("popLast: restores previous source + module", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    ws.apply({
      kind: "addStateField",
      name: "lastTouched",
      type: "number",
      defaultValue: 0,
    });
    const popped = ws.popLast();
    expect(popped).toBe(true);
    expect(ws.getCurrentSource()).toBe(MINIMAL_DOMAIN);
    expect(ws.getStatus()).toBe("clean");
    expect(ws.snapshot().stackDepth).toBe(0);
    expect(ws.canCommit()).toBe(false);
  });

  it("popLast on empty stack returns false", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    expect(ws.popLast()).toBe(false);
  });

  it("apply: broken result still grows stack but flips status to broken", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    // body references an undeclared symbol — should fail to compile
    const result = ws.apply({
      kind: "addAction",
      name: "tickThenExplode",
      params: [],
      body: `{
        onceIntent {
          patch unknownField = unknownReference + 1
        }
      }`,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(ws.getStatus()).toBe("broken");
    expect(ws.canCommit()).toBe(false);
    expect(ws.snapshot().stackDepth).toBe(1);
    expect(ws.snapshot().stack[0]).toMatchObject({ resultStatus: "broken" });
  });

  it("popLast: undoes a broken op back to clean state", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    ws.apply({
      kind: "addAction",
      name: "tickThenExplode",
      params: [],
      body: `{
        onceIntent {
          patch unknownField = unknownReference + 1
        }
      }`,
    });
    expect(ws.getStatus()).toBe("broken");
    ws.popLast();
    expect(ws.getStatus()).toBe("clean");
    expect(ws.canCommit()).toBe(false); // empty stack
    expect(ws.getCurrentSource()).toBe(MINIMAL_DOMAIN);
  });

  it("toFinalDraft returns the proposed source when clean + non-empty", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    ws.apply({
      kind: "addStateField",
      name: "lastTouched",
      type: "number",
      defaultValue: 0,
    });
    const draft = ws.toFinalDraft({
      title: "Add lastTouched",
      rationale: "track recency",
    });
    expect(draft.proposedSource).toContain("lastTouched");
    expect(draft.title).toBe("Add lastTouched");
    expect(draft.rationale).toBe("track recency");
    expect(draft.stackDepth).toBe(1);
    expect(draft.schemaHash).toBeDefined();
  });

  it("toFinalDraft throws when not committable", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    expect(() => ws.toFinalDraft()).toThrow(/cannot commit/);
    ws.apply({
      kind: "addAction",
      name: "tickThenExplode",
      params: [],
      body: `{
        onceIntent {
          patch unknownField = unknownReference + 1
        }
      }`,
    });
    expect(() => ws.toFinalDraft()).toThrow(/cannot commit/);
  });

  it("collects unique changedTargets across the stack in toFinalDraft", () => {
    const baseModule = bootBaseModule(MINIMAL_DOMAIN);
    const ws = createWorkspace({ baseSource: MINIMAL_DOMAIN, baseModule });
    ws.apply({
      kind: "addStateField",
      name: "lastTouched",
      type: "number",
      defaultValue: 0,
    });
    ws.apply({
      kind: "addComputed",
      name: "doubled",
      expr: "count + count",
    });
    const draft = ws.toFinalDraft();
    // both targets should appear, in order
    expect(draft.changedTargets).toContain("state_field:lastTouched");
    expect(draft.changedTargets).toContain("computed:doubled");
  });
});
