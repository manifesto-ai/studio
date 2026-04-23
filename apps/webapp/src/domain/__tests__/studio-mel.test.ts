/**
 * studio.mel runtime smoke test.
 *
 * Verifies the bundled UI contract module (see ../studio.mel):
 *   1. Compiles cleanly — if this breaks, the in-app runtime won't boot.
 *   2. Initial snapshot matches the declared defaults.
 *   3. Dispatch semantics: focus / lens / simulation transitions apply.
 *   4. Legality gates enforce mutual exclusion:
 *        - enterSimulation only from live
 *        - scrubTo blocked while simulating
 *        - exitSimulation only while simulating
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioCore } from "@manifesto-ai/studio-core";
import { createHeadlessAdapter } from "@manifesto-ai/studio-adapter-headless";

const here = dirname(fileURLToPath(import.meta.url));
const studioMelSource = readFileSync(join(here, "..", "studio.mel"), "utf8");

async function bootStudioRuntime() {
  const core = createStudioCore();
  const adapter = createHeadlessAdapter({ initialSource: studioMelSource });
  core.attach(adapter);
  const result = await core.build();
  if (result.kind !== "ok") {
    throw new Error(
      `studio.mel failed to build: ${JSON.stringify(result.errors)}`,
    );
  }
  return core;
}

function readState(core: Awaited<ReturnType<typeof bootStudioRuntime>>) {
  const snap = core.getSnapshot();
  return (snap as { readonly data?: Record<string, unknown> } | null)?.data ?? {};
}

describe("studio.mel — compiles", () => {
  it("builds cleanly with no diagnostics", async () => {
    const core = await bootStudioRuntime();
    expect(core.getModule()).not.toBeNull();
  });
});

describe("studio.mel — initial state", () => {
  it("matches declared defaults", async () => {
    const core = await bootStudioRuntime();
    const state = readState(core);
    expect(state).toMatchObject({
      focusedNodeId: null,
      focusedNodeKind: null,
      focusedNodeOrigin: null,
      activeLens: "interact",
      viewMode: "live",
      simulationActionName: null,
      scrubEnvelopeId: null,
      activeProjectName: null,
    });
  });
});

describe("studio.mel — focus + lens transitions", () => {
  it("focusNode sets all three focus fields", async () => {
    const core = await bootStudioRuntime();
    const intent = core.createIntent(
      "focusNode",
      "action:toggleTodo",
      "action",
      "graph",
    );
    const res = await core.dispatchAsync(intent);
    expect(res.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      focusedNodeId: "action:toggleTodo",
      focusedNodeKind: "action",
      focusedNodeOrigin: "graph",
    });
  });

  it("clearFocus drops back to null", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("focusNode", "state:todos", "state", "graph"),
    );
    await core.dispatchAsync(core.createIntent("clearFocus"));
    expect(readState(core)).toMatchObject({
      focusedNodeId: null,
      focusedNodeKind: null,
      focusedNodeOrigin: null,
    });
  });

  it("openLens changes activeLens", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(core.createIntent("openLens", "agent"));
    expect(readState(core).activeLens).toBe("agent");
  });
});

describe("studio.mel — view-mode legality gates", () => {
  it("enterSimulation from live → simulate", async () => {
    const core = await bootStudioRuntime();
    const res = await core.dispatchAsync(
      core.createIntent("enterSimulation", "toggleTodo"),
    );
    expect(res.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      viewMode: "simulate",
      simulationActionName: "toggleTodo",
    });
  });

  it("scrubTo rejected while simulating", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("enterSimulation", "toggleTodo"),
    );
    const res = await core.dispatchAsync(
      core.createIntent("scrubTo", "env-1"),
    );
    expect(res.kind).toBe("rejected");
    // viewMode must not have flipped
    expect(readState(core).viewMode).toBe("simulate");
  });

  it("exitSimulation rejected from live, accepted from simulate", async () => {
    const core = await bootStudioRuntime();
    const fromLive = await core.dispatchAsync(
      core.createIntent("exitSimulation"),
    );
    expect(fromLive.kind).toBe("rejected");
    await core.dispatchAsync(core.createIntent("enterSimulation", "x"));
    const fromSim = await core.dispatchAsync(
      core.createIntent("exitSimulation"),
    );
    expect(fromSim.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      viewMode: "live",
      simulationActionName: null,
    });
  });

  it("scrubTo from live enters scrub mode; can re-target within scrub; resetScrub returns to live", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    expect(readState(core)).toMatchObject({
      viewMode: "scrub",
      scrubEnvelopeId: "env-1",
    });
    const retarget = await core.dispatchAsync(
      core.createIntent("scrubTo", "env-2"),
    );
    expect(retarget.kind).toBe("completed");
    expect(readState(core).scrubEnvelopeId).toBe("env-2");
    const reset = await core.dispatchAsync(core.createIntent("resetScrub"));
    expect(reset.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      viewMode: "live",
      scrubEnvelopeId: null,
    });
  });

  it("enterSimulation rejected while scrubbing", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    const res = await core.dispatchAsync(
      core.createIntent("enterSimulation", "toggleTodo"),
    );
    expect(res.kind).toBe("rejected");
    expect(readState(core).viewMode).toBe("scrub");
  });
});

describe("studio.mel — recordAgentTurn is single-entry + advances lineage", () => {
  it("stores latest prompt/answer, increments turn counter", async () => {
    const core = await bootStudioRuntime();
    const a = await core.dispatchAsync(
      core.createIntent("recordAgentTurn", "why is X blocked?", "X needs Y > 0"),
    );
    expect(a.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      lastUserPrompt: "why is X blocked?",
      lastAgentAnswer: "X needs Y > 0",
      agentTurnCount: 1,
    });
    const b = await core.dispatchAsync(
      core.createIntent("recordAgentTurn", "seed 5 rows", "(tool-only · 5)"),
    );
    expect(b.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      lastUserPrompt: "seed 5 rows",
      lastAgentAnswer: "(tool-only · 5)",
      agentTurnCount: 2,
    });
  });
});

describe("studio.mel — switchProject resets dependent state", () => {
  it("clears focus and view mode on project switch", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("focusNode", "action:x", "action", "graph"),
    );
    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    await core.dispatchAsync(core.createIntent("switchProject", "counter"));
    expect(readState(core)).toMatchObject({
      activeProjectName: "counter",
      focusedNodeId: null,
      focusedNodeKind: null,
      focusedNodeOrigin: null,
      viewMode: "live",
      simulationActionName: null,
      scrubEnvelopeId: null,
    });
  });
});
