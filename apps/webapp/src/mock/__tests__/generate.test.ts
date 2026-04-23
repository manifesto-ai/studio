/**
 * Mock generator — unit tests.
 *
 * Determinism is the headline property: given a seed and a fixed
 * "now" clock, the same schema always produces the same samples.
 * These tests pin that behaviour so regressions in the walker show
 * up as diffs, not flakes.
 */
import { describe, expect, it } from "vitest";
import {
  createRng,
  generateForAction,
  generateValue,
  type MockTypeDefinition,
} from "../generate.js";
import type { DomainModule } from "@manifesto-ai/studio-core";

// Fixed point in time so clock-bag tests can be exact.
const NOW = new Date("2026-04-24T01:23:45.000Z");

function makeModule(
  actions: Record<
    string,
    { readonly inputType?: MockTypeDefinition; readonly params?: readonly string[] }
  >,
  types: Record<string, { readonly name: string; readonly definition: MockTypeDefinition }> = {},
): DomainModule {
  return {
    schema: {
      actions,
      types,
    },
  } as unknown as DomainModule;
}

describe("createRng", () => {
  it("yields a deterministic stream for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("diverges across different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toEqual(b());
  });
});

describe("generateValue — primitives + literals", () => {
  const ctx = { types: {}, rng: createRng(1), clock: buildFixedClock() };
  it("returns a string for primitive string", () => {
    const v = generateValue({ kind: "primitive", type: "string" }, ctx);
    expect(typeof v).toBe("string");
  });
  it("returns a number for primitive number", () => {
    const v = generateValue({ kind: "primitive", type: "number" }, ctx);
    expect(typeof v).toBe("number");
  });
  it("returns a boolean for primitive boolean", () => {
    const v = generateValue({ kind: "primitive", type: "boolean" }, ctx);
    expect(typeof v).toBe("boolean");
  });
  it("returns the literal value unchanged", () => {
    const v = generateValue({ kind: "literal", value: "todo" }, ctx);
    expect(v).toBe("todo");
  });
});

describe("generateValue — compound", () => {
  it("walks refs to named types", () => {
    const types = {
      TaskStatus: {
        name: "TaskStatus",
        definition: {
          kind: "union",
          types: [
            { kind: "literal", value: "todo" },
            { kind: "literal", value: "done" },
          ],
        } as MockTypeDefinition,
      },
    };
    const ctx = { types, rng: createRng(7), clock: buildFixedClock() };
    const v = generateValue({ kind: "ref", name: "TaskStatus" }, ctx);
    expect(["todo", "done"]).toContain(v);
  });

  it("respects object field shapes and optional flags", () => {
    const type: MockTypeDefinition = {
      kind: "object",
      fields: {
        id: {
          type: { kind: "primitive", type: "string" },
          optional: false,
        },
        note: {
          type: { kind: "primitive", type: "string" },
          optional: true,
        },
      },
    };
    // Required fields must always be present.
    for (let i = 0; i < 20; i++) {
      const v = generateValue(type, {
        types: {},
        rng: createRng(i),
        clock: buildFixedClock(),
      }) as Record<string, unknown>;
      expect(v.id).toBeDefined();
    }
  });

  it("biases unions away from null when a non-null variant exists", () => {
    const type: MockTypeDefinition = {
      kind: "union",
      types: [
        { kind: "literal", value: null },
        { kind: "primitive", type: "string" },
      ],
    };
    // Over N samples, >50% should be non-null.
    let nonNull = 0;
    for (let i = 0; i < 100; i++) {
      const v = generateValue(type, {
        types: {},
        rng: createRng(i * 13 + 1),
        clock: buildFixedClock(),
      });
      if (v !== null) nonNull++;
    }
    expect(nonNull).toBeGreaterThan(50);
  });
});

describe("field-name heuristics", () => {
  it("produces an ISO-like string for fields named *At / *Date", () => {
    const ctx = { types: {}, rng: createRng(3), clock: buildFixedClock() };
    const v = generateValue(
      { kind: "primitive", type: "string" },
      ctx,
      "createdAt",
    ) as string;
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("produces epoch millis for fields named *Ts / *Timestamp", () => {
    const ctx = { types: {}, rng: createRng(3), clock: buildFixedClock() };
    const v = generateValue(
      { kind: "primitive", type: "number" },
      ctx,
      "dueDateTimestamp",
    ) as number;
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(1_700_000_000_000);
  });

  it("produces a mock- prefixed id for fields named id", () => {
    const ctx = { types: {}, rng: createRng(3), clock: buildFixedClock() };
    const v = generateValue(
      { kind: "primitive", type: "string" },
      ctx,
      "id",
    ) as string;
    expect(v).toMatch(/^mock-/);
  });
});

describe("generateForAction", () => {
  it("unwraps an object-typed inputType into positional args", () => {
    const mod = makeModule({
      createTask: {
        params: ["task", "stamp"],
        inputType: {
          kind: "object",
          fields: {
            task: {
              type: {
                kind: "object",
                fields: {
                  id: {
                    type: { kind: "primitive", type: "string" },
                    optional: false,
                  },
                  title: {
                    type: { kind: "primitive", type: "string" },
                    optional: false,
                  },
                },
              },
              optional: false,
            },
            stamp: {
              type: {
                kind: "object",
                fields: {
                  now: {
                    type: { kind: "primitive", type: "string" },
                    optional: false,
                  },
                },
              },
              optional: false,
            },
          },
        },
      },
    });
    const result = generateForAction(mod, "createTask", {
      count: 3,
      seed: 42,
      now: NOW,
    });
    expect(result.action).toBe("createTask");
    expect(result.paramNames).toEqual(["task", "stamp"]);
    expect(result.samples).toHaveLength(3);
    for (const args of result.samples) {
      expect(args).toHaveLength(2);
      const [task, stamp] = args as [
        { id: string; title: string },
        { now: string },
      ];
      expect(task.id).toMatch(/^mock-/);
      expect(typeof task.title).toBe("string");
      expect(stamp.now).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("is deterministic under the same seed + now", () => {
    const mod = makeModule({
      setFilter: {
        params: ["newFilter"],
        inputType: {
          kind: "union",
          types: [
            { kind: "literal", value: "all" },
            { kind: "literal", value: "active" },
            { kind: "literal", value: "completed" },
          ],
        },
      },
    });
    const a = generateForAction(mod, "setFilter", { count: 5, seed: 123, now: NOW });
    const b = generateForAction(mod, "setFilter", { count: 5, seed: 123, now: NOW });
    expect(a.samples).toEqual(b.samples);
  });

  it("returns empty arg arrays for zero-param actions", () => {
    const mod = makeModule({
      clearCompleted: { params: [], inputType: undefined },
    });
    const result = generateForAction(mod, "clearCompleted", {
      count: 2,
      seed: 1,
    });
    expect(result.samples).toEqual([[], []]);
  });

  it("throws on an unknown action", () => {
    const mod = makeModule({});
    expect(() =>
      generateForAction(mod, "bogus", { count: 1 }),
    ).toThrow(/unknown action/);
  });

  it("clamps count to [1, 100]", () => {
    const mod = makeModule({
      setFilter: {
        params: ["newFilter"],
        inputType: { kind: "primitive", type: "string" },
      },
    });
    expect(generateForAction(mod, "setFilter", { count: 0 }).samples).toHaveLength(1);
    expect(generateForAction(mod, "setFilter", { count: 9999 }).samples).toHaveLength(100);
  });
});

/**
 * Smoke test covering the end-to-end "seedMock behavior" without
 * involving the agent: generate N samples → dispatch all → verify
 * the runtime's snapshot reflects exactly that many tasks. If this
 * ever breaks, the UI's inspectSnapshot wasn't lying — the whole
 * chain is out of sync and that's a much bigger bug.
 */
describe("end-to-end: generate + dispatch + snapshot stays consistent", () => {
  // Inline fixture so this test doesn't depend on workspace fixtures
  // on disk — keeps the expectation local and verifiable.
  const inlineTaskFlow = `
    domain InlineTaskFlow {
      type Task = {
        id: string,
        title: string,
        done: boolean
      }
      state {
        tasks: Array<Task> = []
      }
      computed taskCount = len(tasks)
      action createTask(task: Task) {
        onceIntent {
          patch tasks = append(tasks, task)
        }
      }
    }
  `;

  it("dispatching N mock createTask intents yields tasks.length === N", async () => {
    const { createStudioCore } = await import("@manifesto-ai/studio-core");
    const { createHeadlessAdapter } = await import(
      "@manifesto-ai/studio-adapter-headless"
    );
    const core = createStudioCore();
    const adapter = createHeadlessAdapter({ initialSource: inlineTaskFlow });
    core.attach(adapter);
    const build = await core.build();
    if (build.kind !== "ok") {
      throw new Error(
        `inline TaskFlow build failed: ${JSON.stringify(build.errors)}`,
      );
    }

    const mod = core.getModule();
    if (mod === null) throw new Error("no module");

    const N = 10;
    const result = generateForAction(mod, "createTask", {
      count: N,
      seed: 42,
      now: NOW,
    });
    expect(result.samples).toHaveLength(N);

    let completed = 0;
    for (const args of result.samples) {
      const intent = core.createIntent("createTask", ...args);
      const report = await core.dispatchAsync(intent);
      if (report.kind === "completed") completed++;
    }
    expect(completed).toBe(N);

    // The real inspectSnapshot uses exactly this read path — if it
    // ever returns stale data the bug shows up here first.
    const snap = core.getSnapshot() as {
      readonly data?: { readonly tasks?: readonly unknown[] };
      readonly computed?: { readonly taskCount?: number };
    };
    expect(snap.data?.tasks?.length).toBe(N);
    expect(snap.computed?.taskCount).toBe(N);
  });
});

// --------------------------------------------------------------------
// Test helpers
// --------------------------------------------------------------------

function buildFixedClock() {
  return {
    nowIso: NOW.toISOString(),
    nowTs: NOW.getTime(),
    todayStartIso: NOW.toISOString(),
    todayStartTs: NOW.getTime(),
    todayEndIso: NOW.toISOString(),
    todayEndTs: NOW.getTime(),
    weekStartIso: NOW.toISOString(),
    weekStartTs: NOW.getTime(),
    weekEndIso: NOW.toISOString(),
    weekEndTs: NOW.getTime(),
    monthStartIso: NOW.toISOString(),
    monthStartTs: NOW.getTime(),
    monthEndIso: NOW.toISOString(),
    monthEndTs: NOW.getTime(),
  };
}
