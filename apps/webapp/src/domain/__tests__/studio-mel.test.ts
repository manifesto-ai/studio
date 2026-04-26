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

function readComputed(core: Awaited<ReturnType<typeof bootStudioRuntime>>) {
  const snap = core.getSnapshot();
  return (
    (snap as { readonly computed?: Record<string, unknown> } | null)
      ?.computed ?? {}
  );
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
      agentLastToolResultName: null,
      agentLastToolFailureKey: null,
      agentLastToolFailureReason: null,
      agentToolFailureRepeatCount: 0,
      agentLastToolSuccessKey: null,
      agentToolSuccessRepeatCount: 0,
      agentToolLoopBlockReason: null,
      agentLastModelFinishKey: null,
      agentModelFinishRepeatCount: 0,
      agentUserModuleReady: false,
      agentMelSourceNonEmpty: false,
      agentFocusedActionName: null,
      agentFocusedActionAvailable: false,
      agentLastAdmittedToolName: null,
    });
    expect(readComputed(core).agentToolLoopBlocked).toBe(false);
    expect(readComputed(core).agentHasFocusedAction).toBe(false);
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

describe("studio.mel — agent tool admission", () => {
  it("syncs host context and admits domain read tools only when ready", async () => {
    const core = await bootStudioRuntime();
    expect(core.isActionAvailable("requestTool")).toBe(false);

    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-tools", "live", "inspect"),
    );
    expect(core.isActionAvailable("requestTool")).toBe(true);
    const focus = await core.dispatchAsync(
      core.createIntent("requestTool", "inspectFocus"),
    );
    expect(focus.kind).toBe("completed");
    const blockedSnapshot = await core.dispatchAsync(
      core.createIntent("requestTool", "inspectSnapshot"),
    );
    expect(blockedSnapshot.kind).not.toBe("completed");

    const sync = await core.dispatchAsync(
      core.createIntent(
        "syncAgentToolContext",
        true,
        true,
        "submit",
        true,
      ),
    );
    expect(sync.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentUserModuleReady: true,
      agentMelSourceNonEmpty: true,
      agentFocusedActionName: "submit",
      agentFocusedActionAvailable: true,
    });
    expect(readComputed(core).agentHasFocusedAction).toBe(true);

    const admitted = await core.dispatchAsync(
      core.createIntent("requestTool", "inspectSnapshot"),
    );
    expect(admitted.kind).toBe("completed");
    expect(readState(core).agentLastAdmittedToolName).toBe("inspectSnapshot");
  });

  it("admits dispatch when the user domain is ready", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-dispatch", "live", "submit"),
    );

    const blocked = await core.dispatchAsync(
      core.createIntent("requestTool", "dispatch"),
    );
    expect(blocked.kind).not.toBe("completed");

    await core.dispatchAsync(
      core.createIntent(
        "syncAgentToolContext",
        true,
        true,
        null,
        false,
      ),
    );

    const ok = await core.dispatchAsync(
      core.createIntent("requestTool", "dispatch"),
    );
    expect(ok.kind).toBe("completed");
    expect(readState(core).agentLastAdmittedToolName).toBe("dispatch");
  });

  it("scopes simulate admission to live mode", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-sim", "live", "preview"),
    );
    await core.dispatchAsync(
      core.createIntent(
        "syncAgentToolContext",
        true,
        true,
        "submit",
        true,
      ),
    );
    const live = await core.dispatchAsync(
      core.createIntent("requestTool", "simulateIntent"),
    );
    expect(live.kind).toBe("completed");

    await core.dispatchAsync(core.createIntent("scrubTo", "env-1"));
    const scrubbed = await core.dispatchAsync(
      core.createIntent("requestTool", "simulateIntent"),
    );
    expect(scrubbed.kind).not.toBe("completed");
  });

  it("keeps endTurn admission running-only", async () => {
    const core = await bootStudioRuntime();
    expect(core.isActionAvailable("requestTool")).toBe(false);

    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-end", "live", "done"),
    );
    expect(core.isActionAvailable("requestTool")).toBe(true);
    const admitted = await core.dispatchAsync(
      core.createIntent("requestTool", "endTurn"),
    );
    expect(admitted.kind).toBe("completed");

    await core.dispatchAsync(core.createIntent("concludeAgentTurn", "done"));
    expect(core.isActionAvailable("requestTool")).toBe(false);
  });
});

describe("studio.mel — agent turn lifecycle", () => {
  it("begins with no active turn (status null, count 0)", async () => {
    const core = await bootStudioRuntime();
    expect(readState(core)).toMatchObject({
      agentTurnId: null,
      agentTurnMode: null,
      agentTurnStatus: null,
      agentTurnPrompt: null,
      agentTurnConclusion: null,
      agentTurnResendCount: 0,
      agentLastToolResultName: null,
      agentLastToolFailureKey: null,
      agentLastToolFailureReason: null,
      agentToolFailureRepeatCount: 0,
      agentLastToolSuccessKey: null,
      agentToolSuccessRepeatCount: 0,
      agentToolLoopBlockReason: null,
      agentLastModelFinishKey: null,
      agentModelFinishRepeatCount: 0,
      agentUserModuleReady: false,
      agentMelSourceNonEmpty: false,
      agentFocusedActionName: null,
      agentFocusedActionAvailable: false,
      agentLastAdmittedToolName: null,
    });
  });

  it("beginAgentTurn -> running; concludeAgentTurn -> ended", async () => {
    const core = await bootStudioRuntime();
    const begin = await core.dispatchAsync(
      core.createIntent(
        "beginAgentTurn",
        "turn-1",
        "live",
        "add priority field",
      ),
    );
    expect(begin.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnId: "turn-1",
      agentTurnMode: "live",
      agentTurnStatus: "running",
      agentTurnPrompt: "add priority field",
      agentTurnConclusion: null,
      agentTurnResendCount: 0,
      agentLastAdmittedToolName: null,
    });

    const conclude = await core.dispatchAsync(
      core.createIntent("concludeAgentTurn", "added priority field"),
    );
    expect(conclude.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion: "added priority field",
    });
  });

  it("rejects a second beginAgentTurn while one is running", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-a", "live", "first"),
    );
    const rejected = await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-b", "live", "second"),
    );
    expect(rejected.kind).not.toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnId: "turn-a",
      agentTurnMode: "live",
      agentTurnPrompt: "first",
    });
  });

  it("allows a new turn after the prior one ends (resets mode, resend count + conclusion)", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-1", "live", "p1"),
    );
    await core.dispatchAsync(core.createIntent("requestTool", "inspectFocus"));
    await core.dispatchAsync(
      core.createIntent("incrementAgentTurnResend"),
    );
    await core.dispatchAsync(
      core.createIntent("concludeAgentTurn", "done"),
    );
    const next = await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-2", "live", "p2"),
    );
    expect(next.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnId: "turn-2",
      agentTurnMode: "live",
      agentTurnStatus: "running",
      agentTurnPrompt: "p2",
      agentTurnConclusion: null,
      agentTurnResendCount: 0,
      agentLastToolResultName: null,
      agentLastToolFailureKey: null,
      agentLastToolFailureReason: null,
      agentToolFailureRepeatCount: 0,
      agentLastToolSuccessKey: null,
      agentToolSuccessRepeatCount: 0,
      agentToolLoopBlockReason: null,
      agentLastModelFinishKey: null,
      agentModelFinishRepeatCount: 0,
      agentLastAdmittedToolName: null,
    });
  });

  it("records repeated tool failures inside studio.mel and ends no-progress turns", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-tools", "live", "seed item"),
    );

    const first = await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "seedMock",
        "seedMock:unavailable",
        false,
        "Stopped repeated tool failure: seedMock - unavailable",
      ),
    );
    expect(first.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "running",
      agentLastToolResultName: "seedMock",
      agentLastToolFailureKey: "seedMock:unavailable",
      agentLastToolFailureReason:
        "Stopped repeated tool failure: seedMock - unavailable",
      agentToolFailureRepeatCount: 1,
      agentToolLoopBlockReason: null,
    });
    expect(readComputed(core).agentToolLoopBlocked).toBe(false);

    const second = await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "seedMock",
        "seedMock:unavailable",
        false,
        "Stopped repeated tool failure: seedMock - unavailable",
      ),
    );
    expect(second.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion:
        "Stopped repeated tool failure: seedMock - unavailable",
      agentToolFailureRepeatCount: 2,
      agentToolLoopBlockReason:
        "Stopped repeated tool failure: seedMock - unavailable",
    });
    expect(readComputed(core).agentToolLoopBlocked).toBe(true);
  });

  it("resets the tool failure streak after a successful tool result", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-reset", "live", "inspect"),
    );
    await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "dispatch",
        "dispatch:blocked",
        false,
        "dispatch blocked",
      ),
    );
    const success = await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "inspectSnapshot",
        "inspectSnapshot:ok:{}",
        true,
        "Stopped repeated successful tool call: inspectSnapshot",
      ),
    );

    expect(success.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "running",
      agentLastToolResultName: "inspectSnapshot",
      agentLastToolFailureKey: null,
      agentLastToolFailureReason: null,
      agentToolFailureRepeatCount: 0,
      agentLastToolSuccessKey: "inspectSnapshot:ok:{}",
      agentToolSuccessRepeatCount: 1,
      agentToolLoopBlockReason: null,
      agentLastModelFinishKey: null,
      agentModelFinishRepeatCount: 0,
    });
  });

  it("ends a turn after the same successful tool repeats without terminal progress", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-repeat-success", "live", "inspect"),
    );
    await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "inspectToolAffordances",
        "inspectToolAffordances:ok:{}",
        true,
        "Stopped repeated successful tool call: inspectToolAffordances",
      ),
    );
    const repeated = await core.dispatchAsync(
      core.createIntent(
        "recordAgentToolResult",
        "inspectToolAffordances",
        "inspectToolAffordances:ok:{}",
        true,
        "Stopped repeated successful tool call: inspectToolAffordances",
      ),
    );

    expect(repeated.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion:
        "Stopped repeated successful tool call: inspectToolAffordances",
      agentToolSuccessRepeatCount: 2,
      agentToolLoopBlockReason:
        "Stopped repeated successful tool call: inspectToolAffordances",
    });
    expect(readComputed(core).agentToolLoopBlocked).toBe(true);
  });

  it("ends a turn when the assistant emits text but forgets endTurn", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-text", "live", "answer"),
    );
    const finish = await core.dispatchAsync(
      core.createIntent(
        "recordAgentModelFinish",
        "text:done",
        true,
        false,
        "Ended after assistant text without endTurn.",
      ),
    );

    expect(finish.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion: "Ended after assistant text without endTurn.",
      agentLastModelFinishKey: "text:done",
      agentModelFinishRepeatCount: 1,
    });
  });

  it("ends a turn after repeated reasoning-only model finishes", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-reasoning", "live", "answer"),
    );
    const first = await core.dispatchAsync(
      core.createIntent(
        "recordAgentModelFinish",
        "reasoning-only",
        false,
        false,
        "Stopped repeated non-terminal assistant finish.",
      ),
    );
    expect(first.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "running",
      agentTurnResendCount: 1,
      agentModelFinishRepeatCount: 1,
      agentToolLoopBlockReason: null,
    });

    const second = await core.dispatchAsync(
      core.createIntent(
        "recordAgentModelFinish",
        "reasoning-only",
        false,
        false,
        "Stopped repeated non-terminal assistant finish.",
      ),
    );
    expect(second.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion: "Stopped repeated non-terminal assistant finish.",
      agentTurnResendCount: 2,
      agentModelFinishRepeatCount: 2,
      agentToolLoopBlockReason: "Stopped repeated non-terminal assistant finish.",
    });
    expect(readComputed(core).agentToolLoopBlocked).toBe(true);
  });

  it("rejects concludeAgentTurn when no turn is running", async () => {
    const core = await bootStudioRuntime();
    const rejected = await core.dispatchAsync(
      core.createIntent("concludeAgentTurn", "orphan"),
    );
    expect(rejected.kind).not.toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: null,
      agentTurnConclusion: null,
    });
  });

  it("incrementAgentTurnResend bumps the counter monotonically while running", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-x", "live", "pk"),
    );
    for (let i = 0; i < 3; i++) {
      const r = await core.dispatchAsync(
        core.createIntent("incrementAgentTurnResend"),
      );
      expect(r.kind).toBe("completed");
    }
    expect(readState(core)).toMatchObject({
      agentTurnResendCount: 3,
    });
  });

  it("cancelAgentTurn ends a running turn with the given reason", async () => {
    const core = await bootStudioRuntime();
    await core.dispatchAsync(
      core.createIntent("beginAgentTurn", "turn-cancel", "live", "pk"),
    );
    const cancelled = await core.dispatchAsync(
      core.createIntent("cancelAgentTurn", "stopped by user"),
    );
    expect(cancelled.kind).toBe("completed");
    expect(readState(core)).toMatchObject({
      agentTurnStatus: "ended",
      agentTurnConclusion: "stopped by user",
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
