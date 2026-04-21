import { describe, expect, it, afterEach } from "vitest";
import { compileMelModule, type DomainModule } from "@manifesto-ai/compiler";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryEditHistoryStore } from "../internal/in-memory-edit-history-store.js";
import { createSqliteEditHistoryStore } from "../internal/sqlite-edit-history-store.js";
import { buildEnvelope } from "../internal/envelope-codec.js";
import { computePlan } from "../internal/reconciler.js";
import type { EditHistoryStore } from "../types/edit-history-store.js";
import type { EditIntentEnvelope } from "../types/edit-intent.js";

function compile(source: string): DomainModule {
  const result = compileMelModule(source, { mode: "module" });
  if (result.module === null) throw new Error("compile failed");
  return result.module;
}

const SRC = `
domain D {
  state { a: number = 0 }
  action inc() { onceIntent { patch a = add(a, 1) } }
}
`.trim();

function makeEnvelope(
  next: DomainModule,
  overrides?: Partial<EditIntentEnvelope>,
): EditIntentEnvelope {
  const plan = computePlan(null, next);
  const base = buildEnvelope({
    payload: { kind: "rebuild", source: SRC },
    plan,
    author: "human",
    ...(overrides?.correlationId !== undefined
      ? { correlationId: overrides.correlationId }
      : {}),
  });
  return { ...base, ...overrides };
}

function describeStore(
  label: string,
  factory: () => { store: EditHistoryStore; teardown: () => Promise<void> },
) {
  describe(label, () => {
    let store: EditHistoryStore;
    let teardown: () => Promise<void>;

    afterEach(async () => {
      if (teardown !== undefined) await teardown();
    });

    it("lists ordered by (timestamp ASC, id ASC)", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      // Out-of-order insertion; also two entries at the same timestamp
      // to exercise the id tiebreaker.
      const e1 = makeEnvelope(next, { id: "e1", timestamp: 100 });
      const e2 = makeEnvelope(next, { id: "e2", timestamp: 200 });
      const e3 = makeEnvelope(next, { id: "e3", timestamp: 150 });
      const e4 = makeEnvelope(next, { id: "aardvark", timestamp: 100 });

      await store.append(e2);
      await store.append(e4);
      await store.append(e3);
      await store.append(e1);

      const list = await store.list();
      const ids = list.map((e) => e.id);
      expect(ids).toEqual(["aardvark", "e1", "e3", "e2"]);
    });

    it("rejects duplicate ids (SE-HIST-2 append-only)", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      const env = makeEnvelope(next, { id: "dupe" });
      await store.append(env);
      await expect(store.append(env)).rejects.toThrow(/duplicate/i);
    });

    it("getById returns exact envelope or null", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      const env = makeEnvelope(next, { id: "specific" });
      await store.append(env);

      const found = await store.getById("specific");
      expect(found?.id).toBe("specific");
      expect(await store.getById("missing")).toBeNull();
    });

    it("getByCorrelation groups by correlationId", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      const e1 = makeEnvelope(next, { id: "a", correlationId: "corr-x" });
      const e2 = makeEnvelope(next, { id: "b", correlationId: "corr-x" });
      const e3 = makeEnvelope(next, { id: "c", correlationId: "corr-y" });

      await store.append(e1);
      await store.append(e2);
      await store.append(e3);

      const x = await store.getByCorrelation("corr-x");
      expect(x.map((e) => e.id).sort()).toEqual(["a", "b"]);
      expect(await store.getByCorrelation("corr-x")).toHaveLength(2);
    });

    it("list query filters by payloadKind and nextSchemaHash", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      const env = makeEnvelope(next, { id: "kept" });
      await store.append(env);

      const hit = await store.list({ nextSchemaHash: env.nextSchemaHash });
      expect(hit).toHaveLength(1);
      const miss = await store.list({ nextSchemaHash: "nope" });
      expect(miss).toHaveLength(0);

      const kindHit = await store.list({ payloadKind: "rebuild" });
      expect(kindHit).toHaveLength(1);
    });

    it("clear empties the store", async () => {
      ({ store, teardown } = factory());
      const next = compile(SRC);
      await store.append(makeEnvelope(next, { id: "x" }));
      expect(await store.list()).toHaveLength(1);
      await store.clear();
      expect(await store.list()).toHaveLength(0);
    });
  });
}

describeStore("InMemoryEditHistoryStore", () => ({
  store: createInMemoryEditHistoryStore(),
  teardown: async () => {},
}));

describeStore("SqliteEditHistoryStore (in-memory db)", () => {
  const store = createSqliteEditHistoryStore({ path: ":memory:" });
  return {
    store,
    teardown: async () => {
      await store.close?.();
    },
  };
});

describe("SqliteEditHistoryStore — file-backed persistence", () => {
  it("round-trips across open/close", async () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-sqlite-"));
    const path = join(dir, ".studio", "edit-history.db");
    try {
      const next = compile(SRC);
      const env = makeEnvelope(next, { id: "persist-me" });

      const first = createSqliteEditHistoryStore({ path });
      await first.append(env);
      await first.close?.();

      const second = createSqliteEditHistoryStore({ path });
      const found = await second.getById("persist-me");
      expect(found?.id).toBe("persist-me");
      await second.close?.();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
