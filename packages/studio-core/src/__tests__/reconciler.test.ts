import { describe, expect, it } from "vitest";
import { compileMelModule, type DomainModule } from "@manifesto-ai/compiler";
import { computePlan, tagTraces } from "../internal/reconciler.js";
import type { TraceId, TraceRecord } from "../types/trace.js";

function compile(source: string): DomainModule {
  const result = compileMelModule(source, { mode: "module" });
  if (result.module === null) {
    throw new Error(
      `compile failed: ${result.errors.map((e) => e.message).join(" | ")}`,
    );
  }
  return result.module;
}

const BASE = `
domain D {
  state {
    a: number = 0
    b: string = ""
  }
  computed doubleA = mul(a, 2)
  action incA() { onceIntent { patch a = add(a, 1) } }
  action setB(v: string) { onceIntent { patch b = v } }
}
`.trim();

function synthTrace(intentType: string, schemaHash: string, id: string): TraceRecord {
  return {
    id: id as TraceId,
    intentId: `i-${id}`,
    schemaHash,
    recordedAt: 0,
    raw: {
      intent: { type: intentType, input: undefined },
      root: { id: "r", kind: "flow", sourcePath: "/", inputs: {}, output: null, children: [], timestamp: 0 },
      nodes: {},
      baseVersion: 0,
      resultVersion: 1,
      duration: 0,
      terminatedBy: "complete",
    },
  };
}

describe("computePlan — identity classification (SE-RECON-1,2,3,4)", () => {
  it("initial build: every next key is initialized { new }", () => {
    const next = compile(BASE);
    const plan = computePlan(null, next);

    expect(plan.prevSchemaHash).toBeNull();
    expect(plan.nextSchemaHash).toBe(next.schema.hash);
    expect(plan.identityMap.size).toBe(5);
    for (const fate of plan.identityMap.values()) {
      expect(fate).toEqual({ kind: "initialized", reason: "new" });
    }
    expect([...plan.snapshotPlan.initialized].sort()).toEqual([
      "state_field:a",
      "state_field:b",
    ]);
    expect(plan.snapshotPlan.preserved).toEqual([]);
    expect(plan.snapshotPlan.discarded).toEqual([]);
  });

  it("identical schema: all keys preserved", () => {
    const prev = compile(BASE);
    const next = compile(BASE);
    const plan = computePlan(prev, next);

    for (const fate of plan.identityMap.values()) {
      expect(fate.kind).toBe("preserved");
    }
    expect([...plan.snapshotPlan.preserved].sort()).toEqual([
      "state_field:a",
      "state_field:b",
    ]);
    expect(plan.snapshotPlan.initialized).toEqual([]);
    expect(plan.snapshotPlan.discarded).toEqual([]);
  });

  it("new state field: initialized { new }", () => {
    const prev = compile(BASE);
    const next = compile(
      BASE.replace(
        'b: string = ""',
        'b: string = ""\n    c: boolean = false',
      ),
    );
    const plan = computePlan(prev, next);

    expect(plan.identityMap.get("state_field:c")).toEqual({
      kind: "initialized",
      reason: "new",
    });
    expect(plan.snapshotPlan.initialized).toContain("state_field:c");
    expect(plan.snapshotPlan.preserved).toContain("state_field:a");
    expect(plan.snapshotPlan.preserved).toContain("state_field:b");
  });

  it("removed state field: discarded { removed }", () => {
    const prev = compile(BASE);
    const next = compile(
      BASE
        .replace('b: string = ""', "")
        .replace("action setB(v: string) { onceIntent { patch b = v } }", ""),
    );
    const plan = computePlan(prev, next);

    expect(plan.identityMap.get("state_field:b")).toEqual({
      kind: "discarded",
      reason: "removed",
    });
    expect(plan.snapshotPlan.discarded).toContain("state_field:b");
    expect(plan.snapshotPlan.preserved).toContain("state_field:a");
  });

  it("changed type: discarded { type_incompatible } (conservative Phase 0)", () => {
    const prev = compile(BASE);
    const next = compile(`
domain D {
  state {
    a: number = 0
    b: number = 0
  }
  computed doubleA = mul(a, 2)
  action incA() { onceIntent { patch a = add(a, 1) } }
}
`.trim());

    const plan = computePlan(prev, next);

    expect(plan.identityMap.get("state_field:b")).toEqual({
      kind: "discarded",
      reason: "type_incompatible",
    });
    expect(plan.snapshotPlan.discarded).toContain("state_field:b");
  });

  it("removed action: discarded { removed } (no type check for actions)", () => {
    const prev = compile(BASE);
    const next = compile(
      BASE.replace(
        "action setB(v: string) { onceIntent { patch b = v } }",
        "",
      ),
    );
    const plan = computePlan(prev, next);

    expect(plan.identityMap.get("action:setB")).toEqual({
      kind: "discarded",
      reason: "removed",
    });
  });

  it("computed body change keeps identity preserved", () => {
    const prev = compile(BASE);
    const next = compile(BASE.replace("mul(a, 2)", "add(a, a)"));
    const plan = computePlan(prev, next);

    // computed signature is null → presence-only, so preserved
    expect(plan.identityMap.get("computed:doubleA")).toEqual({
      kind: "preserved",
    });
  });
});

describe("computePlan — determinism (INV-SE-2)", () => {
  it("same source + same prev = same plan", () => {
    const prev = compile(BASE);
    const nextSrc = BASE.replace("mul(a, 2)", "add(a, 1)");
    const next1 = compile(nextSrc);
    const next2 = compile(nextSrc);

    const p1 = computePlan(prev, next1);
    const p2 = computePlan(prev, next2);

    const serialize = (m: ReadonlyMap<unknown, unknown>) =>
      JSON.stringify([...m.entries()].sort());
    expect(serialize(p1.identityMap)).toBe(serialize(p2.identityMap));
    expect(p1.nextSchemaHash).toBe(p2.nextSchemaHash);
    expect(p1.snapshotPlan).toEqual(p2.snapshotPlan);
  });
});

describe("tagTraces — SC-4 obsolete tagging", () => {
  it("classifies traces by whether their action still exists in next", () => {
    const prev = compile(BASE);
    const next = compile(
      BASE.replace(
        "action setB(v: string) { onceIntent { patch b = v } }",
        "",
      ),
    );

    const traces: TraceRecord[] = [
      synthTrace("incA", prev.schema.hash, "t1"),
      synthTrace("setB", prev.schema.hash, "t2"),
      synthTrace("setB", prev.schema.hash, "t3"),
    ];

    const tag = tagTraces(traces, next);
    expect(tag.stillValid).toEqual(["t1"]);
    expect([...tag.obsolete].sort()).toEqual(["t2", "t3"]);
    expect(tag.renamed).toEqual([]);
  });

  it("empty records yields empty tagging", () => {
    const next = compile(BASE);
    const tag = tagTraces([], next);
    expect(tag).toEqual({ stillValid: [], obsolete: [], renamed: [] });
  });
});
