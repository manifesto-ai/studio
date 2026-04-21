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

describe("createStudioCore simulate diagnostics", () => {
  it("preserves simulate trace diagnostics from the SDK runtime", async () => {
    const core = await buildCore(readFixture("todo.mel"));
    const intent = core.createIntent("addTodo", { title: "buy milk" });

    const simulated = core.simulate(intent);

    expect(simulated.diagnostics?.trace).toBeDefined();
    expect(simulated.diagnostics?.trace.root.sourcePath).toBe("actions.addTodo.flow");
    expect(simulated.diagnostics?.trace.terminatedBy).toBe("complete");
  });
});
