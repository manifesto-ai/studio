import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "../create-studio-core.js";
import { createHeadlessAdapter } from "../../../studio-adapter-headless/src/headless-adapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packagesRoot = join(here, "..", "..", "..");

function readFixture(name: string): string {
  return readFileSync(
    join(
      packagesRoot,
      "studio-adapter-headless",
      "src",
      "__tests__",
      "fixtures",
      name,
    ),
    "utf8",
  );
}

async function buildCore(source: string) {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: source });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") {
    throw new Error("build failed");
  }
  return core;
}

describe("createStudioCore explanation seam", () => {
  it("exposes explainIntent and why for an admitted todo intent", async () => {
    const core = await buildCore(readFixture("todo.mel"));
    const intent = core.createIntent("addTodo", { title: "buy milk" });

    const explained = core.explainIntent(intent);
    const why = core.why(intent);
    const whyNot = core.whyNot(intent);

    expect(explained.kind).toBe("admitted");
    if (explained.kind !== "admitted") return;
    expect(why.kind).toBe("admitted");
    if (why.kind !== "admitted") return;
    expect(whyNot).toBeNull();
    expect(explained.available).toBe(true);
    expect(explained.dispatchable).toBe(true);
    expect(explained.changedPaths).toContain("data.todos[0]");
    expect(explained.changedPaths).toContain("computed.todoCount");
    expect(why.actionName).toBe(explained.actionName);
    expect(why.available).toBe(explained.available);
    expect(why.dispatchable).toBe(explained.dispatchable);
    expect(why.changedPaths).toEqual(explained.changedPaths);
    expect(why.newAvailableActions).toEqual(explained.newAvailableActions);
  });

  it("exposes blocked explanation and whyNot for an unavailable battleship intent", async () => {
    const core = await buildCore(readFixture("battleship.mel"));
    const intent = core.createIntent("shoot", { cellId: "cell-0-0" });

    const explained = core.explainIntent(intent);
    const why = core.why(intent);
    const whyNot = core.whyNot(intent);

    expect(explained.kind).toBe("blocked");
    if (explained.kind !== "blocked") return;
    expect(why.kind).toBe("blocked");
    if (why.kind !== "blocked") return;
    expect(whyNot).not.toBeNull();
    expect(whyNot?.length).toBeGreaterThan(0);
    expect(explained.available).toBe(false);
    expect(explained.dispatchable).toBe(false);
    expect(why.actionName).toBe(explained.actionName);
    expect(why.available).toBe(explained.available);
    expect(why.dispatchable).toBe(explained.dispatchable);
    expect(why.blockers).toEqual(explained.blockers);
  });
});
