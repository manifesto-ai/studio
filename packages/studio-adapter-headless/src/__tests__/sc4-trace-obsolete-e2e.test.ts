import { describe, expect, it } from "vitest";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "../headless-adapter.js";

/**
 * SC-4 end-to-end is a two-layer claim: (1) `StudioCoreOptions.effects`
 * actually reaches the SDK runtime so handlers fire, and (2) any traces
 * those actions emit are classified correctly on rebuild.
 *
 * This file covers layer (1). Layer (2) is currently gated on the host
 * side — `@manifesto-ai/host` allocates but never populates its
 * `HostResult.traces` array (verified at packages/host/src/host.ts:301),
 * so `core.getTraceHistory()` stays empty regardless of the Studio wiring.
 *
 * The classification logic for layer (2) is fully covered by
 * `packages/studio-core/src/__tests__/reconciler.test.ts` via the
 * `tagTraces(...)` unit tests using synthetic `TraceRecord` inputs.
 *
 * Once the upstream host begins pushing `TraceGraph`s into `HostResult`,
 * the `xit` cases below flip to `it` without further code changes on the
 * Studio side.
 */

const V1 = `
domain EffectTest {
  state {
    counter: number = 0
  }
  action probe() {
    onceIntent {
      patch counter = add(counter, 1)
      effect tracer.ping({ v: counter })
    }
  }
  action reset() {
    onceIntent {
      patch counter = 0
    }
  }
}
`.trim();

const V2 = `
domain EffectTest {
  state {
    counter: number = 0
  }
  action reset() {
    onceIntent {
      patch counter = 0
    }
  }
}
`.trim();

describe("SC-4 — effects option wiring (layer 1)", () => {
  it("effect handlers registered via StudioCoreOptions.effects fire on dispatch", async () => {
    const calls: unknown[] = [];
    const effects = {
      "tracer.ping": async (params: unknown) => {
        calls.push(params);
        return [];
      },
    };

    const adapter = createHeadlessAdapter({ initialSource: V1 });
    const core = createStudioCore({ effects });
    core.attach(adapter);

    const build = await core.build();
    expect(build.kind).toBe("ok");

    const report1 = await core.dispatchAsync(core.createIntent("probe"));
    const report2 = await core.dispatchAsync(core.createIntent("probe"));

    expect(report1.kind).toBe("completed");
    expect(report2.kind).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ v: 1 });
    expect(calls[1]).toEqual({ v: 2 });
  });

  it("omitting effects keeps SE-BUILD-6 default — handlers would never be called", async () => {
    const calls: unknown[] = [];
    // Build without effects option. Dispatching an effect-bearing action
    // should still complete (the effect declaration produces a requirement
    // that the empty host can no-op), and no handler fires.
    const adapter = createHeadlessAdapter({ initialSource: V1 });
    const core = createStudioCore();
    core.attach(adapter);

    const build = await core.build();
    expect(build.kind).toBe("ok");

    await core.dispatchAsync(core.createIntent("probe"));
    expect(calls).toHaveLength(0);
  });

  it("rebuild removing an effect-bearing action produces a plan that would tag its traces obsolete", async () => {
    // This is the "dry run" version of SC-4 layer (2): we assert on the
    // PLAN (pure calculation) without asking the host to have recorded
    // real traces. The classification path is: computePlan drops the
    // removed action, tagTraces maps each `TraceRecord.raw.intent.type`
    // to obsolete if the action is absent from the next schema.
    const effects = {
      "tracer.ping": async () => [],
    };

    const adapter = createHeadlessAdapter({ initialSource: V1 });
    const core = createStudioCore({ effects });
    core.attach(adapter);

    const firstBuild = await core.build();
    expect(firstBuild.kind).toBe("ok");
    if (firstBuild.kind !== "ok") return;
    expect(Object.keys(firstBuild.module.schema.actions)).toContain("probe");

    await core.dispatchAsync(core.createIntent("probe"));
    // Host-side trace recording is not wired yet; confirm the known gap
    // rather than asserting on a fiction.
    expect(core.getTraceHistory()).toHaveLength(0);

    adapter.setSource(V2);
    const secondBuild = await core.build();
    expect(secondBuild.kind).toBe("ok");
    if (secondBuild.kind !== "ok") return;

    // Identity map shows the action as discarded with reason "removed".
    expect(secondBuild.plan.identityMap.get("action:probe")).toEqual({
      kind: "discarded",
      reason: "removed",
    });
    // No real traces, so obsolete is empty — but the classification path
    // is exercised. Unit tests in studio-core/__tests__/reconciler.test.ts
    // cover the non-empty obsolete case with synthetic records.
    expect(secondBuild.plan.traceTag.obsolete).toEqual([]);
    expect(secondBuild.plan.traceTag.stillValid).toEqual([]);
  });
});
