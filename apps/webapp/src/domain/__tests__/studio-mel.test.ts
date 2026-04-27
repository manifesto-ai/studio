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

  it("preserves structural @meta annotations for grounding", async () => {
    const core = await bootStudioRuntime();
    const entries = (
      core.getModule() as {
        readonly annotations?: {
          readonly entries?: Record<
            string,
            readonly { readonly tag: string; readonly payload?: unknown }[]
          >;
        };
      } | null
    )?.annotations?.entries;

    expect(entries?.["domain:Studio"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "comment:grounding" }),
      ]),
    );
    expect(entries?.["state_field:focusedNodeId"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "comment:grounding" }),
      ]),
    );
    expect(entries?.["action:admitDispatch"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "agent:invariant" }),
        expect.objectContaining({ tag: "agent:example" }),
      ]),
    );
    expect(entries?.["action:admitGenerateMock"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "agent:example" }),
      ]),
    );
    expect(entries?.["action:admitSeedMock"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: "agent:example" }),
      ]),
    );
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
      agentUserModuleReady: false,
      agentCurrentSchemaHash: null,
      agentObservedSchemaHash: null,
      agentObservedFocusNodeId: null,
      agentLastAdmittedToolName: null,
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
      agentObservedFocusNodeId: null,
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
      agentObservedFocusNodeId: null,
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

describe("studio.mel — agent tool admission", () => {
  it("admits UI/meta tools without an agent turn", async () => {
    const core = await bootStudioRuntime();
    expect(core.isActionAvailable("admitInspectToolAffordances")).toBe(true);
    expect(core.isActionAvailable("admitInspectFocus")).toBe(true);

    const affordances = await core.dispatchAsync(
      core.createIntent("admitInspectToolAffordances"),
    );
    expect(affordances.kind).toBe("completed");
    const focus = await core.dispatchAsync(
      core.createIntent("admitInspectFocus"),
    );
    expect(focus.kind).toBe("completed");
    expect(readState(core).agentLastAdmittedToolName).toBe("inspectFocus");
  });

  it("syncs host context and admits domain read tools only when ready", async () => {
    const core = await bootStudioRuntime();
    const blockedSnapshot = await core.dispatchAsync(
      core.createIntent("admitInspectSnapshot"),
    );
    const blockedLineage = await core.dispatchAsync(
      core.createIntent("admitInspectLineage"),
    );
    const conversation = await core.dispatchAsync(
      core.createIntent("admitInspectConversation"),
    );
    expect(blockedSnapshot.kind).not.toBe("completed");
    expect(blockedLineage.kind).not.toBe("completed");
    expect(conversation.kind).toBe("completed");

    const sync = await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    expect(sync.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentUserModuleReady: true,
      agentCurrentSchemaHash: "schema-a",
      agentObservedSchemaHash: null,
    });

    const admitted = await core.dispatchAsync(
      core.createIntent("admitInspectSnapshot"),
    );
    expect(admitted.kind).toBe("completed");
    const lineage = await core.dispatchAsync(
      core.createIntent("admitInspectLineage"),
    );
    expect(lineage.kind).toBe("completed");
    expect(readState(core).agentLastAdmittedToolName).toBe("inspectLineage");
  });

  it("requires schema observation before schema-dependent tools", async () => {
    const core = await bootStudioRuntime();
    const blocked = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(blocked.kind).not.toBe("completed");

    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );

    const staleDispatch = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    const staleAvailability = await core.dispatchAsync(
      core.createIntent("admitInspectAvailability"),
    );
    const legality = await core.dispatchAsync(
      core.createIntent("admitExplainLegality"),
    );
    expect(staleDispatch.kind).not.toBe("completed");
    expect(staleAvailability.kind).not.toBe("completed");
    expect(legality.kind).toBe("completed");

    const schema = await core.dispatchAsync(
      core.createIntent("admitInspectSchema"),
    );
    expect(schema.kind).toBe("completed");
    const mark = await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );
    expect(mark.kind).toBe("completed");

    const ok = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    const availability = await core.dispatchAsync(
      core.createIntent("admitInspectAvailability"),
    );
    expect(ok.kind).toBe("completed");
    expect(availability.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentObservedSchemaHash: "schema-a",
      agentLastAdmittedToolName: "inspectAvailability",
    });
  });

  it("requires focus observation after the focused node changes", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );

    const beforeFocus = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(beforeFocus.kind).toBe("completed");

    await core.dispatchAsync(
      core.createIntent("focusNode", "state:wow", "state", "source"),
    );
    expect(readState(core)).toMatchObject({
      focusedNodeId: "state:wow",
      agentObservedFocusNodeId: null,
    });

    const blockedDispatch = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    const blockedSnapshot = await core.dispatchAsync(
      core.createIntent("admitInspectSnapshot"),
    );
    expect(blockedDispatch.kind).not.toBe("completed");
    expect(blockedSnapshot.kind).not.toBe("completed");

    const inspectFocus = await core.dispatchAsync(
      core.createIntent("admitInspectFocus"),
    );
    expect(inspectFocus.kind).toBe("completed");
    const mark = await core.dispatchAsync(
      core.createIntent("markAgentFocusObserved", "state:wow"),
    );
    expect(mark.kind).toBe("completed");

    const afterFocus = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(afterFocus.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentObservedFocusNodeId: "state:wow",
      agentLastAdmittedToolName: "dispatch",
    });
  });

  it("invalidates observed schema when the host reports a new schema hash", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );
    const before = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(before.kind).toBe("completed");

    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-b"),
    );
    expect(readState(core)).toMatchObject({
      agentCurrentSchemaHash: "schema-b",
      agentObservedSchemaHash: null,
    });
    const stale = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(stale.kind).not.toBe("completed");
    const wrongMark = await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );
    expect(wrongMark.kind).not.toBe("completed");

    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-b"),
    );
    const after = await core.dispatchAsync(
      core.createIntent("admitDispatch"),
    );
    expect(after.kind).toBe("completed");
  });

  it("admits mock tools when the user domain is ready", async () => {
    const core = await bootStudioRuntime();
    const blockedGenerate = await core.dispatchAsync(
      core.createIntent("admitGenerateMock"),
    );
    const blockedSeed = await core.dispatchAsync(
      core.createIntent("admitSeedMock"),
    );
    expect(blockedGenerate.kind).not.toBe("completed");
    expect(blockedSeed.kind).not.toBe("completed");

    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    const staleGenerate = await core.dispatchAsync(
      core.createIntent("admitGenerateMock"),
    );
    expect(staleGenerate.kind).not.toBe("completed");
    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );

    const generate = await core.dispatchAsync(
      core.createIntent("admitGenerateMock"),
    );
    expect(generate.kind).toBe("completed");
    const seed = await core.dispatchAsync(
      core.createIntent("admitSeedMock"),
    );
    expect(seed.kind).toBe("completed");
    expect(readState(core).agentLastAdmittedToolName).toBe("seedMock");
  });

  it("scopes simulate admission to live mode", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );
    const live = await core.dispatchAsync(
      core.createIntent("admitSimulateIntent"),
    );
    expect(live.kind).toBe("completed");

    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    const scrubbed = await core.dispatchAsync(
      core.createIntent("admitSimulateIntent"),
    );
    expect(scrubbed.kind).not.toBe("completed");
  });

  it("does not expose generic requestTool or removed endTurn admission", async () => {
    const core = await bootStudioRuntime();
    expect(core.isActionAvailable("requestTool")).toBe(false);
    expect(core.isActionAvailable("admitEndTurn")).toBe(false);
    expect(core.getModule()?.schema.actions).not.toHaveProperty("requestTool");
    expect(core.getModule()?.schema.actions).not.toHaveProperty("admitEndTurn");
  });
});

describe("studio.mel — switchProject resets dependent state", () => {
  it("clears focus and view mode on project switch", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("focusNode", "action:x", "action", "graph"),
    );
    await core.dispatchAsync(
      core.createIntent("syncAgentToolContext", true, "schema-a"),
    );
    await core.dispatchAsync(
      core.createIntent("markAgentSchemaObserved", "schema-a"),
    );
    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    await core.dispatchAsync(core.createIntent("switchProject", "counter"));
    expect(readState(core)).toMatchObject({
      activeProjectName: "counter",
      focusedNodeId: null,
      focusedNodeKind: null,
      focusedNodeOrigin: null,
      agentObservedFocusNodeId: null,
      agentUserModuleReady: false,
      agentCurrentSchemaHash: null,
      agentObservedSchemaHash: null,
      viewMode: "live",
      simulationActionName: null,
      scrubEnvelopeId: null,
    });
  });
});
