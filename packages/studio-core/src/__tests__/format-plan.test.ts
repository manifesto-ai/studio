import { describe, expect, it } from "vitest";
import { compileMelModule, type DomainModule } from "@manifesto-ai/compiler";
import { computePlan } from "../internal/reconciler.js";
import { formatPlan } from "../internal/format-plan.js";

function compile(source: string): DomainModule {
  const result = compileMelModule(source, { mode: "module" });
  if (result.module === null) throw new Error("compile failed");
  return result.module;
}

const V1 = `
domain D {
  state {
    a: number = 0
    b: string = ""
  }
  computed aa = mul(a, 2)
  action inc() { onceIntent { patch a = add(a, 1) } }
}
`.trim();

const V2 = `
domain D {
  state {
    a: number = 0
    c: boolean = false
  }
  computed aa = add(a, a)
  action inc() { onceIntent { patch a = add(a, 1) } }
}
`.trim();

describe("formatPlan", () => {
  it("renders initial build as all-new", () => {
    const next = compile(V1);
    const text = formatPlan(computePlan(null, next));
    expect(text).toContain("∅ →");
    expect(text).toContain("state_field:a");
    expect(text).toContain("initialized (new)");
    expect(text).toContain("computed:aa");
  });

  it("renders rebuild showing preserved / initialized / discarded", () => {
    const prev = compile(V1);
    const next = compile(V2);
    const text = formatPlan(computePlan(prev, next));

    expect(text).toMatch(/identity entries: \d+/);
    expect(text).toContain("preserved");
    expect(text).toContain("initialized");
    expect(text).toContain("discarded");
    expect(text).toContain("state_field:b");
    expect(text).toContain("state_field:c");
  });

  it("truncates when buckets exceed maxPerBucket", () => {
    const prev = compile(V1);
    const next = compile(V1);
    const text = formatPlan(computePlan(prev, next), { maxPerBucket: 2 });
    expect(text).toMatch(/\+\d+ more/);
  });

  it("sorts identity breakdown lexicographically", () => {
    const next = compile(V1);
    const text = formatPlan(computePlan(null, next));

    const lines = text.split("\n");
    const breakdownStart = lines.indexOf("  identity breakdown:");
    const after = lines.slice(breakdownStart + 1);
    const breakdown: string[] = [];
    for (const line of after) {
      const m = line.match(/(action:|computed:|state_field:)[^\s]+/);
      if (m === null) break;
      breakdown.push(m[0]);
    }
    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown).toEqual([...breakdown].sort());
  });
});
