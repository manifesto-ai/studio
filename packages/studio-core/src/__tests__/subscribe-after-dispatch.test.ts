/**
 * `subscribeAfterDispatch` — the cross-cutting seam every observer
 * (React provider, agent tools, mock seeders, future runtimes) uses
 * to notice that the runtime just mutated, regardless of who did it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "../create-studio-core.js";
import { createHeadlessAdapter } from "../../../studio-adapter-headless/src/headless-adapter.ts";
import type { StudioDispatchResult } from "../types/dispatch-result.js";
import type { Intent } from "@manifesto-ai/sdk";

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

async function buildCore() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: readFixture("todo.mel") });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") throw new Error("build failed");
  return core;
}

describe("subscribeAfterDispatch", () => {
  it("fires the listener after every dispatchAsync, with the result", async () => {
    const core = await buildCore();
    const calls: { kind: string; intentType: string }[] = [];
    const detach = core.subscribeAfterDispatch((result, intent) => {
      calls.push({ kind: result.kind, intentType: intent.type });
    });

    const intent = core.createIntent("addTodo", { title: "milk" });
    await core.dispatchAsync(intent);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ kind: "completed", intentType: "addTodo" });

    detach();
    await core.dispatchAsync(core.createIntent("addTodo", { title: "eggs" }));
    // detach stopped the listener from receiving further events.
    expect(calls).toHaveLength(1);
  });

  it("notifies all listeners in insertion order", async () => {
    const core = await buildCore();
    const log: string[] = [];
    core.subscribeAfterDispatch(() => log.push("A"));
    core.subscribeAfterDispatch(() => log.push("B"));
    core.subscribeAfterDispatch(() => log.push("C"));
    await core.dispatchAsync(core.createIntent("addTodo", { title: "x" }));
    expect(log).toEqual(["A", "B", "C"]);
  });

  it("fires for every outcome (completed plus any future rejected/failed)", async () => {
    // The todo.mel fixture has no legality guards, so every dispatch
    // here lands as `completed`. We still exercise multiple successive
    // dispatches to prove the listener keeps firing.
    const core = await buildCore();
    const kinds: string[] = [];
    core.subscribeAfterDispatch((result) => {
      kinds.push(result.kind);
    });
    await core.dispatchAsync(core.createIntent("addTodo", { title: "a" }));
    await core.dispatchAsync(core.createIntent("addTodo", { title: "b" }));
    await core.dispatchAsync(core.createIntent("setFilter", { newFilter: "active" }));
    expect(kinds).toHaveLength(3);
    expect(kinds.every((k) => k === "completed")).toBe(true);
  });

  it("swallows listener exceptions so one bad subscriber can't poison the chain", async () => {
    const core = await buildCore();
    const ordered: string[] = [];
    core.subscribeAfterDispatch(() => ordered.push("pre"));
    core.subscribeAfterDispatch(() => {
      throw new Error("boom");
    });
    core.subscribeAfterDispatch(() => ordered.push("post"));

    await expect(
      core.dispatchAsync(core.createIntent("addTodo", { title: "x" })),
    ).resolves.toMatchObject({ kind: "completed" });

    // Both surviving listeners ran.
    expect(ordered).toEqual(["pre", "post"]);
  });

  it("passes the intent alongside the result", async () => {
    const core = await buildCore();
    let captured: Intent | null = null;
    core.subscribeAfterDispatch((_result, intent) => {
      captured = intent;
    });
    const intent = core.createIntent("addTodo", { title: "deadline" });
    await core.dispatchAsync(intent);
    expect(captured).not.toBeNull();
    expect(captured!.type).toBe("addTodo");
  });
});
