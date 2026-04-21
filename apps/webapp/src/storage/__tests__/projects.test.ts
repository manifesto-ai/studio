/**
 * Storage layer coverage — the IndexedDB path backing every project
 * CRUD + bundle import/export. Uses `fake-indexeddb` so the tests run
 * in jsdom without a real browser database.
 *
 * Each test spins a fresh DB via `indexedDB = new IDBFactory()` so
 * writes from other tests don't bleed through. The module caches its
 * `openDB(...)` promise in a module-scoped variable, so we import
 * lazily inside `beforeEach` after the factory is swapped in.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function freshStorage() {
  // Reset the global factory so each test gets a clean DB, then bust
  // the module cache so the storage module's memoized `dbPromise`
  // resets and reopens against the fresh factory.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  vi.resetModules();
  return (await import("../projects")) as typeof import("../projects");
}

describe("project storage — CRUD", () => {
  let storage: Awaited<ReturnType<typeof freshStorage>>;
  beforeEach(async () => {
    storage = await freshStorage();
  });

  it("starts empty and creates/reads/updates/deletes a project", async () => {
    expect(await storage.listProjects()).toEqual([]);

    const created = await storage.createProject({
      name: "Hello",
      source: "domain Hello {}",
    });
    expect(created.id).toMatch(/./);
    expect(created.createdAt).toBe(created.updatedAt);
    expect(created.origin).toEqual({ kind: "blank" });

    const list = await storage.listProjects();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    await storage.updateProjectSource(created.id, "domain Hello { state { n: number = 1 } }");
    const after = await storage.getProject(created.id);
    expect(after?.source).toContain("state");
    expect(after?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    await storage.renameProject(created.id, "  Renamed  ");
    const renamed = await storage.getProject(created.id);
    expect(renamed?.name).toBe("Renamed"); // trimmed

    await storage.deleteProject(created.id);
    expect(await storage.getProject(created.id)).toBeNull();
    expect(await storage.listProjects()).toEqual([]);
  });

  it("listProjects sorts by lastOpenedAt descending", async () => {
    const a = await storage.createProject({ name: "A", source: "// a" });
    await new Promise((r) => setTimeout(r, 2));
    const b = await storage.createProject({ name: "B", source: "// b" });
    await new Promise((r) => setTimeout(r, 2));
    await storage.touchProject(a.id); // A becomes most recent

    const list = await storage.listProjects();
    expect(list[0].id).toBe(a.id);
    expect(list[1].id).toBe(b.id);
  });

  it("updateProjectSource is a no-op when content is unchanged", async () => {
    const p = await storage.createProject({ name: "P", source: "x" });
    const beforeUpdatedAt = p.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await storage.updateProjectSource(p.id, "x");
    const after = await storage.getProject(p.id);
    expect(after?.updatedAt).toBe(beforeUpdatedAt);
  });

  it("deleteProject clears lastActiveProjectId if that was the active one", async () => {
    const p = await storage.createProject({ name: "P", source: "x" });
    await storage.setLastActiveProjectId(p.id);
    expect(await storage.getLastActiveProjectId()).toBe(p.id);
    await storage.deleteProject(p.id);
    expect(await storage.getLastActiveProjectId()).toBeNull();
  });
});

describe("project storage — bundle import/export", () => {
  let storage: Awaited<ReturnType<typeof freshStorage>>;
  beforeEach(async () => {
    storage = await freshStorage();
  });

  it("exports the current projects and re-imports them into fresh ids", async () => {
    await storage.createProject({ name: "One", source: "// 1" });
    await storage.createProject({ name: "Two", source: "// 2" });
    const all = await storage.listProjects();
    const json = storage.serializeBundle(all);

    // Wipe and import.
    const fresh = await freshStorage();
    expect(await fresh.listProjects()).toEqual([]);
    const { imported, errors } = await fresh.importBundle(json);
    expect(errors).toEqual([]);
    expect(imported.length).toBe(2);
    for (const rec of imported) {
      expect(rec.origin.kind).toBe("imported");
    }
    // Freshly minted ids — not the originals.
    const originalIds = new Set(all.map((p) => p.id));
    for (const rec of imported) {
      expect(originalIds.has(rec.id)).toBe(false);
    }
  });

  it("rejects non-bundle JSON with a clear error", async () => {
    const { imported, errors } = await storage.importBundle(
      JSON.stringify({ some: "other shape" }),
    );
    expect(imported).toEqual([]);
    expect(errors[0]).toMatch(/Manifesto Studio bundle/);
  });

  it("rejects malformed JSON entirely", async () => {
    const { imported, errors } = await storage.importBundle("not json");
    expect(imported).toEqual([]);
    expect(errors[0]).toMatch(/valid JSON/i);
  });

  it("skips individual malformed entries but keeps the good ones", async () => {
    const bundle = {
      format: "manifesto-studio-bundle",
      version: 1,
      exportedAt: Date.now(),
      projects: [
        { name: "Good", source: "// ok" },
        { name: 123, source: "// bad name type" },
        { broken: true },
      ],
    };
    const { imported, errors } = await storage.importBundle(
      JSON.stringify(bundle),
    );
    expect(imported.length).toBe(1);
    expect(imported[0].name).toBe("Good");
    expect(errors.length).toBe(2);
  });
});
