import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import type { ReconciliationPlan } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

function canonicalPlan(plan: ReconciliationPlan) {
  return {
    prevSchemaHash: plan.prevSchemaHash,
    nextSchemaHash: plan.nextSchemaHash,
    identityMap: [...plan.identityMap.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    ),
    snapshotPlan: {
      preserved: [...plan.snapshotPlan.preserved].sort(),
      initialized: [...plan.snapshotPlan.initialized].sort(),
      discarded: [...plan.snapshotPlan.discarded].sort(),
      warned: plan.snapshotPlan.warned,
    },
    traceTag: {
      stillValid: [...plan.traceTag.stillValid].sort(),
      obsolete: [...plan.traceTag.obsolete].sort(),
      renamed: plan.traceTag.renamed,
    },
  };
}

async function runPipeline(v1: string, v2: string): Promise<ReconciliationPlan> {
  const adapter = createHeadlessAdapter({ initialSource: v1 });
  const core = createStudioCore();
  core.attach(adapter);

  const first = await core.build();
  if (first.kind !== "ok") throw new Error("v1 build failed");

  adapter.setSource(v2);
  const second = await core.build();
  if (second.kind !== "ok") throw new Error("v2 build failed");
  return second.plan;
}

describe("INV-SE-2 — determinism", () => {
  it("same source + same prev module = same plan", async () => {
    const v1 = loadFixture("todo.mel");
    const v2 = v1.replace(
      "computed activeCount = sub(todoCount, completedCount)",
      "computed activeCount = sub(len(todos), completedCount)",
    );

    const [plan1, plan2] = await Promise.all([
      runPipeline(v1, v2),
      runPipeline(v1, v2),
    ]);

    expect(JSON.stringify(canonicalPlan(plan1))).toBe(
      JSON.stringify(canonicalPlan(plan2)),
    );
  });

  it("first-build plan is also deterministic", async () => {
    const v1 = loadFixture("todo.mel");

    async function firstPlan() {
      const adapter = createHeadlessAdapter({ initialSource: v1 });
      const core = createStudioCore();
      core.attach(adapter);
      const r = await core.build();
      if (r.kind !== "ok") throw new Error("build failed");
      return r.plan;
    }

    const [a, b] = await Promise.all([firstPlan(), firstPlan()]);
    expect(JSON.stringify(canonicalPlan(a))).toBe(
      JSON.stringify(canonicalPlan(b)),
    );
  });
});
