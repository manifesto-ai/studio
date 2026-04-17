import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

describe("SE-BUILD rules", () => {
  it("SE-BUILD-2 — setSource alone must NOT trigger a build", async () => {
    const adapter = createHeadlessAdapter({ initialSource: "" });
    const core = createStudioCore();
    core.attach(adapter);

    adapter.setSource(loadFixture("todo.mel"));
    // No requestBuild(); yield to microtasks then assert.
    await Promise.resolve();
    expect(core.getModule()).toBeNull();
    expect(core.getSnapshot()).toBeNull();
  });

  it("SE-BUILD-4 — failing build preserves previous module and runtime", async () => {
    const adapter = createHeadlessAdapter({
      initialSource: loadFixture("todo.mel"),
    });
    const core = createStudioCore();
    core.attach(adapter);

    const first = await core.build();
    expect(first.kind).toBe("ok");
    const prevModule = core.getModule();
    const prevSnapshot = core.getSnapshot();
    expect(prevModule).not.toBeNull();
    expect(prevSnapshot).not.toBeNull();

    adapter.setSource("this is not valid MEL!!!");
    const second = await core.build();
    expect(second.kind).toBe("fail");
    if (second.kind === "fail") {
      expect(second.errors.length).toBeGreaterThan(0);
    }

    // SE-BUILD-4: prior module reference is kept (identity equality).
    expect(core.getModule()).toBe(prevModule);
    // Runtime also retained — snapshot is still readable.
    expect(core.getSnapshot()).not.toBeNull();
  });

  it("SE-BUILD-5 — successful build attaches a ReconciliationPlan", async () => {
    const adapter = createHeadlessAdapter({
      initialSource: loadFixture("todo.mel"),
    });
    const core = createStudioCore();
    core.attach(adapter);

    const result = await core.build();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.plan.nextSchemaHash).toBe(result.schemaHash);
    expect(result.plan.prevSchemaHash).toBeNull();
    expect(core.getLastReconciliationPlan()).toBe(result.plan);
  });

  it("adapter.requestBuild is wired through attach → build path", async () => {
    const adapter = createHeadlessAdapter({
      initialSource: loadFixture("todo.mel"),
    });
    const core = createStudioCore();
    core.attach(adapter);

    adapter.requestBuild();
    // Build runs asynchronously via listener; await next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(core.getModule()).not.toBeNull();
  });
});
